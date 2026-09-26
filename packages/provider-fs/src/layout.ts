import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Path helpers for the on-disk layout:
 *
 *   <dataDir>/
 *     documents/<id>/meta.json
 *     documents/<id>/versions/<n>.txt
 *     documents/<id>/comments.json
 *     index/snapshot.json
 *     .agentdocstore.lock/            (advisory boot lock dir)
 *
 * These builders are pure string joins. Callers MUST validate ids with
 * `isValidId` from @agentdocstore/core BEFORE calling anything that takes an id,
 * so a traversing value never reaches a path builder.
 */

export function documentsDir(dataDir: string): string {
  return path.join(dataDir, 'documents');
}

export function indexDir(dataDir: string): string {
  return path.join(dataDir, 'index');
}

export function indexSnapshotPath(dataDir: string): string {
  return path.join(indexDir(dataDir), 'snapshot.json');
}

export function documentDir(dataDir: string, id: string): string {
  return path.join(documentsDir(dataDir), id);
}

export function metaPath(dataDir: string, id: string): string {
  return path.join(documentDir(dataDir, id), 'meta.json');
}

export function versionsDir(dataDir: string, id: string): string {
  return path.join(documentDir(dataDir, id), 'versions');
}

export function versionPath(dataDir: string, id: string, version: number): string {
  return path.join(versionsDir(dataDir, id), `${version}.txt`);
}

export function commentsPath(dataDir: string, id: string): string {
  return path.join(documentDir(dataDir, id), 'comments.json');
}

/**
 * Atomically write `data` to `target`: write to a unique temp file in the same
 * directory, fsync it, then rename() over the target. rename() is atomic on the
 * same filesystem, so a reader sees either the old file or the fully-written
 * new one — never a partial write.
 */
export async function atomicWrite(target: string, data: string): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.tmp-${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2)}`,
  );
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(data, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, target);
}

/** Read + JSON.parse a file, or `null` if it does not exist. */
export async function readJsonIfExists<T>(p: string): Promise<T | null> {
  const text = await readTextIfExists(p);
  if (text === null) return null;
  return JSON.parse(text) as T;
}

/** Read a UTF-8 file, or `null` if it does not exist. */
export async function readTextIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
