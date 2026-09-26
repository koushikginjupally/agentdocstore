import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseCli } from './index.js';
import {
  resolveConfig,
  loadTokensFile,
  parseProviderOptions,
  isBuiltinProvider,
  DEFAULT_TRUSTED_HEADER,
} from './config.js';
import type { EnvVars } from './config.js';
import { buildAuthMode, describeMode } from './serve.js';

const DATA = '/default/data';
const NO_ENV: EnvVars = {};

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'agentdocstore-config-'));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function writeJson(name: string, value: unknown): string {
  const path = join(work, name);
  writeFileSync(path, JSON.stringify(value), 'utf8');
  return path;
}

// ---------------------------------------------------------------------------
// Runtime mode
// ---------------------------------------------------------------------------

describe('runtime mode resolution', () => {
  it('defaults to offline — the safe state is not opt-in', () => {
    expect(resolveConfig({}, NO_ENV, DATA).mode).toBe('offline');
  });

  it('honours --networked and --offline flags', () => {
    expect(resolveConfig(parseCli(['serve', '--networked']).flags, NO_ENV, DATA).mode).toBe(
      'networked',
    );
    expect(resolveConfig(parseCli(['serve', '--offline']).flags, NO_ENV, DATA).mode).toBe(
      'offline',
    );
  });

  it('lets --networked win when both flags are passed', () => {
    const flags = parseCli(['serve', '--offline', '--networked']).flags;
    expect(resolveConfig(flags, NO_ENV, DATA).mode).toBe('networked');
  });

  it('reads the mode from env and config file, flags winning', () => {
    expect(resolveConfig({}, { AGENTDOCSTORE_MODE: 'networked' }, DATA).mode).toBe('networked');
    const cfg = writeJson('mode.json', { mode: 'networked' });
    expect(resolveConfig({ configFile: cfg }, NO_ENV, DATA).mode).toBe('networked');
    expect(resolveConfig({ configFile: cfg, mode: 'offline' }, NO_ENV, DATA).mode).toBe('offline');
  });

  it('ignores an unrecognised mode rather than guessing', () => {
    expect(resolveConfig({}, { AGENTDOCSTORE_MODE: 'online' }, DATA).mode).toBe('offline');
  });
});

// ---------------------------------------------------------------------------
// Inbound exposure (orthogonal to mode)
// ---------------------------------------------------------------------------

describe('expose resolution', () => {
  it('defaults to loopback-only', () => {
    expect(resolveConfig({}, NO_ENV, DATA).expose).toBe(false);
  });

  it('is set by --expose, env, or config file', () => {
    expect(resolveConfig(parseCli(['serve', '--expose']).flags, NO_ENV, DATA).expose).toBe(true);
    expect(resolveConfig({}, { AGENTDOCSTORE_EXPOSE: '1' }, DATA).expose).toBe(true);
    const cfg = writeJson('expose.json', { expose: true });
    expect(resolveConfig({ configFile: cfg }, NO_ENV, DATA).expose).toBe(true);
  });

  it('stays independent of mode — exposed does not mean networked', () => {
    const config = resolveConfig(parseCli(['serve', '--expose']).flags, NO_ENV, DATA);
    expect(config.expose).toBe(true);
    expect(config.mode).toBe('offline');
    const banner = describeMode(config, 'fs');
    expect(banner).toContain('egress=fused');
    expect(banner).toContain('inbound=exposed');
  });
});

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

