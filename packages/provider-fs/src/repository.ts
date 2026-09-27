import { promises as fs } from 'node:fs';
import {
  ContentTooLargeError,
  isValidId,
  LIMITS,
  newId,
  NotFoundError,
  sizeOverLimit,
  ValidationError,
  VersionConflictError,
} from '@agentdocstore/core';
import type {
  AppendVersionInput,
  Document,
  DocumentRepository,
  DocumentVersion,
  CreateDocumentInput,
  ListQuery,
  Page,
  SearchIndex,
  UpdateMetaInput,
  Visibility,
} from '@agentdocstore/core';
import {
  atomicWrite,
  documentDir,
  documentsDir,
  metaPath,
  readJsonIfExists,
  versionPath,
  versionsDir,
} from './layout.js';
import type { KeyedMutex } from './lock.js';

interface VersionMeta {
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly message?: string;
}

/** The full on-disk meta.json shape for one doc. */
interface StoredMeta {
  readonly doc: Document;
  readonly versions: readonly VersionMeta[];
}

/**
 * Filesystem-backed {@link DocumentRepository}.
 *
 * Durability: every mutation goes through {@link KeyedMutex} per doc, writes the
 * version content BEFORE the meta.json pointer, and commits both via atomic
 * temp-write+rename. The injected {@link SearchIndex} is kept in sync and its
 * snapshot persisted after each change.
 */
