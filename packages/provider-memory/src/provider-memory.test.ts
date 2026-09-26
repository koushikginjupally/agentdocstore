import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryProvider, MemoryProvider } from './index.js';
import {
  ContentTooLargeError,
  isValidId,
  LIMITS,
  NotFoundError,
  VersionConflictError,
} from '@agentdocstore/core';
import type { Document, Provider } from '@agentdocstore/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let provider: Provider;

function repo() {
  return provider.repository;
}
function comments() {
  return provider.comments;
}
function search() {
  return provider.search;
}

async function createDocument(
  overrides: Partial<Parameters<typeof repo>['0']> = {},
): Promise<Document> {
  return repo().create({
    title: 'Test Document',
    language: 'plaintext',
    visibility: 'PUBLIC',
    content: 'hello world',
    createdBy: 'alice',
    ...overrides,
  } as Parameters<Provider['repository']['create']>[0]);
}

beforeEach(() => {
  provider = createMemoryProvider();
});

afterEach(async () => {
  await provider.close();
});

// ---------------------------------------------------------------------------
// Basic CRUD
// ---------------------------------------------------------------------------

describe('MemoryDocumentRepository', () => {
  it('creates a doc with a valid id and version 1', async () => {
    const doc = await createDocument();
    expect(isValidId(doc.id)).toBe(true);
    expect(doc.latestVersion).toBe(1);
    expect(doc.title).toBe('Test Document');
    expect(doc.visibility).toBe('PUBLIC');
    expect(doc.createdBy).toBe('alice');
  });

  it('get returns null for unknown id', async () => {
    expect(await repo().get('AAAAAAAAAA')).toBeNull();
  });

  it('get returns null for malformed id', async () => {
    expect(await repo().get('../etc/passwd')).toBeNull();
    expect(await repo().get('')).toBeNull();
  });

  it('getVersion returns null for unknown doc', async () => {
    expect(await repo().getVersion('AAAAAAAAAA', 1)).toBeNull();
  });

  it('getVersion returns null for malformed id', async () => {
    expect(await repo().getVersion('bad!', 1)).toBeNull();
  });

  it('listVersions returns empty for unknown id', async () => {
    expect(await repo().listVersions('AAAAAAAAAA')).toEqual([]);
  });

  it('listVersions returns empty for malformed id', async () => {
    expect(await repo().listVersions('x')).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // CAS conflict
  // -----------------------------------------------------------------------

  describe('appendVersion CAS', () => {
    it('appends when expect matches', async () => {
      const doc = await createDocument();
      const updated = await repo().appendVersion(doc.id, {
        content: 'v2 content',
        editedBy: 'bob',
        expect: { latestVersion: 1 },
      });
      expect(updated.latestVersion).toBe(2);
    });

    it('throws VersionConflictError on stale expect', async () => {
      const doc = await createDocument();
      await repo().appendVersion(doc.id, {
        content: 'v2',
        editedBy: 'bob',
        expect: { latestVersion: 1 },
      });

      await expect(
        repo().appendVersion(doc.id, {
          content: 'v2-conflict',
          editedBy: 'carol',
          expect: { latestVersion: 1 },
        }),
      ).rejects.toThrow(VersionConflictError);
    });

    it('throws NotFoundError for unknown doc', async () => {
      await expect(
        repo().appendVersion('AAAAAAAAAA', {
          content: 'x',
          editedBy: 'bob',
          expect: { latestVersion: 1 },
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // Version immutability
  // -----------------------------------------------------------------------

  describe('version immutability', () => {
    it('stored versions cannot be mutated through returned references', async () => {
      const doc = await createDocument({ content: 'original' });
      const v1a = await repo().getVersion(doc.id, 1);
      expect(v1a).not.toBeNull();

      // Mutate the returned object.
      (v1a as { content: string }).content = 'TAMPERED';

      // Re-fetch: must still be the original.
      const v1b = await repo().getVersion(doc.id, 1);
      expect(v1b!.content).toBe('original');
    });

    it('appending does not change prior version content', async () => {
      const doc = await createDocument({ content: 'v1-content' });
      await repo().appendVersion(doc.id, {
        content: 'v2-content',
        editedBy: 'bob',
        expect: { latestVersion: 1 },
      });

      const v1 = await repo().getVersion(doc.id, 1);
      expect(v1!.content).toBe('v1-content');
      const v2 = await repo().getVersion(doc.id, 2);
      expect(v2!.content).toBe('v2-content');
    });
  });

  // -----------------------------------------------------------------------
  // updateMeta — expiresAt null clears
  // -----------------------------------------------------------------------

  describe('updateMeta', () => {
    it('updates title and language', async () => {
      const doc = await createDocument();
      const updated = await repo().updateMeta(doc.id, {
        title: 'New Title',
        language: 'json',
      });
      expect(updated.title).toBe('New Title');
      expect(updated.language).toBe('json');
    });

    it('expiresAt: null clears the expiry', async () => {
      const doc = await createDocument({ expiresAt: '2099-01-01T00:00:00.000Z' });
      expect(doc.expiresAt).toBe('2099-01-01T00:00:00.000Z');

      const updated = await repo().updateMeta(doc.id, { expiresAt: null });
      expect(updated.expiresAt).toBeUndefined();
      expect('expiresAt' in updated).toBe(false);
    });

    it('expiresAt: undefined leaves expiry unchanged', async () => {
      const doc = await createDocument({ expiresAt: '2099-01-01T00:00:00.000Z' });
      const updated = await repo().updateMeta(doc.id, { title: 'Changed' });
      expect(updated.expiresAt).toBe('2099-01-01T00:00:00.000Z');
    });

    it('throws NotFoundError for unknown doc', async () => {
      await expect(repo().updateMeta('AAAAAAAAAA', { title: 'x' })).rejects.toThrow(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // setVisibility
  // -----------------------------------------------------------------------

  describe('setVisibility', () => {
    it('changes visibility', async () => {
      const doc = await createDocument({ visibility: 'PUBLIC' });
      const updated = await repo().setVisibility(doc.id, 'PRIVATE');
      expect(updated.visibility).toBe('PRIVATE');
    });

    it('throws NotFoundError for unknown doc', async () => {
      await expect(repo().setVisibility('AAAAAAAAAA', 'PRIVATE')).rejects.toThrow(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // Delete cascade
  // -----------------------------------------------------------------------

  describe('delete cascade', () => {
    it('removes doc, versions, comments, and search entry', async () => {
      const doc = await createDocument({ content: 'searchable cascade test' });
      await comments().add(doc.id, { author: 'bob', body: 'nice' });

      // Pre-delete: everything exists.
      expect(await repo().get(doc.id)).not.toBeNull();
      expect(await repo().getVersion(doc.id, 1)).not.toBeNull();
      expect((await comments().list(doc.id)).length).toBe(1);
      expect(search().size()).toBe(1);

      await repo().delete(doc.id);

      // Post-delete: everything gone.
      expect(await repo().get(doc.id)).toBeNull();
      expect(await repo().getVersion(doc.id, 1)).toBeNull();
      expect((await comments().list(doc.id)).length).toBe(0);
      expect(search().size()).toBe(0);
    });

    it('throws NotFoundError for unknown doc', async () => {
      await expect(repo().delete('AAAAAAAAAA')).rejects.toThrow(NotFoundError);
    });
  });

  // -----------------------------------------------------------------------
  // listExpired
  // -----------------------------------------------------------------------

  describe('listExpired', () => {
    it('returns ids whose expiresAt is at or before nowIso', async () => {
      const expired = await createDocument({ expiresAt: '2020-01-01T00:00:00.000Z' });
      const future = await createDocument({ expiresAt: '2099-12-31T23:59:59.999Z' });
      await createDocument(); // no expiry

      const result = await repo().listExpired('2025-06-01T00:00:00.000Z', 100);
      expect(result).toContain(expired.id);
      expect(result).not.toContain(future.id);
    });

    it('respects limit', async () => {
      await createDocument({ expiresAt: '2020-01-01T00:00:00.000Z' });
      await createDocument({ expiresAt: '2020-01-02T00:00:00.000Z' });
      await createDocument({ expiresAt: '2020-01-03T00:00:00.000Z' });

      const result = await repo().listExpired('2025-01-01T00:00:00.000Z', 2);
      expect(result.length).toBe(2);
    });

    it('includes documents whose expiresAt equals nowIso', async () => {
      const doc = await createDocument({ expiresAt: '2025-06-01T00:00:00.000Z' });
      const result = await repo().listExpired('2025-06-01T00:00:00.000Z', 100);
      expect(result).toContain(doc.id);
    });
  });

  // -----------------------------------------------------------------------
  // listByOwner — pagination stability
  // -----------------------------------------------------------------------

  describe('listByOwner pagination', () => {
    it('returns newest first and paginates stably across two pages', async () => {
      // Create 5 documents. We need stable createdAt ordering. Use a small delay
      // trick: manually create with the same timestamp to test tie-breaking.
      const documents: Document[] = [];
      for (let i = 0; i < 5; i++) {
        documents.push(await createDocument({ createdBy: 'owner1' }));
      }

      // Page 1: limit 3
      const page1 = await repo().listByOwner('owner1', { limit: 3 });
      expect(page1.items.length).toBe(3);
      expect(page1.nextCursor).toBeDefined();

      // Page 2: use the cursor
      const page2 = await repo().listByOwner('owner1', {
        limit: 3,
        cursor: page1.nextCursor,
      });
      expect(page2.items.length).toBe(2);
      expect(page2.nextCursor).toBeUndefined();

      // All 5 ids appear exactly once across both pages.
      const allIds = [...page1.items, ...page2.items].map((b) => b.id);
      expect(new Set(allIds).size).toBe(5);

      // The combined ordering is newest-first (or stable tie-break).
      for (let i = 1; i < allIds.length; i++) {
        const prev = [...page1.items, ...page2.items][i - 1]!;
        const curr = [...page1.items, ...page2.items][i]!;
        if (prev.createdAt === curr.createdAt) {
          // Tie-break: lexicographic by id.
          expect(prev.id.localeCompare(curr.id)).toBeLessThanOrEqual(0);
        } else {
          // Newer first.
          expect(prev.createdAt >= curr.createdAt).toBe(true);
        }
      }
    });

    it('returns empty page for unknown owner', async () => {
      const page = await repo().listByOwner('nobody');
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Content size cap
  // -----------------------------------------------------------------------

  describe('write-time size cap', () => {
    it('rejects oversized content on create', async () => {
      const big = 'x'.repeat(LIMITS.MAX_CONTENT_BYTES + 1);
      await expect(createDocument({ content: big })).rejects.toThrow(ContentTooLargeError);
    });

    it('rejects oversized content on appendVersion', async () => {
      const doc = await createDocument();
      const big = 'x'.repeat(LIMITS.MAX_CONTENT_BYTES + 1);
      await expect(
        repo().appendVersion(doc.id, {
          content: big,
          editedBy: 'bob',
          expect: { latestVersion: 1 },
        }),
      ).rejects.toThrow(ContentTooLargeError);
    });
  });
});

// ---------------------------------------------------------------------------
// CommentStore
// ---------------------------------------------------------------------------

describe('MemoryCommentStore', () => {
  it('adds, lists, resolves, and deletes comments', async () => {
    const doc = await createDocument();
    const c = await comments().add(doc.id, { author: 'bob', body: 'looks good' });
    expect(c.documentId).toBe(doc.id);
    expect(c.resolved).toBe(false);

    const list = await comments().list(doc.id);
    expect(list.length).toBe(1);
    expect(list[0]!.body).toBe('looks good');

    const resolved = await comments().setResolved(doc.id, c.id, true);
    expect(resolved.resolved).toBe(true);

    await comments().delete(doc.id, c.id);
    expect((await comments().list(doc.id)).length).toBe(0);
  });

  it('list returns empty for malformed documentId', async () => {
    expect(await comments().list('bad!')).toEqual([]);
  });

  it('throws NotFoundError on add for unknown doc', async () => {
    await expect(comments().add('AAAAAAAAAA', { author: 'x', body: 'y' })).rejects.toThrow(
      NotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// Search: PRIVATE vs PUBLIC visibility
// ---------------------------------------------------------------------------

describe('search visibility', () => {
  it('PUBLIC documents are visible to anyone; PRIVATE only to owner', async () => {
    await createDocument({
      title: 'public searchable item',
      content: 'unique searchable content alpha',
      visibility: 'PUBLIC',
      createdBy: 'alice',
    });
    await createDocument({
      title: 'private searchable item',
      content: 'unique searchable content beta',
      visibility: 'PRIVATE',
      createdBy: 'alice',
    });

    // Owner sees both.
    const ownerResults = search().query('searchable', 'alice');
    expect(ownerResults.total).toBe(2);

    // Stranger sees only the public one.
    const strangerResults = search().query('searchable', 'stranger');
    expect(strangerResults.total).toBe(1);
    expect(strangerResults.hits[0]!.documentId).toBeDefined();

    // Anonymous (null viewer) sees only public.
    const anonResults = search().query('searchable', null);
    expect(anonResults.total).toBe(1);
  });

  it('setVisibility updates search visibility', async () => {
    const doc = await createDocument({
      title: 'visibility test unique content',
      content: 'visibility test body',
      visibility: 'PUBLIC',
      createdBy: 'alice',
    });

    // Stranger can see it initially.
    expect(search().query('visibility test', 'stranger').total).toBe(1);

    // Make it private.
    await repo().setVisibility(doc.id, 'PRIVATE');

    // Stranger can no longer see it.
    expect(search().query('visibility test', 'stranger').total).toBe(0);

    // Owner still can.
    expect(search().query('visibility test', 'alice').total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe('capabilities', () => {
  it('reports core-fallback search, no native TTL, atomic versioning, no network', () => {
    expect(provider.capabilities).toEqual({
      search: 'core-fallback',
      nativeTtl: false,
      atomicVersioning: true,
      requiresNetwork: false,
    });
  });
});

// ---------------------------------------------------------------------------
// close() clears all state
// ---------------------------------------------------------------------------

describe('close', () => {
  it('clears all data', async () => {
    await createDocument({ content: 'will be gone' });
    expect(search().size()).toBe(1);

    await provider.close();

    expect(search().size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe('createMemoryProvider', () => {
  it('returns a Provider', () => {
    const p = createMemoryProvider();
    expect(p.repository).toBeDefined();
    expect(p.comments).toBeDefined();
    expect(p.search).toBeDefined();
    expect(p.capabilities).toBeDefined();
    expect(typeof p.close).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// MemoryProvider export
// ---------------------------------------------------------------------------

describe('MemoryProvider class', () => {
  it('can be instantiated directly', () => {
    const p = new MemoryProvider();
    expect(p.repository).toBeDefined();
  });
});
