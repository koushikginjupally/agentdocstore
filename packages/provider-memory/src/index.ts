/**
 * In-memory {@link Provider}. Suitable for tests and `--ephemeral` server mode.
 * All state lives in plain Maps and is discarded on {@link close}.
 */

import {
  ContentTooLargeError,
  CoreSearchIndex,
  isValidId,
  LIMITS,
  newId,
  NotFoundError,
  ValidationError,
  VersionConflictError,
} from '@agentdocstore/core';
import type {
  AddCommentInput,
  AppendVersionInput,
  Document,
  DocumentRepository,
  DocumentVersion,
  Capabilities,
  Comment,
  CommentStore,
  CreateDocumentInput,
  ListQuery,
  Page,
  Provider,
  SearchIndex,
  UpdateMetaInput,
  Visibility,
} from '@agentdocstore/core';

// ---------------------------------------------------------------------------
// Validation helpers (match the fs provider's approach)
// ---------------------------------------------------------------------------

function assertValidId(id: string): void {
  if (!isValidId(id)) throw new NotFoundError('Document not found');
}

function validateTitle(title: string): void {
  if (title.trim().length === 0) throw new ValidationError('Title must not be empty');
  if (Buffer.byteLength(title, 'utf8') > LIMITS.MAX_TITLE_BYTES) {
    throw new ValidationError('Title exceeds maximum length');
  }
}

function validateContent(content: string): void {
  const size = Buffer.byteLength(content, 'utf8');
  if (size > LIMITS.MAX_CONTENT_BYTES) {
    throw new ContentTooLargeError('Content exceeds size cap', LIMITS.MAX_CONTENT_BYTES, size);
  }
}

// ---------------------------------------------------------------------------
// Internal stored shapes (immutable snapshots — callers never share references)
// ---------------------------------------------------------------------------

interface StoredDocument {
  readonly doc: Document;
  readonly versions: readonly DocumentVersion[];
}

function cloneDocument(doc: Document): Document {
  return { ...doc };
}

function cloneVersion(v: DocumentVersion): DocumentVersion {
  return { ...v };
}

function cloneComment(c: Comment): Comment {
  return { ...c };
}

// ---------------------------------------------------------------------------
// MemoryDocumentRepository
// ---------------------------------------------------------------------------

class MemoryDocumentRepository implements DocumentRepository {
  /** id → stored doc + versions */
  private readonly documents = new Map<string, StoredDocument>();
  private readonly search: SearchIndex;

  constructor(search: SearchIndex) {
    this.search = search;
  }

  async create(input: CreateDocumentInput): Promise<Document> {
    validateTitle(input.title);
    validateContent(input.content);

    const id = newId();
    const now = new Date().toISOString();

    const doc: Document = {
      id,
      title: input.title,
      language: input.language,
      visibility: input.visibility,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      latestVersion: 1,
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    };

    const version: DocumentVersion = {
      documentId: id,
      version: 1,
      content: input.content,
      createdBy: input.createdBy,
      createdAt: now,
    };

    this.documents.set(id, { doc, versions: [version] });
    this.indexDocument(doc, input.content);
    return cloneDocument(doc);
  }

  async get(id: string): Promise<Document | null> {
    if (!isValidId(id)) return null;
    const stored = this.documents.get(id);
    return stored !== undefined ? cloneDocument(stored.doc) : null;
  }

  async getVersion(id: string, version: number): Promise<DocumentVersion | null> {
    if (!isValidId(id)) return null;
    const stored = this.documents.get(id);
    if (stored === undefined) return null;
    const v = stored.versions.find((v) => v.version === version);
    return v !== undefined ? cloneVersion(v) : null;
  }

  async listVersions(id: string): Promise<readonly DocumentVersion[]> {
    if (!isValidId(id)) return [];
    const stored = this.documents.get(id);
    if (stored === undefined) return [];
    return stored.versions.map(cloneVersion);
  }

