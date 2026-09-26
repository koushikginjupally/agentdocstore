import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Serializes async critical sections per key (doc id). In-process only — it
 * guarantees writes to the same doc from this process do not interleave. The
 * cross-process guarantee is the boot lock below.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    // Run fn once prev settles, regardless of whether prev resolved or rejected.
    const result = prev.then(fn, fn);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

/** A held boot lock; call {@link release} to free the data dir. */
export interface BootLock {
  release(): Promise<void>;
}

/**
 * Acquire an advisory lock on `dataDir` by atomically creating a lock
 * directory. `mkdir` is atomic and fails with EEXIST if the directory already
 * exists, so at most one process holds the lock at a time. This is advisory:
 * it protects against a second AgentDocStore instance on the same data dir, not
 * against manual tampering.
 */
export async function acquireBootLock(dataDir: string): Promise<BootLock> {
  await fs.mkdir(dataDir, { recursive: true });
  const lockDir = path.join(dataDir, '.agentdocstore.lock');
  try {
    await fs.mkdir(lockDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        `AgentDocStore data dir '${dataDir}' is already locked (${lockDir}). ` +
          'Another instance may be running; if not, remove that lock directory.',
        { cause: err },
      );
    }
    throw err;
  }
  try {
    await fs.writeFile(path.join(lockDir, 'pid'), `${process.pid}\n`, 'utf8');
  } catch {
    // pid file is purely informational; ignore failures.
  }

  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      await fs.rm(lockDir, { recursive: true, force: true });
    },
  };
}
