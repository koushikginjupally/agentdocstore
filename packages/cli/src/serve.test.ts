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
import { runServe } from './serve.js';

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
});
