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
