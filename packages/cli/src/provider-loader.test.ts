import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { OfflineViolationError } from '@agentdocstore/core';
import { loadProvider } from './provider-loader.js';

// ---------------------------------------------------------------------------
// Fixtures: a provider module written to disk and loaded by specifier
// ---------------------------------------------------------------------------

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'agentdocstore-loader-'));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/**
 * Write an ESM provider module and return its absolute path. Built as plain JS
 * so the test exercises the real dynamic-import path, not a bundler alias.
 */
function writeProviderModule(fileName: string, body: string): string {
  const path = join(work, fileName);
  writeFileSync(path, body, 'utf8');
  return path;
}

/** A minimally valid provider: enough SPI members for the shape assertion. */
const VALID_MODULE = (requiresNetwork: boolean, name = 'fake'): string => `
export const providerName = '${name}';
export async function createProvider(options) {
  return {
    repository: { options },
    comments: {},
    search: {},
    capabilities: {
      search: 'core-fallback',
      nativeTtl: false,
      atomicVersioning: true,
      requiresNetwork: ${String(requiresNetwork)},
    },
    close: async () => {},
  };
}
`;

// ---------------------------------------------------------------------------
// Built-ins
// ---------------------------------------------------------------------------

describe('loadProvider — built-ins', () => {
  it('loads the memory provider by shorthand', async () => {
    const loaded = await loadProvider({
      selection: { module: 'memory', options: {} },
      dataDir: work,
      mode: 'offline',
    });
    expect(loaded.name).toBe('memory');
    expect(loaded.provider.capabilities.requiresNetwork).toBe(false);
    await loaded.provider.close();
  });

  it('loads the fs provider by shorthand, into the given data dir', async () => {
    const dataDir = join(work, 'data');
    mkdirSync(dataDir, { recursive: true });
    const loaded = await loadProvider({
      selection: { module: 'fs', options: {} },
      dataDir,
      mode: 'offline',
    });
    expect(loaded.name).toBe('fs');
    await loaded.provider.close();
  });
});

// ---------------------------------------------------------------------------
// Offline policy
// ---------------------------------------------------------------------------

describe('loadProvider — offline policy', () => {
  it('refuses a non-loopback bind before constructing anything', async () => {
    await expect(
      loadProvider({
        selection: { module: 'memory', options: {} },
        dataDir: work,
        mode: 'offline',
        host: '0.0.0.0',
      }),
    ).rejects.toThrow(OfflineViolationError);
  });

  it('refuses a provider that declares requiresNetwork, and closes it again', async () => {
    const mod = writeProviderModule('remote.mjs', VALID_MODULE(true, 'pretend-postgres'));
    await expect(
      loadProvider({
        selection: { module: mod, options: {} },
        dataDir: work,
        mode: 'offline',
      }),
    ).rejects.toThrow(/requiresNetwork=true/);
  });

  it('accepts the same networked provider in networked mode', async () => {
    const mod = writeProviderModule('remote2.mjs', VALID_MODULE(true, 'pretend-postgres'));
    const loaded = await loadProvider({
      selection: { module: mod, options: {} },
      dataDir: work,
      mode: 'networked',
      host: '0.0.0.0',
    });
    expect(loaded.name).toBe('pretend-postgres');
    await loaded.provider.close();
  });
});

// ---------------------------------------------------------------------------
// Third-party module contract
// ---------------------------------------------------------------------------

describe('loadProvider — module contract', () => {
  it('loads a local provider module and passes options through', async () => {
    const mod = writeProviderModule('local.mjs', VALID_MODULE(false, 'local-store'));
    const loaded = await loadProvider({
      selection: { module: mod, options: { url: 'file:///tmp/x' } },
      dataDir: work,
      mode: 'offline',
    });
    expect(loaded.name).toBe('local-store');
    expect((loaded.provider.repository as unknown as { options: unknown }).options).toEqual({
      url: 'file:///tmp/x',
    });
    await loaded.provider.close();
  });

  it('accepts a default-export module shape', async () => {
    const mod = writeProviderModule(
      'default.mjs',
      `${VALID_MODULE(false, 'default-store')}
export default { providerName, createProvider };`,
    );
    const loaded = await loadProvider({
      selection: { module: mod, options: {} },
      dataDir: work,
      mode: 'offline',
    });
    expect(loaded.name).toBe('default-store');
    await loaded.provider.close();
  });

  it('validates options through the provider own schema', async () => {
    const mod = writeProviderModule(
      'schema.mjs',
      `
export const providerName = 'strict';
export const optionsSchema = {
  parse(input) {
    if (typeof input?.url !== 'string') throw new Error('url is required');
    return input;
  },
};
export async function createProvider(options) {
  return { repository: {}, comments: {}, search: {},
    capabilities: { search: 'core-fallback', nativeTtl: false, atomicVersioning: true, requiresNetwork: false },
    close: async () => {} };
}
`,
    );
    await expect(
      loadProvider({ selection: { module: mod, options: {} }, dataDir: work, mode: 'offline' }),
    ).rejects.toThrow(/Invalid options for provider .*url is required/);
  });

  it('rejects a module missing createProvider, naming the defect', async () => {
    const mod = writeProviderModule('bad.mjs', `export const providerName = 'nope';`);
    await expect(
      loadProvider({ selection: { module: mod, options: {} }, dataDir: work, mode: 'offline' }),
    ).rejects.toThrow(/missing a 'createProvider\(options\)' export/);
  });

  it('rejects a provider that omits capabilities.requiresNetwork', async () => {
    const mod = writeProviderModule(
      'undeclared.mjs',
      `
export const providerName = 'undeclared';
export async function createProvider() {
  return { repository: {}, comments: {}, search: {},
    capabilities: { search: 'core-fallback', nativeTtl: false, atomicVersioning: true },
    close: async () => {} };
}
`,
    );
    await expect(
      loadProvider({ selection: { module: mod, options: {} }, dataDir: work, mode: 'offline' }),
    ).rejects.toThrow(/does not declare capabilities.requiresNetwork/);
  });

  it('rejects a provider missing SPI members', async () => {
    const mod = writeProviderModule(
      'partial.mjs',
      `
export const providerName = 'partial';
export async function createProvider() {
  return { repository: {},
    capabilities: { search: 'core-fallback', nativeTtl: false, atomicVersioning: true, requiresNetwork: false },
    close: async () => {} };
}
`,
    );
    await expect(
      loadProvider({ selection: { module: mod, options: {} }, dataDir: work, mode: 'offline' }),
    ).rejects.toThrow(/missing SPI member\(s\): comments, search/);
  });

  it('explains how to install a module it cannot resolve', async () => {
    await expect(
      loadProvider({
        selection: { module: '@nobody/agentdocstore-provider-nonexistent', options: {} },
        dataDir: work,
        mode: 'offline',
        cwd: work,
      }),
    ).rejects.toThrow(/could not be resolved from .*npm install/s);
  });

  it('surfaces a factory failure with the provider name attached', async () => {
    const mod = writeProviderModule(
      'throws.mjs',
      `
export const providerName = 'broken';
export async function createProvider() { throw new Error('connection refused'); }
`,
    );
    await expect(
      loadProvider({ selection: { module: mod, options: {} }, dataDir: work, mode: 'offline' }),
    ).rejects.toThrow(/failed to initialise: connection refused/);
  });
});