describe('provider selection', () => {
  it('defaults to the fs provider', () => {
    expect(resolveConfig({}, NO_ENV, DATA).provider).toEqual({ module: 'fs', options: {} });
  });

  it('treats --ephemeral as the memory provider', () => {
    const flags = parseCli(['serve', '--ephemeral']).flags;
    expect(resolveConfig(flags, NO_ENV, DATA).provider.module).toBe('memory');
  });

  it('lets --ephemeral override a configured provider, loudly not silently', () => {
    const cfg = writeJson('p.json', { provider: { module: '@acme/pg', options: { url: 'x' } } });
    const config = resolveConfig({ configFile: cfg, ephemeral: true }, NO_ENV, DATA);
    expect(config.provider).toEqual({ module: 'memory', options: {} });
  });

  it('parses --provider and --provider-options', () => {
    const flags = parseCli([
      'serve',
      '--provider',
      '@acme/pg',
      '--provider-options',
      '{"url":"postgres://x"}',
    ]).flags;
    const config = resolveConfig(flags, NO_ENV, DATA);
    expect(config.provider).toEqual({ module: '@acme/pg', options: { url: 'postgres://x' } });
  });

  it('accepts a bare string provider in the config file', () => {
    const cfg = writeJson('bare.json', { provider: '@acme/ddb' });
    expect(resolveConfig({ configFile: cfg }, NO_ENV, DATA).provider).toEqual({
      module: '@acme/ddb',
      options: {},
    });
  });

  it('layers module and options independently across sources', () => {
    const cfg = writeJson('layer.json', { provider: { options: { url: 'from-file' } } });
    const config = resolveConfig({ configFile: cfg }, { AGENTDOCSTORE_PROVIDER: '@acme/pg' }, DATA);
    expect(config.provider).toEqual({ module: '@acme/pg', options: { url: 'from-file' } });
  });

  it('reads provider options from the environment as JSON', () => {
    const config = resolveConfig(
      {},
      { AGENTDOCSTORE_PROVIDER: '@acme/pg', AGENTDOCSTORE_PROVIDER_OPTIONS: '{"a":1}' },
      DATA,
    );
    expect(config.provider.options).toEqual({ a: 1 });
  });

  it('rejects malformed provider options, naming the source', () => {
    expect(() => parseProviderOptions('not json', '--provider-options')).toThrow(
      /--provider-options must be valid JSON/,
    );
    expect(() => parseProviderOptions('[1,2]', 'AGENTDOCSTORE_PROVIDER_OPTIONS')).toThrow(
      /must be a JSON object/,
    );
  });

  it('knows which names are built in', () => {
    expect(isBuiltinProvider('fs')).toBe(true);
    expect(isBuiltinProvider('memory')).toBe(true);
    expect(isBuiltinProvider('@acme/pg')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Auth knobs
// ---------------------------------------------------------------------------

describe('auth configuration', () => {
  it('defaults the trusted header and allows overriding it', () => {
    expect(resolveConfig({}, NO_ENV, DATA).trustedHeader).toBe(DEFAULT_TRUSTED_HEADER);
    const flags = parseCli(['serve', '--trusted-header', 'x-remote-user']).flags;
    expect(resolveConfig(flags, NO_ENV, DATA).trustedHeader).toBe('x-remote-user');
  });

  it('passes an explicit --user into single-user auth', () => {
    const flags = parseCli(['serve', '--user', 'alice']).flags;
    const config = resolveConfig(flags, NO_ENV, DATA);
    expect(buildAuthMode(config)).toEqual({ mode: 'single-user', user: 'alice' });
  });

  it('builds trusted-header auth with the configured header', () => {
    const flags = parseCli(['serve', '--auth', 'trusted-header', '--trusted-header', 'x-u']).flags;
    expect(buildAuthMode(resolveConfig(flags, NO_ENV, DATA))).toEqual({
      mode: 'trusted-header',
      header: 'x-u',
    });
  });

  it('refuses token auth without a tokens file instead of rejecting every caller', () => {
    const flags = parseCli(['serve', '--auth', 'token']).flags;
    expect(() => buildAuthMode(resolveConfig(flags, NO_ENV, DATA))).toThrow(
      /auth=token requires a tokens file/,
    );
  });

  it('loads a tokens file into the auth mode', () => {
    const tokens = writeJson('tokens.json', { 'tok-a': 'alice', 'tok-b': 'bob' });
    const flags = parseCli(['serve', '--auth', 'token', '--tokens', tokens]).flags;
    expect(buildAuthMode(resolveConfig(flags, NO_ENV, DATA))).toEqual({
      mode: 'token',
      tokens: { 'tok-a': 'alice', 'tok-b': 'bob' },
    });
  });
});

describe('loadTokensFile', () => {
  it('rejects an empty map, which would reject every caller', () => {
    expect(() => loadTokensFile(writeJson('empty.json', {}))).toThrow(/is empty/);
  });

  it('rejects a non-object and a non-string username', () => {
    expect(() => loadTokensFile(writeJson('arr.json', ['a']))).toThrow(/must be a JSON object/);
    expect(() => loadTokensFile(writeJson('num.json', { tok: 7 }))).toThrow(/non-string username/);
  });

  it('rejects invalid JSON with the path in the message', () => {
    const path = join(work, 'broken.json');
    writeFileSync(path, '{nope', 'utf8');
    expect(() => loadTokensFile(path)).toThrow(/not valid JSON: .*broken.json/);
  });
});

// ---------------------------------------------------------------------------
// Boot banner
// ---------------------------------------------------------------------------

describe('describeMode', () => {
  it('states the mode, provider, auth and egress posture', () => {
    const offline = describeMode(resolveConfig({}, NO_ENV, DATA), 'fs');
    expect(offline).toContain('mode=offline');
    expect(offline).toContain('provider=fs');
    expect(offline).toContain('auth=single-user');
    expect(offline).toContain('egress=fused');

    const networked = describeMode(resolveConfig({ mode: 'networked' }, NO_ENV, DATA), 'postgres');
    expect(networked).toContain('mode=networked');
    expect(networked).toContain('egress=allowed');
  });
});
