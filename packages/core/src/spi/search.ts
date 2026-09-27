import type { Visibility } from '../model/document.js';

/** A document indexed for search. */
export interface SearchDoc {
  readonly documentId: string;
  readonly owner: string;
  readonly visibility: Visibility;
  readonly title: string;
  readonly content: string;
  /**
   * Optional ISO-8601 expiry. An expired entry is excluded from `query` hits
   * and `total` even before the sweep removes it. Optional so existing index
   * writers keep working; they simply get no read-time expiry filtering.
   */
  readonly expiresAt?: string;
}

/** Query pagination options. */
export interface SearchQueryOptions {
  readonly limit?: number;
  readonly offset?: number;
}

/** A single search hit. */
export interface SearchHit {
  readonly documentId: string;
  readonly score: number;
}

/** Search results with the total number of visible matches (pre-pagination). */
export interface SearchResults {
  readonly hits: readonly SearchHit[];
  readonly total: number;
}

/**
 * Full-text index over documents.
 *
 * `query` MUST enforce visibility: it returns PUBLIC hits plus the `viewer`'s
 * own PRIVATE hits, and nothing else. `snapshot`/`restore` allow a provider to
 * persist and reload the index (filesystem provider persists a snapshot and
 * rebuilds it from the store if the snapshot is missing or corrupt).
 */
export interface SearchIndex {
  add(doc: SearchDoc): void;
  update(doc: SearchDoc): void;
  remove(documentId: string): void;
  query(q: string, viewer: string | null, opts?: SearchQueryOptions): SearchResults;
  /** Serialize the whole index to a string. */
  snapshot(): string;
  /** Replace the index contents from a prior {@link snapshot}. */
  restore(snapshot: string): void;
  /** Empty the index. */
  clear(): void;
  /** Number of indexed documents. */
  size(): number;
}
