/**
 * Tests for the AgentDocStore CLI — pure logic only.
 *
 * Covers:
 * - Argument parsing for every subcommand
 * - Config precedence: flags > env > file > defaults
 * - Non-localhost security warning condition
 * - Import refuses non-empty directory without --force
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseCli } from './index.js';
import { resolveConfig, extractEnvConfig, isNonLocalhost, loadConfigFile } from './config.js';
import type { CliFlags, EnvVars } from './config.js';
import { isDirNonEmpty } from './archive.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_DATA_DIR = '/tmp/test-default-data';

function tmpDir(): string {
  const dir = join(
    tmpdir(),
    `agentdocstore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// parseCli
// ---------------------------------------------------------------------------

describe('parseCli', () => {
  it('parses serve with all flags', () => {
    const result = parseCli([
      'serve',
      '--port',
      '9999',
      '--host',
      '0.0.0.0',
      '--data',
      '/my/data',
      '--auth',
      'token',
      '--ephemeral',
      '--config',
      '/my/config.json',
    ]);
    expect(result.command).toBe('serve');
    expect(result.flags.port).toBe(9999);
    expect(result.flags.host).toBe('0.0.0.0');
    expect(result.flags.dataDir).toBe('/my/data');
    expect(result.flags.auth).toBe('token');
    expect(result.flags.ephemeral).toBe(true);
    expect(result.flags.configFile).toBe('/my/config.json');
  });

  it('parses mcp with --ephemeral', () => {
    const result = parseCli(['mcp', '--ephemeral']);
    expect(result.command).toBe('mcp');
    expect(result.flags.ephemeral).toBe(true);
  });

  it('parses export with positional file argument', () => {
    const result = parseCli(['export', 'backup.tgz']);
    expect(result.command).toBe('export');
    expect(result.positional).toEqual(['backup.tgz']);
  });

  it('parses import with --force', () => {
    const result = parseCli(['import', 'backup.tgz', '--force']);
    expect(result.command).toBe('import');
    expect(result.positional).toEqual(['backup.tgz']);
    expect(result.force).toBe(true);
  });

  it('parses --help at top level', () => {
    const result = parseCli(['--help']);
    expect(result.help).toBe(true);
    expect(result.command).toBe('');
  });

  it('parses --version', () => {
    const result = parseCli(['--version']);
    expect(result.version).toBe(true);
  });

  it('parses subcommand --help', () => {
    const result = parseCli(['serve', '--help']);
    expect(result.command).toBe('serve');
    expect(result.help).toBe(true);
  });

  it('handles no arguments', () => {
    const result = parseCli([]);
    expect(result.command).toBe('');
    expect(result.flags).toEqual({});
  });

  // An unknown auth mode used to be dropped, so the server fell back to
  // single-user — no authentication at all — on a misspelt `token`.
  it('refuses an unknown --auth value, naming the flag', () => {
    expect(() => parseCli(['serve', '--auth', 'bogus'])).toThrow(
      'Unknown auth mode "bogus" from --auth: use single-user, trusted-header or token.',
    );
    expect(() => parseCli(['serve', '--auth', ''])).toThrow(/Unknown auth mode "" from --auth/);
  });

  it('refuses --auth without a value', () => {
    expect(() => parseCli(['serve', '--auth'])).toThrow(
      '--auth needs a value: use single-user, trusted-header or token.',
    );
  });

  it('uses short flags', () => {
    const result = parseCli(['serve', '-p', '3000', '-H', '0.0.0.0', '-e']);
    expect(result.flags.port).toBe(3000);
    expect(result.flags.host).toBe('0.0.0.0');
    expect(result.flags.ephemeral).toBe(true);
  });

  it('parses import without --force defaults to false', () => {
    const result = parseCli(['import', 'data.tgz']);
    expect(result.force).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Config precedence
// ---------------------------------------------------------------------------

describe('resolveConfig', () => {
  it('uses defaults when nothing else is specified', () => {
    const config = resolveConfig({}, {}, DEFAULT_DATA_DIR);
    expect(config.port).toBe(8787);
    expect(config.host).toBe('127.0.0.1');
    expect(config.dataDir).toBe(DEFAULT_DATA_DIR);
    expect(config.auth).toBe('single-user');
    expect(config.ephemeral).toBe(false);
    expect(config.configFile).toBeUndefined();
  });

  it('env vars override defaults', () => {
    const env: EnvVars = {
      AGENTDOCSTORE_PORT: '3000',
      AGENTDOCSTORE_HOST: '0.0.0.0',
      AGENTDOCSTORE_AUTH: 'trusted-header',
      AGENTDOCSTORE_EPHEMERAL: 'true',
    };
    const config = resolveConfig({}, env, DEFAULT_DATA_DIR);
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.auth).toBe('trusted-header');
    expect(config.ephemeral).toBe(true);
  });

  it('CLI flags override env vars', () => {
    const flags: CliFlags = { port: 5555, host: '10.0.0.1' };
    const env: EnvVars = { AGENTDOCSTORE_PORT: '3000', AGENTDOCSTORE_HOST: '0.0.0.0' };
    const config = resolveConfig(flags, env, DEFAULT_DATA_DIR);
    expect(config.port).toBe(5555);
    expect(config.host).toBe('10.0.0.1');
  });

  it('config file values override defaults', () => {
    const dir = tmpDir();
    const cfgPath = join(dir, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({ port: 4444, host: '192.168.1.1' }));

    const config = resolveConfig({ configFile: cfgPath }, {}, DEFAULT_DATA_DIR);
    expect(config.port).toBe(4444);
    expect(config.host).toBe('192.168.1.1');

    rmSync(dir, { recursive: true, force: true });
  });

  it('env vars override config file', () => {
    const dir = tmpDir();
    const cfgPath = join(dir, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({ port: 4444 }));

    const env: EnvVars = { AGENTDOCSTORE_PORT: '6666' };
    const config = resolveConfig({ configFile: cfgPath }, env, DEFAULT_DATA_DIR);
    expect(config.port).toBe(6666);

    rmSync(dir, { recursive: true, force: true });
  });

  it('CLI flags override config file', () => {
    const dir = tmpDir();
    const cfgPath = join(dir, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({ port: 4444, host: '10.0.0.1' }));

    const flags: CliFlags = { port: 7777, configFile: cfgPath };
    const config = resolveConfig(flags, {}, DEFAULT_DATA_DIR);
    expect(config.port).toBe(7777);
    expect(config.host).toBe('10.0.0.1'); // falls through to file

    rmSync(dir, { recursive: true, force: true });
  });

  it('full precedence chain: flags > env > file > default', () => {
    const dir = tmpDir();
    const cfgPath = join(dir, 'config.json');
    writeFileSync(
      cfgPath,
      JSON.stringify({
        port: 1111,
        host: 'file-host',
        dataDir: '/file-data',
        auth: 'token',
      }),
    );

    const flags: CliFlags = { port: 9999, configFile: cfgPath };
    const env: EnvVars = { AGENTDOCSTORE_HOST: 'env-host', AGENTDOCSTORE_AUTH: 'trusted-header' };
    const config = resolveConfig(flags, env, DEFAULT_DATA_DIR);

    // port: flag=9999 wins over env(unset) and file(1111) and default(8787)
    expect(config.port).toBe(9999);
    // host: flag=unset, env=env-host wins over file(file-host) and default(127.0.0.1)
    expect(config.host).toBe('env-host');
    // dataDir: flag=unset, env=unset, file=/file-data wins over default
    expect(config.dataDir).toBe('/file-data');
    // auth: flag=unset, env=trusted-header wins over file(token) and default(single-user)
    expect(config.auth).toBe('trusted-header');

    rmSync(dir, { recursive: true, force: true });
  });

  it('AGENTDOCSTORE_CONFIG env var sets config file path', () => {
    const dir = tmpDir();
    const cfgPath = join(dir, 'env-config.json');
    writeFileSync(cfgPath, JSON.stringify({ port: 2222 }));

    const env: EnvVars = { AGENTDOCSTORE_CONFIG: cfgPath };
    const config = resolveConfig({}, env, DEFAULT_DATA_DIR);
    expect(config.port).toBe(2222);
    expect(config.configFile).toBe(cfgPath);

    rmSync(dir, { recursive: true, force: true });
  });

  it('CLI configFile flag overrides AGENTDOCSTORE_CONFIG env var', () => {
    const dir = tmpDir();
    const envCfgPath = join(dir, 'env-config.json');
    const flagCfgPath = join(dir, 'flag-config.json');
    writeFileSync(envCfgPath, JSON.stringify({ port: 2222 }));
    writeFileSync(flagCfgPath, JSON.stringify({ port: 3333 }));

    const flags: CliFlags = { configFile: flagCfgPath };
    const env: EnvVars = { AGENTDOCSTORE_CONFIG: envCfgPath };
    const config = resolveConfig(flags, env, DEFAULT_DATA_DIR);
    expect(config.port).toBe(3333);

    rmSync(dir, { recursive: true, force: true });
  });

  it('AGENTDOCSTORE_EPHEMERAL=1 sets ephemeral', () => {
    const env: EnvVars = { AGENTDOCSTORE_EPHEMERAL: '1' };
    const config = resolveConfig({}, env, DEFAULT_DATA_DIR);
    expect(config.ephemeral).toBe(true);
  });

  it('AGENTDOCSTORE_DATA_DIR sets data directory', () => {
    const env: EnvVars = { AGENTDOCSTORE_DATA_DIR: '/custom/path' };
    const config = resolveConfig({}, env, DEFAULT_DATA_DIR);
    expect(config.dataDir).toBe('/custom/path');
  });

  it('refuses an unknown AGENTDOCSTORE_AUTH, naming the variable', () => {
    const env: EnvVars = { AGENTDOCSTORE_AUTH: 'trusted_header' };
    expect(() => resolveConfig({}, env, DEFAULT_DATA_DIR)).toThrow(
      'Unknown auth mode "trusted_header" from AGENTDOCSTORE_AUTH: use single-user, trusted-header or token.',
    );
  });

  it('refuses an unknown auth mode in the config file, naming the file', () => {
    const dir = tmpDir();
    const cfgPath = join(dir, 'config.json');
    writeFileSync(cfgPath, JSON.stringify({ auth: 'tokens' }));
    try {
      expect(() => resolveConfig({}, {}, DEFAULT_DATA_DIR)).not.toThrow();
      expect(() => resolveConfig({ configFile: cfgPath }, {}, DEFAULT_DATA_DIR)).toThrow(
        `Unknown auth mode "tokens" from "auth" in ${cfgPath}: use single-user, trusted-header or token.`,
      );
      // Still refused when a flag overrides it: the file is wrong either way.
      expect(() =>
        resolveConfig({ configFile: cfgPath, auth: 'token' }, {}, DEFAULT_DATA_DIR),
      ).toThrow(/Unknown auth mode "tokens"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('invalid AGENTDOCSTORE_PORT is ignored', () => {
    const env: EnvVars = { AGENTDOCSTORE_PORT: 'abc' };
    const config = resolveConfig({}, env, DEFAULT_DATA_DIR);
    expect(config.port).toBe(8787);
  });
});

// ---------------------------------------------------------------------------
// extractEnvConfig
// ---------------------------------------------------------------------------

describe('extractEnvConfig', () => {
  it('extracts all env vars', () => {
    const result = extractEnvConfig({
      AGENTDOCSTORE_PORT: '4000',
      AGENTDOCSTORE_HOST: '10.0.0.1',
      AGENTDOCSTORE_DATA_DIR: '/data',
      AGENTDOCSTORE_AUTH: 'token',
      AGENTDOCSTORE_EPHEMERAL: 'true',
      AGENTDOCSTORE_CONFIG: '/cfg.json',
    });
    expect(result.port).toBe(4000);
    expect(result.host).toBe('10.0.0.1');
    expect(result.dataDir).toBe('/data');
    expect(result.auth).toBe('token');
    expect(result.ephemeral).toBe(true);
    expect(result.configFile).toBe('/cfg.json');
  });

  it('returns empty for empty env', () => {
    const result = extractEnvConfig({});
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// isNonLocalhost
// ---------------------------------------------------------------------------

describe('isNonLocalhost', () => {
  it('returns false for 127.0.0.1', () => {
    expect(isNonLocalhost('127.0.0.1')).toBe(false);
  });

  it('returns false for localhost', () => {
    expect(isNonLocalhost('localhost')).toBe(false);
  });

  it('returns false for ::1', () => {
    expect(isNonLocalhost('::1')).toBe(false);
  });

  it('returns true for 0.0.0.0', () => {
    expect(isNonLocalhost('0.0.0.0')).toBe(true);
  });

  it('returns true for a LAN address', () => {
    expect(isNonLocalhost('192.168.1.1')).toBe(true);
  });

  it('returns true for a public address', () => {
    expect(isNonLocalhost('1.2.3.4')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isDirNonEmpty (import guard)
// ---------------------------------------------------------------------------

describe('isDirNonEmpty', () => {
  it('returns false for a non-existent directory', () => {
    expect(isDirNonEmpty('/nonexistent/path/xyz')).toBe(false);
  });

  it('returns false for an empty directory', () => {
    const dir = tmpDir();
    expect(isDirNonEmpty(dir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns true for a non-empty directory', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'file.txt'), 'data');
    expect(isDirNonEmpty(dir)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// loadConfigFile
// ---------------------------------------------------------------------------

describe('loadConfigFile', () => {
  it('loads a valid config file', () => {
    const dir = tmpDir();
    const path = join(dir, 'cfg.json');
    writeFileSync(path, JSON.stringify({ port: 1234, host: '10.0.0.1' }));

    const cfg = loadConfigFile(path);
    expect(cfg.port).toBe(1234);
    expect(cfg.host).toBe('10.0.0.1');

    rmSync(dir, { recursive: true, force: true });
  });

  it('throws on non-JSON file', () => {
    const dir = tmpDir();
    const path = join(dir, 'bad.json');
    writeFileSync(path, 'not json');

    expect(() => loadConfigFile(path)).toThrow();

    rmSync(dir, { recursive: true, force: true });
  });

  it('throws on array config', () => {
    const dir = tmpDir();
    const path = join(dir, 'arr.json');
    writeFileSync(path, JSON.stringify([1, 2, 3]));

    expect(() => loadConfigFile(path)).toThrow('JSON object');

    rmSync(dir, { recursive: true, force: true });
  });
});
