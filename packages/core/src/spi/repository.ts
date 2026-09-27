import type { Document, Language, Visibility } from '../model/document.js';
import type { DocumentVersion } from '../model/version.js';

/** Input to create a new doc (with its initial version content). */
export interface CreateDocumentInput {
  readonly title: string;
  readonly language: Language;
  readonly visibility: Visibility;
  /** Initial version-1 content. */
  readonly content: string;
  readonly createdBy: string;
  /** Optional ISO-8601 expiry. */
  readonly expiresAt?: string;
}

/** Partial metadata update. `expiresAt: null` clears an existing expiry. */
export interface UpdateMetaInput {
  readonly title?: string;
  readonly language?: Language;
  readonly expiresAt?: string | null;
}

/** Input to append a new immutable version under optimistic concurrency (CAS). */
export interface AppendVersionInput {
  readonly content: string;
  readonly editedBy: string;
  /** Optional edit note, stored on the new version as `message`. */
  readonly message?: string;
  /** CAS guard: the version the caller believes is current. */
  readonly expect: { readonly latestVersion: number };
}

/** Opaque forward-cursor pagination request. */
export interface ListQuery {
  readonly limit?: number;
  readonly cursor?: string;
}

/** A page of results with an optional continuation cursor. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

/**
 * Storage of documents and their immutable versions.
 *
 * Contract highlights:
 * - `appendVersion` MUST throw {@link VersionConflictError} when
 *   `expect.latestVersion` does not match the stored latest (CAS).
 * - Reads for an unknown OR malformed id return `null`/empty rather than throw.
 * - Mutations for an unknown id throw {@link NotFoundError}.
 */
export interface DocumentRepository {
  create(input: CreateDocumentInput): Promise<Document>;
  get(id: string): Promise<Document | null>;
  getVersion(id: string, version: number): Promise<DocumentVersion | null>;
  listVersions(id: string): Promise<readonly DocumentVersion[]>;
  appendVersion(id: string, input: AppendVersionInput): Promise<Document>;
  updateMeta(id: string, meta: UpdateMetaInput): Promise<Document>;
  setVisibility(id: string, visibility: Visibility): Promise<Document>;
  delete(id: string): Promise<void>;
  /** List documents owned by `owner`, newest first. */
  listByOwner(owner: string, query?: ListQuery): Promise<Page<Document>>;
  /** Ids of documents whose `expiresAt` is at or before `nowIso` (sweep target). */
  listExpired(nowIso: string, limit: number): Promise<readonly string[]>;
}
