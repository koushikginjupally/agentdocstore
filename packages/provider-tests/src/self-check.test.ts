/**
 * Self-check: a minimal throwaway in-memory Provider that proves the
 * conformance suite passes against a correct implementation.
 *
 * This file does NOT import @agentdocstore/provider-memory (written by another
 * agent). Everything is local Maps.
 */
import { runProviderConformance } from './conformance.js';
import type {
  Provider,
  DocumentRepository,
  CommentStore,
  Capabilities,
  Document,
  DocumentVersion,
  Comment,
  Visibility,
  CreateDocumentInput,
  AppendVersionInput,
  UpdateMetaInput,
  ListQuery,
  Page,
  AddCommentInput,
} from '@agentdocstore/core';
import {
  VersionConflictError,
  NotFoundError,
  ContentTooLargeError,
  LIMITS,
  newId,
  isValidId,
  CoreSearchIndex,
} from '@agentdocstore/core';

// ---------------------------------------------------------------------------
// Byte-length helper
// ---------------------------------------------------------------------------
const encoder = new TextEncoder();
function byteLen(s: string): number {
  return encoder.encode(s).length;
}

// ---------------------------------------------------------------------------
// In-memory DocumentRepository
// ---------------------------------------------------------------------------
class MemoryDocumentRepository implements DocumentRepository {
  private documents = new Map<string, Document>();
  private versions = new Map<string, DocumentVersion[]>(); // documentId -> versions
  // creation-order index for newest-first listing
  private ownerIndex = new Map<string, string[]>(); // owner -> documentId[]

  async create(input: CreateDocumentInput): Promise<Document> {
    if (byteLen(input.content) > LIMITS.MAX_CONTENT_BYTES) {
      throw new ContentTooLargeError(
        'Content too large',
        LIMITS.MAX_CONTENT_BYTES,
        byteLen(input.content),
      );
    }
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
    this.documents.set(id, doc);

    const v: DocumentVersion = {
      documentId: id,
      version: 1,
      content: input.content,
      createdBy: input.createdBy,
      createdAt: now,
    };
    this.versions.set(id, [v]);

    const owned = this.ownerIndex.get(input.createdBy) ?? [];
    owned.push(id);
    this.ownerIndex.set(input.createdBy, owned);

    return { ...doc };
  }

  async get(id: string): Promise<Document | null> {
    if (!isValidId(id)) return null;
    const doc = this.documents.get(id);
    return doc ? { ...doc } : null;
  }

  async getVersion(id: string, version: number): Promise<DocumentVersion | null> {
    if (!isValidId(id)) return null;
    const versions = this.versions.get(id);
    if (!versions) return null;
    const v = versions.find((vv) => vv.version === version);
    return v ? { ...v } : null;
  }

  async listVersions(id: string): Promise<readonly DocumentVersion[]> {
    if (!isValidId(id)) return [];
    return (this.versions.get(id) ?? []).map((v) => ({ ...v }));
  }

  async appendVersion(id: string, input: AppendVersionInput): Promise<Document> {
    const doc = this.documents.get(id);
    if (!doc) throw new NotFoundError(`Document '${id}' not found`);
    if (byteLen(input.content) > LIMITS.MAX_CONTENT_BYTES) {
      throw new ContentTooLargeError(
        'Content too large',
        LIMITS.MAX_CONTENT_BYTES,
        byteLen(input.content),
      );
    }
    if (input.expect.latestVersion !== doc.latestVersion) {
      throw new VersionConflictError(
        'Version conflict',
        input.expect.latestVersion,
        doc.latestVersion,
      );
    }

    const now = new Date().toISOString();
    const nextVersion = doc.latestVersion + 1;
    const v: DocumentVersion = {
      documentId: id,
      version: nextVersion,
      content: input.content,
      createdBy: input.editedBy,
      createdAt: now,
    };
    this.versions.get(id)!.push(v);

    doc.latestVersion = nextVersion;
    doc.updatedAt = now;
    return { ...doc };
  }

  async updateMeta(id: string, meta: UpdateMetaInput): Promise<Document> {
    const doc = this.documents.get(id);
    if (!doc) throw new NotFoundError(`Document '${id}' not found`);

    if (meta.title !== undefined) doc.title = meta.title;
    if (meta.language !== undefined) doc.language = meta.language;
    // expiresAt: null clears, undefined leaves untouched
    if (meta.expiresAt === null) {
      delete doc.expiresAt;
    } else if (meta.expiresAt !== undefined) {
      doc.expiresAt = meta.expiresAt;
    }
    doc.updatedAt = new Date().toISOString();
    return { ...doc };
  }