export class FsDocumentRepository implements DocumentRepository {
  constructor(
    private readonly dataDir: string,
    private readonly mutex: KeyedMutex,
    private readonly search: SearchIndex,
    private readonly persistIndex: () => Promise<void>,
  ) {}

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
    return this.mutex.run(id, async () => {
      await fs.mkdir(versionsDir(this.dataDir, id), { recursive: true });
      // Content BEFORE pointer: the version file must exist before meta names it.
      await atomicWrite(versionPath(this.dataDir, id, 1), input.content);
      const meta: StoredMeta = {
        doc,
        versions: [{ version: 1, createdBy: input.createdBy, createdAt: now }],
      };
      await atomicWrite(metaPath(this.dataDir, id), serialize(meta));
      this.index(doc, input.content);
      await this.persistIndex();
      return doc;
    });
  }

  async get(id: string): Promise<Document | null> {
    if (!isValidId(id)) return null;
    const meta = await this.readMeta(id);
    return meta?.doc ?? null;
  }

  async getVersion(id: string, version: number): Promise<DocumentVersion | null> {
    if (!isValidId(id)) return null;
    const meta = await this.readMeta(id);
    if (meta === null) return null;
    const vm = meta.versions.find((v) => v.version === version);
    if (vm === undefined) return null;
    const content = await this.readVersion(id, version);
    if (content === null) return null;
    return {
      documentId: id,
      version,
      content,
      createdBy: vm.createdBy,
      createdAt: vm.createdAt,
      ...(vm.message !== undefined ? { message: vm.message } : {}),
    };
  }

  async listVersions(id: string): Promise<readonly DocumentVersion[]> {
    if (!isValidId(id)) return [];
    const meta = await this.readMeta(id);
    if (meta === null) return [];
    const out: DocumentVersion[] = [];
    for (const vm of meta.versions) {
      const content = await this.readVersion(id, vm.version);
      out.push({
        documentId: id,
        version: vm.version,
        content: content ?? '',
        createdBy: vm.createdBy,
        createdAt: vm.createdAt,
        ...(vm.message !== undefined ? { message: vm.message } : {}),
      });
    }
    return out;
  }

  async appendVersion(id: string, input: AppendVersionInput): Promise<Document> {
    assertValidId(id);
    validateContent(input.content);
    return this.mutex.run(id, async () => {
      const meta = await this.readMeta(id);
      if (meta === null) throw new NotFoundError(`Document '${id}' not found`);
      if (meta.doc.latestVersion !== input.expect.latestVersion) {
        throw new VersionConflictError(
          'Stale latestVersion',
          input.expect.latestVersion,
          meta.doc.latestVersion,
        );
      }
      const next = meta.doc.latestVersion + 1;
      const now = new Date().toISOString();
      // Content BEFORE pointer.
      await atomicWrite(versionPath(this.dataDir, id, next), input.content);
      const doc: Document = { ...meta.doc, latestVersion: next, updatedAt: now };
      const updated: StoredMeta = {
        doc,
        versions: [
          ...meta.versions,
          {
            version: next,
            createdBy: input.editedBy,
            createdAt: now,
            ...(input.message !== undefined ? { message: input.message } : {}),
          },
        ],
      };
      await atomicWrite(metaPath(this.dataDir, id), serialize(updated));
      this.index(doc, input.content);
      await this.persistIndex();
      return doc;
    });
  }

  async updateMeta(id: string, patch: UpdateMetaInput): Promise<Document> {
    assertValidId(id);
    if (patch.title !== undefined) validateTitle(patch.title);
    return this.mutex.run(id, async () => {
      const meta = await this.readMeta(id);
      if (meta === null) throw new NotFoundError(`Document '${id}' not found`);
      const now = new Date().toISOString();
      const base: Document = {
        ...meta.doc,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.language !== undefined ? { language: patch.language } : {}),
        updatedAt: now,
      };
      const doc = applyExpiry(base, patch.expiresAt);
      await atomicWrite(metaPath(this.dataDir, id), serialize({ doc, versions: meta.versions }));
      await this.reindexLatest(doc);
      await this.persistIndex();
      return doc;
    });
  }

  async setVisibility(id: string, visibility: Visibility): Promise<Document> {
    assertValidId(id);
    return this.mutex.run(id, async () => {
      const meta = await this.readMeta(id);
      if (meta === null) throw new NotFoundError(`Document '${id}' not found`);
      const doc: Document = { ...meta.doc, visibility, updatedAt: new Date().toISOString() };
      await atomicWrite(metaPath(this.dataDir, id), serialize({ doc, versions: meta.versions }));
      await this.reindexLatest(doc);
      await this.persistIndex();
      return doc;
    });
  }

  async delete(id: string): Promise<void> {
    assertValidId(id);
    await this.mutex.run(id, async () => {
      // Existence must be checked explicitly: `fs.rm(force: true)` swallows
      // ENOENT, which would make deleting an absent doc succeed silently. The
      // contract requires NotFoundError for mutations on an unknown id.
      const meta = await this.readMeta(id);
      if (meta === null) throw new NotFoundError(`Document '${id}' not found`);
      await fs.rm(documentDir(this.dataDir, id), { recursive: true, force: true });
      this.search.remove(id);
      await this.persistIndex();
    });
  }

  async listByOwner(owner: string, query?: ListQuery): Promise<Page<Document>> {
    const documents: Document[] = [];
    for (const id of await this.allDocumentIds()) {
      const meta = await this.readMeta(id);
      if (meta !== null && meta.doc.createdBy === owner) documents.push(meta.doc);
    }
    // Newest first, stable by id.
    documents.sort((a, b) =>
      a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? 1 : -1,
    );
    const limit = query?.limit ?? 50;
    const cursor = query?.cursor;
    const start =
      cursor !== undefined ? Math.max(0, documents.findIndex((b) => b.id === cursor) + 1) : 0;
    const items = documents.slice(start, start + limit);
    const last = items[items.length - 1];
    const nextCursor = start + limit < documents.length && last !== undefined ? last.id : undefined;
    return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
  }

  async listExpired(nowIso: string, limit: number): Promise<readonly string[]> {
    const expired: string[] = [];
    for (const id of await this.allDocumentIds()) {
      if (expired.length >= limit) break;
      const meta = await this.readMeta(id);
      const exp = meta?.doc.expiresAt;
      if (meta !== null && exp !== undefined && exp <= nowIso) expired.push(id);
    }
    return expired;
  }

  /** Iterate every stored doc (used to rebuild the search index on boot). */
  async *iterateAllDocuments(): AsyncGenerator<Document> {
    for (const id of await this.allDocumentIds()) {
      const meta = await this.readMeta(id);
      if (meta !== null) yield meta.doc;
    }
  }

  private index(doc: Document, content: string): void {
    this.search.update({
      documentId: doc.id,
      owner: doc.createdBy,
      visibility: doc.visibility,
      title: doc.title,
      content,
      ...(doc.expiresAt !== undefined ? { expiresAt: doc.expiresAt } : {}),
    });
  }

  private async reindexLatest(doc: Document): Promise<void> {
    const content = await this.readVersion(doc.id, doc.latestVersion);
    this.index(doc, content ?? '');
  }

  private async allDocumentIds(): Promise<string[]> {
    try {
      const entries = await fs.readdir(documentsDir(this.dataDir), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory() && isValidId(e.name)).map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  private async readMeta(id: string): Promise<StoredMeta | null> {
    return readJsonIfExists<StoredMeta>(metaPath(this.dataDir, id));
  }

  private async readVersion(id: string, version: number): Promise<string | null> {
    try {
      return await fs.readFile(versionPath(this.dataDir, id, version), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
}

function serialize(meta: StoredMeta): string {
  return JSON.stringify(meta, null, 2);
}

function applyExpiry(doc: Document, expiresAt: string | null | undefined): Document {
  if (expiresAt === undefined) return doc;
  if (expiresAt === null) {
    const { expiresAt: _drop, ...rest } = doc;
    return rest;
  }
  return { ...doc, expiresAt };
}

function assertValidId(id: string): void {
  if (!isValidId(id)) throw new NotFoundError('Document not found');
}

function validateTitle(title: string): void {
  if (title.trim().length === 0) throw new ValidationError('Title must not be empty');
  const size = Buffer.byteLength(title, 'utf8');
  if (size > LIMITS.MAX_TITLE_BYTES) {
    throw new ValidationError(
      `Title exceeds maximum length (${sizeOverLimit(size, LIMITS.MAX_TITLE_BYTES)})`,
    );
  }
}

function validateContent(content: string): void {
  const size = Buffer.byteLength(content, 'utf8');
  if (size > LIMITS.MAX_CONTENT_BYTES) {
    throw new ContentTooLargeError(
      `Content exceeds size cap (${sizeOverLimit(size, LIMITS.MAX_CONTENT_BYTES)})`,
      LIMITS.MAX_CONTENT_BYTES,
      size,
    );
  }
}
