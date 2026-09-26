import type { DocumentRepository } from './repository.js';
import type { CommentStore } from './comments.js';
import type { SearchIndex } from './search.js';
import type { Capabilities } from './capabilities.js';

/** Result of an optional provider health probe. */
export interface ProviderHealth {
  /** False when the backing store is unreachable or refusing work. */
  readonly healthy: boolean;
  /** Short human-readable detail, shown by `/healthz` and `agentdocstore doctor`. */
  readonly detail?: string;
}

/**
 * A storage backend: the composition of a repository, comment store, search
 * index, and a static capabilities descriptor. Concrete providers
 * (filesystem, in-memory, or a fork's S3/DDB/Postgres) implement this.
 */
export interface Provider {
  readonly repository: DocumentRepository;
  readonly comments: CommentStore;
  readonly search: SearchIndex;
  readonly capabilities: Capabilities;
  /**
   * Optional liveness probe for a store that can be down independently of this
   * process (a database, an object store). Omit it for a local provider whose
   * health is implied by successful construction. When present it is surfaced
   * on `/healthz`, so it MUST be cheap and MUST NOT throw — report
   * `{ healthy: false, detail }` instead.
   */
  healthCheck?(): Promise<ProviderHealth>;
  /** Release any held resources (locks, file handles, timers). */
  close(): Promise<void>;
}