  async setVisibility(id: string, visibility: Visibility): Promise<Document> {
    const doc = this.documents.get(id);
    if (!doc) throw new NotFoundError(`Document '${id}' not found`);
    doc.visibility = visibility;
    doc.updatedAt = new Date().toISOString();
    return { ...doc };
  }

  async delete(id: string): Promise<void> {
    if (!this.documents.has(id)) throw new NotFoundError(`Document '${id}' not found`);
    const doc = this.documents.get(id)!;
    this.documents.delete(id);
    this.versions.delete(id);
    // remove from owner index
    const owned = this.ownerIndex.get(doc.createdBy);
    if (owned) {
      const idx = owned.indexOf(id);
      if (idx >= 0) owned.splice(idx, 1);
    }
  }

  async listByOwner(owner: string, query?: ListQuery): Promise<Page<Document>> {
    const owned = this.ownerIndex.get(owner) ?? [];
    // newest first = reverse of insertion order
    const all = [...owned].reverse();

    const limit = query?.limit ?? 50;
    const startIdx = query?.cursor ? parseInt(query.cursor, 10) : 0;
    // If cursor is garbage (NaN), return empty page
    if (Number.isNaN(startIdx)) {
      return { items: [] };
    }

    const slice = all.slice(startIdx, startIdx + limit);
    const items = slice
      .map((id) => this.documents.get(id))
      .filter((b): b is Document => b !== undefined)
      .map((b) => ({ ...b }));

    const nextIdx = startIdx + limit;
    const nextCursor = nextIdx < all.length ? String(nextIdx) : undefined;
    return { items, nextCursor };
  }

  async listExpired(nowIso: string, limit: number): Promise<readonly string[]> {
    const nowMs = new Date(nowIso).getTime();
    const result: string[] = [];
    for (const doc of this.documents.values()) {
      if (result.length >= limit) break;
      if (doc.expiresAt && new Date(doc.expiresAt).getTime() <= nowMs) {
        result.push(doc.id);
      }
    }
    return result;
  }

  /** Used by comment cascade. */
  has(id: string): boolean {
    return this.documents.has(id);
  }
}

// ---------------------------------------------------------------------------
// In-memory CommentStore
// ---------------------------------------------------------------------------
class MemoryCommentStore implements CommentStore {
  // documentId -> Comment[]
  private store = new Map<string, Comment[]>();
  private repo: MemoryDocumentRepository;

  constructor(repo: MemoryDocumentRepository) {
    this.repo = repo;
  }

  async add(documentId: string, input: AddCommentInput): Promise<Comment> {
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
    return { ...comment };
  }

  async list(documentId: string): Promise<readonly Comment[]> {
    // If the doc was deleted, return empty (cascade)
    if (!this.repo.has(documentId)) {
      this.store.delete(documentId);
      return [];
    }
    return (this.store.get(documentId) ?? []).map((c) => ({ ...c }));
  }

  async setResolved(documentId: string, commentId: string, resolved: boolean): Promise<Comment> {
    const list = this.store.get(documentId);
    if (!list) throw new NotFoundError(`Comment not found`);
    const comment = list.find((c) => c.id === commentId);
    if (!comment) throw new NotFoundError(`Comment not found`);
    comment.resolved = resolved;
    comment.updatedAt = new Date().toISOString();
    return { ...comment };
  }

  async delete(documentId: string, commentId: string): Promise<void> {
    const list = this.store.get(documentId);
    if (!list) return;
    const idx = list.findIndex((c) => c.id === commentId);
    if (idx >= 0) list.splice(idx, 1);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
function createSelfCheckProvider(): Provider {
  const repo = new MemoryDocumentRepository();
  const comments = new MemoryCommentStore(repo);
  const search = new CoreSearchIndex();
  const capabilities: Capabilities = {
    search: 'core-fallback',
    nativeTtl: false,
    atomicVersioning: true,
    requiresNetwork: false,
  };
  return {
    repository: repo,
    comments,
    search,
    capabilities,
    async close() {
      /* no-op */
    },
  };
}

// ---------------------------------------------------------------------------
// Run suite
// ---------------------------------------------------------------------------
runProviderConformance('self-check', createSelfCheckProvider);
