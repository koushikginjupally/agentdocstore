/**
 * Reusable provider conformance suite.
 *
 * Call {@link runProviderConformance} from any test file; it registers a full
 * vitest `describe` that exercises every contract clause in the SPI.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Provider, Document, Visibility, ListQuery } from '@agentdocstore/core';
import {
  VersionConflictError,
  NotFoundError,
  ContentTooLargeError,
  LIMITS,
  ID_ALPHABET,
  ID_LENGTH,
  isValidId,
} from '@agentdocstore/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default creation input. */
function defaultInput(
  overrides: Partial<{
    title: string;
    language: string;
    visibility: Visibility;
    content: string;
    createdBy: string;
    expiresAt: string;
  }> = {},
) {
  return {
    title: overrides.title ?? 'Test Document',
    language: (overrides.language ?? 'plaintext') as 'plaintext',
    visibility: (overrides.visibility ?? 'PUBLIC') as Visibility,
    content: overrides.content ?? 'hello world',
    createdBy: overrides.createdBy ?? 'alice',
    ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
  };
}

/** ISO-8601 regex (loose — accepts any valid ISO date-time with or without ms). */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isIso(s: string): boolean {
  return ISO_RE.test(s);
}

/** Byte length of a string in UTF-8. */
function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Collect all items across all pages via listByOwner. */
async function collectAll(
  repo: Provider['repository'],
  owner: string,
  pageSize: number,
): Promise<Document[]> {
  const all: Document[] = [];
  let query: ListQuery = { limit: pageSize };
  for (;;) {
    const page = await repo.listByOwner(owner, query);
    all.push(...page.items);
    if (!page.nextCursor) break;
    query = { limit: pageSize, cursor: page.nextCursor };
  }
  return all;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers a vitest `describe(name, ...)` containing the entire provider
 * conformance suite. A **fresh** provider is created per test via `factory()`
 * and closed afterwards.
 */
export function runProviderConformance(
  name: string,
  factory: () => Provider | Promise<Provider>,
): void {
  describe(name, () => {
    let provider: Provider;

    beforeEach(async () => {
      provider = await factory();
    });

    afterEach(async () => {
      await provider.close();
    });

    // -----------------------------------------------------------------------
    // 1. Document CRUD
    // -----------------------------------------------------------------------
    describe('Document CRUD', () => {
      it('create returns a fully-populated Document with a valid id', async () => {
        const doc = await provider.repository.create(defaultInput());
        expect(isValidId(doc.id)).toBe(true);
        expect(doc.id).toHaveLength(ID_LENGTH);
        // every char from the id alphabet
        for (const ch of doc.id) {
          expect(ID_ALPHABET).toContain(ch);
        }
        expect(doc.title).toBe('Test Document');
        expect(doc.language).toBe('plaintext');
        expect(doc.visibility).toBe('PUBLIC');
        expect(doc.createdBy).toBe('alice');
        expect(doc.latestVersion).toBe(1);
        expect(isIso(doc.createdAt)).toBe(true);
        expect(isIso(doc.updatedAt)).toBe(true);
      });

      it('create sets sizeBytes equal to content byte length', async () => {
        const content = 'hello 🌍'; // multi-byte
        const doc = await provider.repository.create(defaultInput({ content }));
        // sizeBytes may or may not be on the interface; if present, verify it
        if ('sizeBytes' in doc) {
          expect((doc as Record<string, unknown>)['sizeBytes']).toBe(byteLen(content));
        }
      });

      it('get round-trips a created doc', async () => {
        const created = await provider.repository.create(defaultInput());
        const got = await provider.repository.get(created.id);
        expect(got).not.toBeNull();
        expect(got!.id).toBe(created.id);
        expect(got!.title).toBe(created.title);
        expect(got!.language).toBe(created.language);
        expect(got!.visibility).toBe(created.visibility);
        expect(got!.createdBy).toBe(created.createdBy);
        expect(got!.latestVersion).toBe(1);
      });

      it('delete removes the doc so get returns null', async () => {
        const doc = await provider.repository.create(defaultInput());
        await provider.repository.delete(doc.id);
        const got = await provider.repository.get(doc.id);
        expect(got).toBeNull();
      });

      it('getVersion retrieves the initial version after create', async () => {
        const doc = await provider.repository.create(defaultInput({ content: 'v1 content' }));
        const v = await provider.repository.getVersion(doc.id, 1);
        expect(v).not.toBeNull();
        expect(v!.documentId).toBe(doc.id);
        expect(v!.version).toBe(1);
        expect(v!.content).toBe('v1 content');
        expect(v!.createdBy).toBe('alice');
        expect(isIso(v!.createdAt)).toBe(true);
      });

      it('listVersions returns all versions', async () => {
        const doc = await provider.repository.create(defaultInput());
        const versions = await provider.repository.listVersions(doc.id);
        expect(versions).toHaveLength(1);
        expect(versions[0]!.version).toBe(1);
      });
    });

    // -----------------------------------------------------------------------
    // 2. Versioning + CAS
    // -----------------------------------------------------------------------
    describe('Versioning + CAS', () => {
      it('appendVersion increments latestVersion', async () => {
        const doc = await provider.repository.create(defaultInput());
        const updated = await provider.repository.appendVersion(doc.id, {
          content: 'v2',
          editedBy: 'alice',
          expect: { latestVersion: 1 },
        });
        expect(updated.latestVersion).toBe(2);
      });

      it('each appended version is retrievable by number', async () => {
        const doc = await provider.repository.create(defaultInput({ content: 'v1' }));
        await provider.repository.appendVersion(doc.id, {
          content: 'v2',
          editedBy: 'alice',
          expect: { latestVersion: 1 },
        });
        await provider.repository.appendVersion(doc.id, {
          content: 'v3',
          editedBy: 'bob',
          expect: { latestVersion: 2 },
        });

        const ver1 = await provider.repository.getVersion(doc.id, 1);
        const ver2 = await provider.repository.getVersion(doc.id, 2);
        const ver3 = await provider.repository.getVersion(doc.id, 3);
        expect(ver1!.content).toBe('v1');
        expect(ver2!.content).toBe('v2');
        expect(ver3!.content).toBe('v3');
        expect(ver3!.createdBy).toBe('bob');
      });

      it('stores an optional edit message with the version it describes', async () => {
        const doc = await provider.repository.create(defaultInput({ content: 'v1' }));
        await provider.repository.appendVersion(doc.id, {
          content: 'v2',
          editedBy: 'alice',
          message: 'Fix the intro',
          expect: { latestVersion: 1 },
        });
        await provider.repository.appendVersion(doc.id, {
          content: 'v3',
          editedBy: 'alice',
          expect: { latestVersion: 2 },
        });

        expect((await provider.repository.getVersion(doc.id, 2))!.message).toBe('Fix the intro');
        expect((await provider.repository.getVersion(doc.id, 3))!.message).toBeUndefined();
        const all = await provider.repository.listVersions(doc.id);
        expect(all.map((v) => v.message)).toEqual([undefined, 'Fix the intro', undefined]);
      });

      it('stale expect.latestVersion throws VersionConflictError', async () => {
        const doc = await provider.repository.create(defaultInput());
        // advance to version 2
        await provider.repository.appendVersion(doc.id, {
          content: 'v2',
          editedBy: 'alice',
          expect: { latestVersion: 1 },
        });
        // try with stale version 1
        await expect(
          provider.repository.appendVersion(doc.id, {
            content: 'v3-stale',
            editedBy: 'alice',
            expect: { latestVersion: 1 },
          }),
        ).rejects.toThrow(VersionConflictError);
      });

      it('correct expect.latestVersion succeeds after prior conflict', async () => {
        const doc = await provider.repository.create(defaultInput());
        await provider.repository.appendVersion(doc.id, {
          content: 'v2',
          editedBy: 'alice',
          expect: { latestVersion: 1 },
        });
        // stale attempt
        await expect(
          provider.repository.appendVersion(doc.id, {
            content: 'v3-stale',
            editedBy: 'alice',
            expect: { latestVersion: 1 },
          }),
        ).rejects.toThrow(VersionConflictError);
        // correct attempt
        const updated = await provider.repository.appendVersion(doc.id, {
          content: 'v3-good',
          editedBy: 'alice',
          expect: { latestVersion: 2 },
        });
        expect(updated.latestVersion).toBe(3);
      });

      it('immutability: version 1 content unchanged after multiple appends', async () => {
        const originalContent = 'original content preserved';
        const doc = await provider.repository.create(defaultInput({ content: originalContent }));
        await provider.repository.appendVersion(doc.id, {
          content: 'version 2 overwrite',
          editedBy: 'alice',
          expect: { latestVersion: 1 },
        });
        await provider.repository.appendVersion(doc.id, {
          content: 'version 3 overwrite',
          editedBy: 'alice',
          expect: { latestVersion: 2 },
        });
        const v1 = await provider.repository.getVersion(doc.id, 1);
        expect(v1!.content).toBe(originalContent);
      });

      it('listVersions returns all versions after appends', async () => {
        const doc = await provider.repository.create(defaultInput());
        await provider.repository.appendVersion(doc.id, {
          content: 'v2',
          editedBy: 'alice',
          expect: { latestVersion: 1 },
        });
        const versions = await provider.repository.listVersions(doc.id);
        expect(versions).toHaveLength(2);
        const nums = versions.map((v) => v.version).sort();
        expect(nums).toEqual([1, 2]);
      });
    });

    // -----------------------------------------------------------------------
    // 3. Unknown and malformed ids
    // -----------------------------------------------------------------------
    describe('Unknown and malformed ids', () => {
      it('get returns null for a well-formed but absent id', async () => {
        const result = await provider.repository.get('AAAAAAAAAA');
        expect(result).toBeNull();
      });

      it('get returns null for malformed ids', async () => {
        expect(await provider.repository.get('../etc/passwd')).toBeNull();
        expect(await provider.repository.get('')).toBeNull();
        expect(await provider.repository.get('short')).toBeNull();
        expect(await provider.repository.get('has spaces!')).toBeNull();
      });

      it('getVersion returns null for absent doc', async () => {
        expect(await provider.repository.getVersion('AAAAAAAAAA', 1)).toBeNull();
      });

      it('getVersion returns null for malformed id', async () => {
        expect(await provider.repository.getVersion('../etc/passwd', 1)).toBeNull();
      });

      it('listVersions returns empty for absent doc', async () => {
        const versions = await provider.repository.listVersions('AAAAAAAAAA');
        expect(versions).toHaveLength(0);
      });

      it('listVersions returns empty for malformed id', async () => {
        const versions = await provider.repository.listVersions('../etc/passwd');
        expect(versions).toHaveLength(0);
      });

      it('appendVersion throws NotFoundError for absent doc', async () => {
        await expect(
          provider.repository.appendVersion('AAAAAAAAAA', {
            content: 'x',
            editedBy: 'alice',
            expect: { latestVersion: 1 },
          }),
        ).rejects.toThrow(NotFoundError);
      });

      it('updateMeta throws NotFoundError for absent doc', async () => {
        await expect(provider.repository.updateMeta('AAAAAAAAAA', { title: 'x' })).rejects.toThrow(
          NotFoundError,
        );
      });

      it('setVisibility throws NotFoundError for absent doc', async () => {
        await expect(provider.repository.setVisibility('AAAAAAAAAA', 'PRIVATE')).rejects.toThrow(
          NotFoundError,
        );
      });

      it('delete throws NotFoundError for absent doc', async () => {
        await expect(provider.repository.delete('AAAAAAAAAA')).rejects.toThrow(NotFoundError);
      });
    });

    // -----------------------------------------------------------------------
    // 4. Metadata
    // -----------------------------------------------------------------------
    describe('Metadata', () => {
      it('updateMeta changes title', async () => {
        const doc = await provider.repository.create(defaultInput());
        const updated = await provider.repository.updateMeta(doc.id, { title: 'New Title' });
        expect(updated.title).toBe('New Title');
        const got = await provider.repository.get(doc.id);
        expect(got!.title).toBe('New Title');
      });

      it('updateMeta changes language', async () => {
        const doc = await provider.repository.create(defaultInput());
        const updated = await provider.repository.updateMeta(doc.id, { language: 'typescript' });
        expect(updated.language).toBe('typescript');
      });

      it('expiresAt: null clears an existing expiry', async () => {
        const future = new Date(Date.now() + 86400_000).toISOString();
        const doc = await provider.repository.create(defaultInput({ expiresAt: future }));
        expect(doc.expiresAt).toBeDefined();

        const updated = await provider.repository.updateMeta(doc.id, { expiresAt: null });
        expect(updated.expiresAt).toBeUndefined();

        const got = await provider.repository.get(doc.id);
        expect(got!.expiresAt).toBeUndefined();
      });

      it('expiresAt: undefined leaves existing expiry untouched', async () => {
        const future = new Date(Date.now() + 86400_000).toISOString();
        const doc = await provider.repository.create(defaultInput({ expiresAt: future }));
        // update title only, do not pass expiresAt
        const updated = await provider.repository.updateMeta(doc.id, { title: 'Changed' });
        expect(updated.expiresAt).toBe(future);
      });

      it('setVisibility flips PUBLIC to PRIVATE and back', async () => {
        const doc = await provider.repository.create(defaultInput({ visibility: 'PUBLIC' }));
        const priv = await provider.repository.setVisibility(doc.id, 'PRIVATE');
        expect(priv.visibility).toBe('PRIVATE');

        const pub = await provider.repository.setVisibility(doc.id, 'PUBLIC');
        expect(pub.visibility).toBe('PUBLIC');
      });
    });

    // -----------------------------------------------------------------------
    // 5. Pagination
    // -----------------------------------------------------------------------
    describe('Pagination', () => {
      it('pages return every item exactly once (no dups, no gaps)', async () => {
        const owner = 'paginator';
        const total = 7;
        const ids: string[] = [];
        for (let i = 0; i < total; i++) {
          const doc = await provider.repository.create(
            defaultInput({ title: `Document ${i}`, createdBy: owner }),
          );
          ids.push(doc.id);
        }

        const collected = await collectAll(provider.repository, owner, 3);
        const collectedIds = collected.map((b) => b.id);
        expect(collectedIds).toHaveLength(total);
        // every created id appears
        for (const id of ids) {
          expect(collectedIds).toContain(id);
        }
        // no duplicates
        expect(new Set(collectedIds).size).toBe(total);
      });

      it('ordering is newest-first and stable across pages', async () => {
        const owner = 'orderer';
        const created: string[] = [];
        for (let i = 0; i < 5; i++) {
          const doc = await provider.repository.create(
            defaultInput({ title: `Document ${i}`, createdBy: owner }),
          );
          created.push(doc.id);
          // `createdAt` is an ISO-8601 string with millisecond resolution, so a
          // tight creation loop produces ties and "newest-first" becomes
          // ambiguous — the contract then only guarantees a deterministic
          // tie-break, not creation order. Separate the timestamps so this case
          // tests the ordering rule rather than the host's execution speed.
          await new Promise((resolve) => setTimeout(resolve, 2));
        }

        const collected = await collectAll(provider.repository, owner, 2);
        const collectedIds = collected.map((b) => b.id);
        // newest-first means reverse of creation order
        expect(collectedIds).toEqual([...created].reverse());
      });

      it('ordering is deterministic when createdAt values tie', async () => {
        const owner = 'tie-breaker';
        // Created as fast as possible, so several documents are expected to share a
        // millisecond. The contract does not say WHICH order ties take, only
        // that it is a stable total order — so assert repeatability, which is
        // the property pagination actually depends on.
        for (let i = 0; i < 5; i++) {
          await provider.repository.create(defaultInput({ title: `Tie ${i}`, createdBy: owner }));
        }

        const first = (await collectAll(provider.repository, owner, 2)).map((b) => b.id);
        const second = (await collectAll(provider.repository, owner, 2)).map((b) => b.id);
        expect(first).toHaveLength(5);
        expect(second).toEqual(first);
      });

      it('garbage cursor does not corrupt results', async () => {
        const owner = 'garbage-cursor';
        await provider.repository.create(defaultInput({ createdBy: owner }));

        // a garbage cursor should either: return an empty page, or throw,
        // but never corrupt the data
        const page = await provider.repository.listByOwner(owner, {
          limit: 10,
          cursor: 'ZZZZ-NOT-A-REAL-CURSOR',
        });
        // just verify it returned a valid page shape
        expect(Array.isArray(page.items)).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // 6. Search visibility
    // -----------------------------------------------------------------------
    describe('Search visibility', () => {
      it('viewer sees PUBLIC documents', async () => {
        const doc = await provider.repository.create(
          defaultInput({ title: 'public searchable', visibility: 'PUBLIC', createdBy: 'owner1' }),
        );
        provider.search.add({
          documentId: doc.id,
          owner: 'owner1',
          visibility: 'PUBLIC',
          title: 'public searchable',
          content: 'hello',
        });

        const results = provider.search.query('searchable', 'viewer1');
        expect(results.hits.length).toBeGreaterThanOrEqual(1);
        expect(results.hits.some((h) => h.documentId === doc.id)).toBe(true);
      });

      it('viewer sees own PRIVATE documents', async () => {
        const doc = await provider.repository.create(
          defaultInput({ title: 'private mine', visibility: 'PRIVATE', createdBy: 'owner1' }),
        );
        provider.search.add({
          documentId: doc.id,
          owner: 'owner1',
          visibility: 'PRIVATE',
          title: 'private mine',
          content: 'secret',
        });

        const results = provider.search.query('private', 'owner1');
        expect(results.hits.some((h) => h.documentId === doc.id)).toBe(true);
      });

      it('viewer cannot see another owner PRIVATE doc', async () => {
        const doc = await provider.repository.create(
          defaultInput({ title: 'private other', visibility: 'PRIVATE', createdBy: 'owner1' }),
        );
        provider.search.add({
          documentId: doc.id,
          owner: 'owner1',
          visibility: 'PRIVATE',
          title: 'private other',
          content: 'secret other',
        });

        const results = provider.search.query('private', 'intruder');
        expect(results.hits.every((h) => h.documentId !== doc.id)).toBe(true);
      });

      it('null viewer sees only PUBLIC', async () => {
        const pub = await provider.repository.create(
          defaultInput({ title: 'anon public', visibility: 'PUBLIC', createdBy: 'owner1' }),
        );
        const priv = await provider.repository.create(
          defaultInput({ title: 'anon private', visibility: 'PRIVATE', createdBy: 'owner1' }),
        );
        provider.search.add({
          documentId: pub.id,
          owner: 'owner1',
          visibility: 'PUBLIC',
          title: 'anon public',
          content: 'public content',
        });
        provider.search.add({
          documentId: priv.id,
          owner: 'owner1',
          visibility: 'PRIVATE',
          title: 'anon private',
          content: 'private content',
        });

        const results = provider.search.query('anon', null);
        expect(results.hits.some((h) => h.documentId === pub.id)).toBe(true);
        expect(results.hits.every((h) => h.documentId !== priv.id)).toBe(true);
      });

      it('total reflects visible matches before pagination', async () => {
        const owner = 'totalowner';
        for (let i = 0; i < 5; i++) {
          const doc = await provider.repository.create(
            defaultInput({ title: `totaldoc ${i}`, visibility: 'PUBLIC', createdBy: owner }),
          );
          provider.search.add({
            documentId: doc.id,
            owner,
            visibility: 'PUBLIC',
            title: `totaldoc ${i}`,
            content: `totaldoc content ${i}`,
          });
        }

        const results = provider.search.query('totaldoc', owner, { limit: 2 });
        expect(results.total).toBe(5);
        expect(results.hits).toHaveLength(2);
      });

      it('remove de-indexes a doc', async () => {
        const doc = await provider.repository.create(
          defaultInput({ title: 'removable search', visibility: 'PUBLIC', createdBy: 'alice' }),
        );
        provider.search.add({
          documentId: doc.id,
          owner: 'alice',
          visibility: 'PUBLIC',
          title: 'removable search',
          content: 'removable content',
        });

        // confirm it's findable
        let results = provider.search.query('removable', 'alice');
        expect(results.hits.some((h) => h.documentId === doc.id)).toBe(true);

        provider.search.remove(doc.id);
        results = provider.search.query('removable', 'alice');
        expect(results.hits.every((h) => h.documentId !== doc.id)).toBe(true);
      });

      it('snapshot/restore round-trips the index', async () => {
        const doc = await provider.repository.create(
          defaultInput({ title: 'snapshot target', visibility: 'PUBLIC', createdBy: 'alice' }),
        );
        provider.search.add({
          documentId: doc.id,
          owner: 'alice',
          visibility: 'PUBLIC',
          title: 'snapshot target',
          content: 'snap content',
        });

        const snap = provider.search.snapshot();
        provider.search.clear();
        expect(provider.search.size()).toBe(0);

        provider.search.restore(snap);
        expect(provider.search.size()).toBe(1);
        const results = provider.search.query('snapshot', 'alice');
        expect(results.hits.some((h) => h.documentId === doc.id)).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // 7. Comments
    // -----------------------------------------------------------------------
    describe('Comments', () => {
      it('add returns a populated comment', async () => {
        const doc = await provider.repository.create(defaultInput());
        const comment = await provider.comments.add(doc.id, {
          author: 'commenter',
          body: 'Nice doc!',
        });
        expect(comment.documentId).toBe(doc.id);
        expect(comment.author).toBe('commenter');
        expect(comment.body).toBe('Nice doc!');
        expect(comment.resolved).toBe(false);
        expect(isIso(comment.createdAt)).toBe(true);
        expect(isValidId(comment.id)).toBe(true);
      });

      it('list returns all comments for a doc', async () => {
        const doc = await provider.repository.create(defaultInput());
        await provider.comments.add(doc.id, { author: 'a', body: 'first' });
        await provider.comments.add(doc.id, { author: 'b', body: 'second' });
        const comments = await provider.comments.list(doc.id);
        expect(comments).toHaveLength(2);
        const bodies = comments.map((c) => c.body);
        expect(bodies).toContain('first');
        expect(bodies).toContain('second');
      });

      it('setResolved toggles the resolved flag', async () => {
        const doc = await provider.repository.create(defaultInput());
        const comment = await provider.comments.add(doc.id, {
          author: 'alice',
          body: 'todo',
        });
        expect(comment.resolved).toBe(false);

        const resolved = await provider.comments.setResolved(doc.id, comment.id, true);
        expect(resolved.resolved).toBe(true);

        const unresolved = await provider.comments.setResolved(doc.id, comment.id, false);
        expect(unresolved.resolved).toBe(false);
      });

      it('delete removes a specific comment', async () => {
        const doc = await provider.repository.create(defaultInput());
        const c1 = await provider.comments.add(doc.id, { author: 'a', body: 'keep' });
        const c2 = await provider.comments.add(doc.id, { author: 'b', body: 'remove' });
        await provider.comments.delete(doc.id, c2.id);
        const remaining = await provider.comments.list(doc.id);
        expect(remaining).toHaveLength(1);
        expect(remaining[0]!.id).toBe(c1.id);
      });

      it('deleting a doc cascades and removes its comments', async () => {
        const doc = await provider.repository.create(defaultInput());
        await provider.comments.add(doc.id, { author: 'a', body: 'orphaned' });
        await provider.repository.delete(doc.id);
        const comments = await provider.comments.list(doc.id);
        expect(comments).toHaveLength(0);
      });
    });

    // -----------------------------------------------------------------------
    // 8. Expiry
    // -----------------------------------------------------------------------
    describe('Expiry', () => {
      it('listExpired returns documents at or before nowIso', async () => {
        const past = new Date(Date.now() - 86400_000).toISOString();
        const future = new Date(Date.now() + 86400_000).toISOString();
        const expired = await provider.repository.create(
          defaultInput({ title: 'expired', expiresAt: past }),
        );
        await provider.repository.create(defaultInput({ title: 'still alive', expiresAt: future }));

        const now = new Date().toISOString();
        const ids = await provider.repository.listExpired(now, 100);
        expect(ids).toContain(expired.id);
      });

      it('listExpired does not return non-expired documents', async () => {
        const future = new Date(Date.now() + 86400_000).toISOString();
        const alive = await provider.repository.create(
          defaultInput({ title: 'alive', expiresAt: future }),
        );

        const now = new Date().toISOString();
        const ids = await provider.repository.listExpired(now, 100);
        expect(ids).not.toContain(alive.id);
      });

      it('listExpired honours limit', async () => {
        const past = new Date(Date.now() - 86400_000).toISOString();
        for (let i = 0; i < 5; i++) {
          await provider.repository.create(defaultInput({ title: `exp ${i}`, expiresAt: past }));
        }

        const ids = await provider.repository.listExpired(new Date().toISOString(), 2);
        expect(ids.length).toBeLessThanOrEqual(2);
        expect(ids.length).toBeGreaterThanOrEqual(1);
      });

      it('documents without expiresAt are never returned by listExpired', async () => {
        const doc = await provider.repository.create(defaultInput());
        const ids = await provider.repository.listExpired(
          new Date(Date.now() + 86400_000).toISOString(),
          100,
        );
        expect(ids).not.toContain(doc.id);
      });
    });

    // -----------------------------------------------------------------------
    // 9. Size limits
    // -----------------------------------------------------------------------
    describe('Size limits', () => {
      it('create throws ContentTooLargeError for oversized content', async () => {
        const oversize = 'x'.repeat(LIMITS.MAX_CONTENT_BYTES + 1);
        await expect(
          provider.repository.create(defaultInput({ content: oversize })),
        ).rejects.toThrow(ContentTooLargeError);
      });

      it('appendVersion throws ContentTooLargeError for oversized content', async () => {
        const doc = await provider.repository.create(defaultInput());
        const oversize = 'x'.repeat(LIMITS.MAX_CONTENT_BYTES + 1);
        await expect(
          provider.repository.appendVersion(doc.id, {
            content: oversize,
            editedBy: 'alice',
            expect: { latestVersion: 1 },
          }),
        ).rejects.toThrow(ContentTooLargeError);
      });

      it('content exactly at size boundary is accepted', async () => {
        const exact = 'x'.repeat(LIMITS.MAX_CONTENT_BYTES);
        const doc = await provider.repository.create(defaultInput({ content: exact }));
        expect(doc.latestVersion).toBe(1);
      });

      it('content one byte over boundary is rejected', async () => {
        const overByOne = 'x'.repeat(LIMITS.MAX_CONTENT_BYTES + 1);
        await expect(
          provider.repository.create(defaultInput({ content: overByOne })),
        ).rejects.toThrow(ContentTooLargeError);
      });
    });

    // -----------------------------------------------------------------------
    // 10. Unicode and boundaries
    // -----------------------------------------------------------------------
    describe('Unicode and boundaries', () => {
      it('multi-byte content (emoji) round-trips byte-exactly', async () => {
        const content = '🎉🌍🦀 Hello, 世界! Ñoño 😎';
        const doc = await provider.repository.create(defaultInput({ content }));
        const v = await provider.repository.getVersion(doc.id, 1);
        expect(v!.content).toBe(content);
      });

      it('CJK content round-trips', async () => {
        const content = '漢字テスト한국어测试';
        const doc = await provider.repository.create(defaultInput({ content }));
        const v = await provider.repository.getVersion(doc.id, 1);
        expect(v!.content).toBe(content);
      });

      it('combining marks round-trip', async () => {
        // é as e + combining acute accent
        const content = 'e\u0301 cafe\u0301';
        const doc = await provider.repository.create(defaultInput({ content }));
        const v = await provider.repository.getVersion(doc.id, 1);
        expect(v!.content).toBe(content);
      });

      it('empty-string content is accepted and round-trips', async () => {
        const doc = await provider.repository.create(defaultInput({ content: '' }));
        const v = await provider.repository.getVersion(doc.id, 1);
        expect(v!.content).toBe('');
      });

      it('multi-byte boundary: content at exact byte limit accepted', async () => {
        // Create content that uses multi-byte chars to exactly hit the limit.
        // Each '🎉' is 4 bytes. Fill with ASCII then pad to exact boundary.
        const asciiPart = 'x'.repeat(LIMITS.MAX_CONTENT_BYTES - 4);
        const content = asciiPart + '🎉'; // exactly MAX_CONTENT_BYTES bytes
        expect(byteLen(content)).toBe(LIMITS.MAX_CONTENT_BYTES);
        const doc = await provider.repository.create(defaultInput({ content }));
        expect(doc.latestVersion).toBe(1);
      });

      it('multi-byte boundary: one byte over limit rejected', async () => {
        const asciiPart = 'x'.repeat(LIMITS.MAX_CONTENT_BYTES - 3);
        const content = asciiPart + '🎉'; // MAX_CONTENT_BYTES + 1 bytes
        expect(byteLen(content)).toBe(LIMITS.MAX_CONTENT_BYTES + 1);
        await expect(provider.repository.create(defaultInput({ content }))).rejects.toThrow(
          ContentTooLargeError,
        );
      });
    });

    describe('Capabilities declaration', () => {
      it('declares every capability field with the right type', () => {
        const caps = provider.capabilities;
        expect(['core-fallback', 'native']).toContain(caps.search);
        expect(typeof caps.nativeTtl).toBe('boolean');
        expect(typeof caps.atomicVersioning).toBe('boolean');
        // requiresNetwork gates offline mode: an undeclared value would let a
        // remote store start up inside an instance promising zero egress.
        expect(typeof caps.requiresNetwork).toBe('boolean');
      });

      it('exposes healthCheck as a function when present, and it does not throw', async () => {
        if (provider.healthCheck === undefined) return; // optional by contract
        expect(typeof provider.healthCheck).toBe('function');
        const health = await provider.healthCheck();
        expect(typeof health.healthy).toBe('boolean');
      });
    });
  });
}