  async appendVersion(id: string, input: AppendVersionInput): Promise<Document> {
    assertValidId(id);
    validateContent(input.content);

    const stored = this.documents.get(id);
    if (stored === undefined) throw new NotFoundError(`Document '${id}' not found`);

    if (stored.doc.latestVersion !== input.expect.latestVersion) {
      throw new VersionConflictError(
        'Stale latestVersion',
        input.expect.latestVersion,
        stored.doc.latestVersion,
      );
    }

    const next = stored.doc.latestVersion + 1;
    const now = new Date().toISOString();

    const version: DocumentVersion = {
      documentId: id,
      version: next,
      content: input.content,
      createdBy: input.editedBy,
      createdAt: now,
    };

    const doc: Document = { ...stored.doc, latestVersion: next, updatedAt: now };
    this.documents.set(id, { doc, versions: [...stored.versions, version] });
    this.indexDocument(doc, input.content);
    return cloneDocument(doc);
  }

  async updateMeta(id: string, meta: UpdateMetaInput): Promise<Document> {
    assertValidId(id);
    if (meta.title !== undefined) validateTitle(meta.title);

    const stored = this.documents.get(id);
    if (stored === undefined) throw new NotFoundError(`Document '${id}' not found`);

    const now = new Date().toISOString();
    const base: Document = {
      ...stored.doc,
      ...(meta.title !== undefined ? { title: meta.title } : {}),
      ...(meta.language !== undefined ? { language: meta.language } : {}),
      updatedAt: now,
    };
    const doc = applyExpiry(base, meta.expiresAt);
    this.documents.set(id, { doc, versions: stored.versions });

    // Re-index with latest version content for title updates.
    const latest = stored.versions.find((v) => v.version === doc.latestVersion);
    this.indexDocument(doc, latest?.content ?? '');
    return cloneDocument(doc);
  }

  async setVisibility(id: string, visibility: Visibility): Promise<Document> {
    assertValidId(id);

    const stored = this.documents.get(id);
    if (stored === undefined) throw new NotFoundError(`Document '${id}' not found`);

    const doc: Document = { ...stored.doc, visibility, updatedAt: new Date().toISOString() };
    this.documents.set(id, { doc, versions: stored.versions });

    const latest = stored.versions.find((v) => v.version === doc.latestVersion);
    this.indexDocument(doc, latest?.content ?? '');
    return cloneDocument(doc);
  }

  async delete(id: string): Promise<void> {
    assertValidId(id);
    if (!this.documents.has(id)) throw new NotFoundError(`Document '${id}' not found`);
    this.documents.delete(id);
    this.search.remove(id);
  }

  async listByOwner(owner: string, query?: ListQuery): Promise<Page<Document>> {
    const owned: Document[] = [];
    for (const stored of this.documents.values()) {
      if (stored.doc.createdBy === owner) owned.push(stored.doc);
    }

    // Newest first; tie-break on id for total ordering.
    owned.sort((a, b) =>
      a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? 1 : -1,
    );

    const limit = query?.limit ?? 50;
    const cursor = query?.cursor;

    // Decode cursor: find the entry AFTER the cursor id.
    const start =
      cursor !== undefined ? Math.max(0, owned.findIndex((b) => b.id === cursor) + 1) : 0;

    const items = owned.slice(start, start + limit).map(cloneDocument);
    const last = items[items.length - 1];
    const nextCursor = start + limit < owned.length && last !== undefined ? last.id : undefined;
    return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
  }

  async listExpired(nowIso: string, limit: number): Promise<readonly string[]> {
    const expired: string[] = [];
    for (const stored of this.documents.values()) {
      if (expired.length >= limit) break;
      const exp = stored.doc.expiresAt;
      if (exp !== undefined && exp <= nowIso) expired.push(stored.doc.id);
    }
    return expired;
  }

  /** Clear all stored data (called by provider.close). */
  clear(): void {
    this.documents.clear();
  }

  /** Delete comments for a doc (called from cascading delete). */
  hasDocument(id: string): boolean {
    return this.documents.has(id);
  }

