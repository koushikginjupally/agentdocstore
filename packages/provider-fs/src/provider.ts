import * as os from 'node:os';
import * as path from 'node:path';
import { CoreSearchIndex } from '@agentdocstore/core';
import type { Capabilities, Provider } from '@agentdocstore/core';
import { atomicWrite, indexSnapshotPath, readTextIfExists } from './layout.js';
import { acquireBootLock, KeyedMutex } from './lock.js';
import type { BootLock } from './lock.js';
import { FsDocumentRepository } from './repository.js';
import { FsCommentStore } from './comments.js';

/** Options for {@link createFsProvider}. */
export interface FsProviderOptions {
  /** Data directory root. Defaults to {@link DEFAULT_DATA_DIR}. */
  readonly dataDir?: string;
}

/** Default data directory: `~/.agentdocstore/data`. */
export const DEFAULT_DATA_DIR = path.join(os.homedir(), '.agentdocstore', 'data');

/**
 * Filesystem {@link Provider}. Persists documents under a data dir, uses the core
 * MiniSearch fallback for search (snapshotting it to `index/snapshot.json` and
 * rebuilding from the store on boot if the snapshot is missing or corrupt), and
 * holds an advisory boot lock so two instances never share one data dir.
 */
export class FsProvider implements Provider {
  readonly repository: FsDocumentRepository;
  readonly comments: FsCommentStore;
  readonly search: CoreSearchIndex;
  readonly capabilities: Capabilities = {
    search: 'core-fallback',
    nativeTtl: false,
    atomicVersioning: true,
    requiresNetwork: false,
  };

  private constructor(
    private readonly dataDir: string,
    private readonly bootLock: BootLock,
  ) {
    this.search = new CoreSearchIndex();
    const mutex = new KeyedMutex();
    this.repository = new FsDocumentRepository(dataDir, mutex, this.search, () =>
      this.persistIndex(),
    );
    this.comments = new FsCommentStore(dataDir, mutex);
  }

  /** Open (or create) a provider rooted at `opts.dataDir`, acquiring the boot lock. */
  static async create(opts: FsProviderOptions = {}): Promise<FsProvider> {
    const dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
    const bootLock = await acquireBootLock(dataDir);
    try {
      const provider = new FsProvider(dataDir, bootLock);
      await provider.loadOrRebuildIndex();
      return provider;
    } catch (err) {
      await bootLock.release();
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.persistIndex().catch(() => undefined);
    await this.bootLock.release();
  }

  private async persistIndex(): Promise<void> {
    await atomicWrite(indexSnapshotPath(this.dataDir), this.search.snapshot());
  }

  private async loadOrRebuildIndex(): Promise<void> {
    const snapshot = await readTextIfExists(indexSnapshotPath(this.dataDir));
    if (snapshot !== null) {
      try {
        this.search.restore(snapshot);
        return;
      } catch {
        // Corrupt snapshot — fall through to a full rebuild from the store.
      }
    }
    await this.rebuildIndex();
  }

  private async rebuildIndex(): Promise<void> {
    this.search.clear();
    for await (const doc of this.repository.iterateAllDocuments()) {
      const latest = await this.repository.getVersion(doc.id, doc.latestVersion);
      this.search.update({
        documentId: doc.id,
        owner: doc.createdBy,
        visibility: doc.visibility,
        title: doc.title,
        content: latest?.content ?? '',
      });
    }
    await this.persistIndex();
  }
}

/** Create a filesystem-backed {@link Provider}. */
export async function createFsProvider(opts: FsProviderOptions = {}): Promise<Provider> {
  return FsProvider.create(opts);
}
