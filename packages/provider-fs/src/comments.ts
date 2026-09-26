import { isValidId, LIMITS, newId, NotFoundError, ValidationError } from '@agentdocstore/core';
import type { AddCommentInput, Comment, CommentStore } from '@agentdocstore/core';
import { atomicWrite, commentsPath, metaPath, readJsonIfExists } from './layout.js';
import type { KeyedMutex } from './lock.js';

/** Filesystem-backed {@link CommentStore}; one JSON array per doc. */
export class FsCommentStore implements CommentStore {
  constructor(
    private readonly dataDir: string,
    private readonly mutex: KeyedMutex,
  ) {}

  async add(documentId: string, input: AddCommentInput): Promise<Comment> {
    assertValidId(documentId);
    if (input.body.trim().length === 0) {
      throw new ValidationError('Comment body must not be empty');
    }
    if (Buffer.byteLength(input.body, 'utf8') > LIMITS.MAX_COMMENT_BYTES) {
      throw new ValidationError('Comment exceeds maximum length');
    }
    return this.mutex.run(documentId, async () => {
      await this.assertDocumentExists(documentId);
      const list = await this.read(documentId);
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
      list.push(comment);
      await this.write(documentId, list);
      return comment;
    });
  }

  async list(documentId: string): Promise<readonly Comment[]> {
    if (!isValidId(documentId)) return [];
    return this.read(documentId);
  }

  async setResolved(documentId: string, commentId: string, resolved: boolean): Promise<Comment> {
    assertValidId(documentId);
    return this.mutex.run(documentId, async () => {
      const list = await this.read(documentId);
      const idx = list.findIndex((c) => c.id === commentId);
      if (idx === -1) throw new NotFoundError('Comment not found');
      const existing = list[idx];
      if (existing === undefined) throw new NotFoundError('Comment not found');
      const updated: Comment = { ...existing, resolved, updatedAt: new Date().toISOString() };
      list[idx] = updated;
      await this.write(documentId, list);
      return updated;
    });
  }

  async delete(documentId: string, commentId: string): Promise<void> {
    assertValidId(documentId);
    await this.mutex.run(documentId, async () => {
      const list = await this.read(documentId);
      const next = list.filter((c) => c.id !== commentId);
      if (next.length === list.length) throw new NotFoundError('Comment not found');
      await this.write(documentId, next);
    });
  }

  private async read(documentId: string): Promise<Comment[]> {
    return (await readJsonIfExists<Comment[]>(commentsPath(this.dataDir, documentId))) ?? [];
  }

  private async write(documentId: string, list: readonly Comment[]): Promise<void> {
    await atomicWrite(commentsPath(this.dataDir, documentId), JSON.stringify(list, null, 2));
  }

  private async assertDocumentExists(documentId: string): Promise<void> {
    const meta = await readJsonIfExists<unknown>(metaPath(this.dataDir, documentId));
    if (meta === null) throw new NotFoundError(`Document '${documentId}' not found`);
  }
}

function assertValidId(id: string): void {
  if (!isValidId(id)) throw new NotFoundError('Document not found');
}
