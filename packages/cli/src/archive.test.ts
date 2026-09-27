/**
 * `agentdocstore export` / `import`. The boot lock belongs to the instance that
 * holds it, not to the data: an archive that carried it would restore as a data
 * dir that is "already locked".
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Provider } from '@agentdocstore/core';
import { createFsProvider } from '@agentdocstore/provider-fs';

import { runExport, runImport } from './archive.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agentdocstore-archive-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

/** A data dir with one document, still open — so it holds the lock, like a running server. */
async function runningDataDir(dir: string): Promise<{ provider: Provider; id: string }> {
  const provider = await createFsProvider({ dataDir: dir });
  const doc = await provider.repository.create({
    title: 'Backup me',
    language: 'markdown',
    visibility: 'PRIVATE',
    content: 'important notes',
    createdBy: 'alice',
  });
  return { provider, id: doc.id };
}

function archiveEntries(file: string): string[] {
  return execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

async function titlesIn(dir: string): Promise<string[]> {
  const provider = await createFsProvider({ dataDir: dir });
  try {
    const page = await provider.repository.listByOwner('alice');
    return page.items.map((d) => d.title);
  } finally {
    await provider.close();
  }
}

describe('export', () => {
  it('leaves out the lock of the instance using the data dir', async () => {
    const data = join(root, 'data');
    const running = await runningDataDir(data);
    const archive = join(root, 'backup.tgz');

    runExport(archive, data);
    await running.provider.close();

    const entries = archiveEntries(archive);
    expect(entries).toContain(`./documents/${running.id}/meta.json`);
    expect(entries.filter((e) => e.includes('.agentdocstore.lock'))).toEqual([]);
  });
});

describe('import', () => {
  it('restores the data but not a lock carried by an older archive', async () => {
    // Made the way exports used to be: the whole dir, lock included.
    const data = join(root, 'data');
    const running = await runningDataDir(data);
    const archive = join(root, 'old.tgz');
    execFileSync('tar', ['-czf', archive, '-C', data, '.']);
    await running.provider.close();
    expect(archiveEntries(archive)).toContain('./.agentdocstore.lock/');

    const restored = join(root, 'restored');
    await runImport(archive, restored, false);

    expect(existsSync(join(restored, '.agentdocstore.lock'))).toBe(false);
    expect(await titlesIn(restored)).toEqual(['Backup me']);
  });

  it('refuses a data dir that a running instance is using, and writes nothing', async () => {
    const other = join(root, 'other');
    const source = await runningDataDir(other);
    const archive = join(root, 'other.tgz');
    runExport(archive, other);
    await source.provider.close();

    const live = join(root, 'live');
    const running = await runningDataDir(live);
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${String(code)}`);
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(Promise.resolve().then(() => runImport(archive, live, true))).rejects.toThrow(
        'exit 1',
      );
      expect(exit).toHaveBeenCalledWith(1);
      expect(errors.mock.calls.join('\n')).toContain('already locked');
      expect(existsSync(join(live, 'documents', source.id))).toBe(false);
    } finally {
      await running.provider.close();
    }
  });

  it('still imports over an idle data dir with --force, and leaves no lock', async () => {
    const other = join(root, 'other');
    const source = await runningDataDir(other);
    const archive = join(root, 'other.tgz');
    runExport(archive, other);
    await source.provider.close();

    const idle = join(root, 'idle');
    const previous = await runningDataDir(idle);
    await previous.provider.close();

    await runImport(archive, idle, true);

    expect(existsSync(join(idle, '.agentdocstore.lock'))).toBe(false);
    expect(existsSync(join(idle, 'documents', source.id, 'meta.json'))).toBe(true);
  });
});
