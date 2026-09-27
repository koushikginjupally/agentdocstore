import { describe, it, expect } from 'vitest';
import { CoreSearchIndex } from './CoreSearchIndex.js';

const past = (): string => new Date(Date.now() - 60_000).toISOString();
const future = (): string => new Date(Date.now() + 60_000).toISOString();

function entry(id: string, expiresAt?: string) {
  return {
    documentId: id,
    owner: 'alice',
    visibility: 'PUBLIC' as const,
    title: `zebra ${id}`,
    content: 'zebra',
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

describe('CoreSearchIndex expiry', () => {
  it('excludes expired entries from hits and total', () => {
    const index = new CoreSearchIndex();
    index.add(entry('a'));
    index.add(entry('b', future()));
    index.add(entry('c', past()));

    const result = index.query('zebra', 'alice');
    expect(result.hits.map((h) => h.documentId).sort()).toEqual(['a', 'b']);
    expect(result.total).toBe(2);
  });

  it('keeps total consistent with paging when an entry has expired', () => {
    const index = new CoreSearchIndex();
    for (const id of ['a', 'b', 'c']) index.add(entry(id));
    index.add(entry('d', past()));

    const page = index.query('zebra', 'alice', { limit: 2 });
    expect(page.hits).toHaveLength(2);
    expect(page.total).toBe(3);
  });

  it('still applies expiry after a snapshot round-trip', () => {
    const index = new CoreSearchIndex();
    index.add(entry('a'));
    index.add(entry('c', past()));

    const restored = new CoreSearchIndex();
    restored.restore(index.snapshot());
    const result = restored.query('zebra', 'alice');
    expect(result.hits.map((h) => h.documentId)).toEqual(['a']);
    expect(result.total).toBe(1);
  });
});

describe('CoreSearchIndex ranking after replaced entries', () => {
  it('scores equal matches equally on the first search after an update', () => {
    const index = new CoreSearchIndex();
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      index.add({ ...entry(id), title: 'notes' });
      // Re-indexing a document replaces its entry, as every save does.
      index.update({ ...entry(id), title: 'notes' });
    }

    const first = index.query('zebra', 'alice');
    const scores = first.hits.map((h) => h.score);
    expect(new Set(scores).size).toBe(1);
    expect(scores[0]).toBeGreaterThan(0);
    expect(index.query('zebra', 'alice').hits).toEqual(first.hits);
  });

  it('ranks the better match first on the first search after an update', () => {
    const index = new CoreSearchIndex();
    index.add({ ...entry('strong'), title: 'notes', content: 'zebra zebra zebra' });
    index.add({ ...entry('weak'), title: 'notes', content: 'zebra and many other words here' });
    // Only the weaker match is saved again.
    index.update({ ...entry('weak'), title: 'notes', content: 'zebra and many other words here' });

    expect(index.query('zebra', 'alice').hits.map((h) => h.documentId)).toEqual(['strong', 'weak']);
  });

  it('ranks correctly on the first search after restoring a snapshot taken after an update', () => {
    const before = new CoreSearchIndex();
    before.add({ ...entry('strong'), title: 'notes', content: 'zebra zebra zebra' });
    before.add({ ...entry('weak'), title: 'notes', content: 'zebra and many other words here' });
    before.update({ ...entry('weak'), title: 'notes', content: 'zebra and many other words here' });

    const after = new CoreSearchIndex();
    after.restore(before.snapshot());
    expect(after.query('zebra', 'alice').hits.map((h) => h.documentId)).toEqual(['strong', 'weak']);
  });
});
