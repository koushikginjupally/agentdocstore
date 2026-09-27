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
    runImport(archive, restored, false);

    expect(existsSync(join(restored, '.agentdocstore.lock'))).toBe(false);
    expect(await titlesIn(restored)).toEqual(['Backup me']);
  });
});
