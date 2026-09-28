/**
 * `agentdocstore serve` startup. The fs provider holds the data dir's lock from
 * the moment it opens, so a start that fails afterwards — a port already in
 * use, a port out of range, token auth without a tokens file — must release
 * it, or the next start fails with "already locked" until the lock is removed
 * by hand. "Ready" is announced only once the port is actually ours.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { BOOT_LOCK_DIR } from '@agentdocstore/provider-fs';

import { resolveConfig } from './config.js';
import type { ResolvedConfig } from './config.js';
import { findWebDist, httpUrl, runServe } from './serve.js';

const dirs: string[] = [];
const signalListeners = {
  SIGINT: process.listeners('SIGINT'),
  SIGTERM: process.listeners('SIGTERM'),
};
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    for (const listener of process.listeners(signal)) {
      if (!signalListeners[signal].includes(listener)) process.off(signal, listener);
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentdocstore-serve-'));
  dirs.push(dir);
  return dir;
}

function configFor(dataDir: string, overrides: Partial<ResolvedConfig>): ResolvedConfig {
  return { ...resolveConfig({ dataDir, user: 'alice' }, {}, dataDir), ...overrides };
}

const locked = (dataDir: string): boolean => existsSync(join(dataDir, BOOT_LOCK_DIR));

/** Listen on a free loopback port and return the server holding it. */
async function holdPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const holder = createServer();
  await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const { port } = holder.address() as AddressInfo;
  return { port, release: () => new Promise((resolve) => holder.close(() => resolve())) };
}

describe('runServe', () => {
  it('fails on a port already in use, without saying it is ready, and leaves the data dir unlocked', async () => {
    const dir = tempDataDir();
    const busy = await holdPort();
    try {
      await expect(runServe(configFor(dir, { port: busy.port }))).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await busy.release();
    }
    expect(logged.some((line) => line.includes('ready at'))).toBe(false);
    expect(locked(dir)).toBe(false);
  });

  it('fails on a port out of range and leaves the data dir unlocked', async () => {
    const dir = tempDataDir();
    await expect(runServe(configFor(dir, { port: 70_000 }))).rejects.toThrow(/port/);
    expect(locked(dir)).toBe(false);
  });

  it('refuses token auth without a tokens file before touching the data dir', async () => {
    const dir = tempDataDir();
    await expect(runServe(configFor(dir, { auth: 'token' }))).rejects.toThrow(
      /requires a tokens file/,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it('says it is ready once listening, and closing it unlocks the data dir', async () => {
    const dir = tempDataDir();
    const free = await holdPort();
    await free.release();
    const handle = await runServe(configFor(dir, { port: free.port }));
    try {
      expect(handle.server.listening).toBe(true);
      expect(logged).toContain(`AgentDocStore ready at http://127.0.0.1:${free.port}`);
      expect(locked(dir)).toBe(true);
    } finally {
      await handle.close();
    }
    expect(locked(dir)).toBe(false);
  });

  // "ready at http://127.0.0.1:0" gave a URL that refused every connection.
  it('with --port 0, gives the port it actually got', async () => {
    const handle = await runServe(configFor(tempDataDir(), { port: 0 }));
    try {
      const { port } = handle.server.address() as AddressInfo;
      expect(port).toBeGreaterThan(0);
      expect(logged).toContain(`AgentDocStore ready at http://127.0.0.1:${port}`);
    } finally {
      await handle.close();
    }
  });
});

describe('httpUrl', () => {
  // "http://::1:8787" is not a URL; a browser or fetch needs the brackets.
  it('brackets an IPv6 address', () => {
    expect(httpUrl('::1', 8787)).toBe('http://[::1]:8787');
    expect(httpUrl('fe80::1', 80)).toBe('http://[fe80::1]:80');
    expect(new URL(httpUrl('::', 8787)).port).toBe('8787');
  });

  it('leaves names, IPv4 addresses and already-bracketed hosts as they are', () => {
    expect(httpUrl('127.0.0.1', 8787)).toBe('http://127.0.0.1:8787');
    expect(httpUrl('localhost', 3000)).toBe('http://localhost:3000');
    expect(httpUrl('[::1]', 8787)).toBe('http://[::1]:8787');
  });
});

describe('findWebDist', () => {
  // A fake filesystem: only the listed files exist.
  const having =
    (...files: string[]) =>
    (path: string): boolean =>
      files.includes(path);

  it('uses the copy beside the bundle in the npm package', () => {
    const bundle = '/app/node_modules/agentdocstore/bundle/index.js';
    const web = '/app/node_modules/agentdocstore/bundle/web';
    expect(findWebDist(bundle, having(`${web}/index.html`))).toBe(web);
  });

  it('falls back to packages/web/dist in the repository', () => {
    const built = '/repo/packages/cli/dist/serve.js';
    expect(findWebDist(built, having('/repo/packages/web/dist/index.html'))).toBe(
      '/repo/packages/web/dist',
    );
  });

  it('prefers the bundled copy when both exist', () => {
    const bundle = '/repo/packages/cli/bundle/index.js';
    const found = findWebDist(
      bundle,
      having('/repo/packages/cli/bundle/web/index.html', '/repo/packages/web/dist/index.html'),
    );
    expect(found).toBe('/repo/packages/cli/bundle/web');
  });

  it('returns undefined when neither place has index.html', () => {
    expect(
      findWebDist('/app/node_modules/agentdocstore/bundle/index.js', having()),
    ).toBeUndefined();
  });
});