  private indexDocument(doc: Document, content: string): void {
    this.search.update({
      documentId: doc.id,
      owner: doc.createdBy,
      visibility: doc.visibility,
      title: doc.title,
      content,
      ...(doc.expiresAt !== undefined ? { expiresAt: doc.expiresAt } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// MemoryCommentStore
// ---------------------------------------------------------------------------

class MemoryCommentStore implements CommentStore {
  /** documentId → comment list */
  private readonly store = new Map<string, Comment[]>();
  private readonly repo: MemoryDocumentRepository;

  constructor(repo: MemoryDocumentRepository) {
    this.repo = repo;
  }

  async add(documentId: string, input: AddCommentInput): Promise<Comment> {
    assertValidId(documentId);
    if (input.body.trim().length === 0) {
      throw new ValidationError('Comment body must not be empty');
    }
    if (Buffer.byteLength(input.body, 'utf8') > LIMITS.MAX_COMMENT_BYTES) {
      throw new ValidationError('Comment exceeds maximum length');
    }
    if (!this.repo.hasDocument(documentId))
      throw new NotFoundError(`Document '${documentId}' not found`);

    const now = new Date().toISOString();
    const comment: Comment = {
      id: newId(),
      documentId,
      author: input.author,
      body: input.body,
      resolved: false,
      createdAt: now,
      updatedAt: now,
    };

    const list = this.store.get(documentId) ?? [];
    list.push(comment);
    this.store.set(documentId, list);
    return cloneComment(comment);
  }

  async list(documentId: string): Promise<readonly Comment[]> {
    if (!isValidId(documentId)) return [];
    const list = this.store.get(documentId);
    return list !== undefined ? list.map(cloneComment) : [];
  }

  async setResolved(documentId: string, commentId: string, resolved: boolean): Promise<Comment> {
    assertValidId(documentId);
    const list = this.store.get(documentId);
    if (list === undefined) throw new NotFoundError('Comment not found');

    const idx = list.findIndex((c) => c.id === commentId);
    if (idx === -1) throw new NotFoundError('Comment not found');

    const existing = list[idx]!;
    const updated: Comment = { ...existing, resolved, updatedAt: new Date().toISOString() };
    list[idx] = updated;
    return cloneComment(updated);
  }

  async delete(documentId: string, commentId: string): Promise<void> {
    assertValidId(documentId);
    const list = this.store.get(documentId);
    if (list === undefined) throw new NotFoundError('Comment not found');

    const next = list.filter((c) => c.id !== commentId);
    if (next.length === list.length) throw new NotFoundError('Comment not found');
    this.store.set(documentId, next);
  }

  /** Remove all comments for a doc (cascading delete). */
  removeAllForDocument(documentId: string): void {
    this.store.delete(documentId);
  }

  /** Clear all stored data (called by provider.close). */
  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// MemoryProvider
// ---------------------------------------------------------------------------

/**
 * In-memory {@link Provider}. All state is held in Maps and discarded on
 * {@link close}. Used for tests and the `--ephemeral` server mode.
 */
export class MemoryProvider implements Provider {
  readonly repository: MemoryDocumentRepository;
  readonly comments: MemoryCommentStore;
  readonly search: CoreSearchIndex;
  readonly capabilities: Capabilities = {
    search: 'core-fallback',
    nativeTtl: false,
    atomicVersioning: true,
    requiresNetwork: false,
  };

  constructor() {
    this.search = new CoreSearchIndex();
    this.repository = new MemoryDocumentRepository(this.search);
    this.comments = new MemoryCommentStore(this.repository);
  }

  async close(): Promise<void> {
    this.repository.clear();
    this.comments.clear();
    this.search.clear();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an in-memory {@link Provider}.
 *
 * ```ts
 * const provider = createMemoryProvider();
 * // ... use provider.repository, provider.comments, provider.search ...
 * await provider.close();
 * ```
 */
export function createMemoryProvider(): Provider {
  return new CascadingMemoryProvider();
}

/**
 * Internal subclass that wires cascading delete (doc deletion removes
 * comments + search entry) without monkey-patching.
 */
class CascadingMemoryProvider extends MemoryProvider {
  private readonly _repo: MemoryDocumentRepository;
  private readonly _comments: MemoryCommentStore;
  private readonly _search: CoreSearchIndex;

  constructor() {
    super();
    this._repo = this.repository;
    this._comments = this.comments;
    this._search = this.search;

    // Replace repository.delete with a cascading version.
    const repo = this._repo;
    const comments = this._comments;

    const origRepoDelete = repo.delete.bind(repo);
    repo.delete = async (id: string): Promise<void> => {
      await origRepoDelete(id);
      comments.removeAllForDocument(id);
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyExpiry(doc: Document, expiresAt: string | null | undefined): Document {
  if (expiresAt === undefined) return doc;
  if (expiresAt === null) {
    const { expiresAt: _drop, ...rest } = doc;
    return rest;
  }
  return { ...doc, expiresAt };
}
