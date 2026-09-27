import MiniSearch from 'minisearch';
import type { Visibility } from '../model/document.js';
import type {
  SearchDoc,
  SearchHit,
  SearchIndex,
  SearchQueryOptions,
  SearchResults,
} from '../spi/search.js';

/** Shape stored inside MiniSearch (id === documentId). */
interface IndexedDoc {
  readonly id: string;
  readonly owner: string;
  readonly visibility: Visibility;
  readonly title: string;
  readonly content: string;
  readonly expiresAt?: string;
}

const SEARCH_FIELDS = ['title', 'content'];
const STORE_FIELDS = ['owner', 'visibility', 'expiresAt'];
const OPTIONS = {
  idField: 'id',
  fields: SEARCH_FIELDS,
  storeFields: STORE_FIELDS,
  searchOptions: { prefix: true, fuzzy: 0.2, combineWith: 'AND' as const },
};

/**
 * The default {@link SearchIndex} implementation, backed by MiniSearch. Used by
 * any provider whose {@link Capabilities.search} is `'core-fallback'`.
 *
 * `query` returns PUBLIC hits plus the viewer's own PRIVATE hits — a PRIVATE
 * doc owned by someone else is never returned.
 */
export class CoreSearchIndex implements SearchIndex {
  private mini: MiniSearch<IndexedDoc>;

  constructor() {
    this.mini = new MiniSearch<IndexedDoc>(OPTIONS);
  }

  add(doc: SearchDoc): void {
    // Idempotent: replace any prior doc with the same id.
    if (this.mini.has(doc.documentId)) this.mini.discard(doc.documentId);
    this.mini.add(toIndexed(doc));
  }

  update(doc: SearchDoc): void {
    this.add(doc);
  }

  remove(documentId: string): void {
    if (this.mini.has(documentId)) this.mini.discard(documentId);
  }

  query(q: string, viewer: string | null, opts?: SearchQueryOptions): SearchResults {
    const trimmed = q.trim();
    if (trimmed.length > 0 && this.mini.dirtCount > 0) {
      // Replacing or removing a document only marks its old entry as
      // discarded; MiniSearch drops those entries later, or when a search
      // meets them. A search that meets one scores the matches it saw before
      // it as if the discarded entry still counted, which can make scores
      // negative and put a weaker match first. This throwaway search drops
      // the discarded entries for these terms, so the one below scores right.
      this.mini.search(trimmed);
    }
    const raw = trimmed.length === 0 ? [] : this.mini.search(trimmed);
    const now = Date.now();
    const visible = raw.filter((r) => {
      const visibility = r['visibility'] as Visibility;
      const owner = r['owner'] as string;
      const expiresAt = r['expiresAt'] as string | undefined;
      if (expiresAt !== undefined && Date.parse(expiresAt) <= now) return false;
      return visibility === 'PUBLIC' || (viewer !== null && owner === viewer);
    });
    const total = visible.length;
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 50;
    const hits: SearchHit[] = visible
      .slice(offset, offset + limit)
      .map((r) => ({ documentId: String(r.id), score: r.score }));
    return { hits, total };
  }

  snapshot(): string {
    return JSON.stringify(this.mini);
  }

  restore(snapshot: string): void {
    this.mini = MiniSearch.loadJSON<IndexedDoc>(snapshot, OPTIONS);
  }

  clear(): void {
    this.mini = new MiniSearch<IndexedDoc>(OPTIONS);
  }

  size(): number {
    return this.mini.documentCount;
  }
}

function toIndexed(doc: SearchDoc): IndexedDoc {
  return {
    id: doc.documentId,
    owner: doc.owner,
    visibility: doc.visibility,
    title: doc.title,
    content: doc.content,
    ...(doc.expiresAt !== undefined ? { expiresAt: doc.expiresAt } : {}),
  };
}
