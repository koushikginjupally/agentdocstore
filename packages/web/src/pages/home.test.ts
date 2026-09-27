// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, type ApiDocument } from '../api.js';
import { hasUnsavedChanges, setUnsavedChangesCheck } from '../router.js';
import { renderHomePage } from './home.js';

async function homePage(): Promise<HTMLElement> {
  vi.spyOn(api, 'listDocuments').mockResolvedValue({ items: [] });
  document.body.innerHTML = '<main></main>';
  const main = document.querySelector('main')!;
  await renderHomePage(main);
  return main;
}

const createButton = (root: HTMLElement): HTMLButtonElement =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'Create Document')!;

describe('home page unsaved changes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  it('counts a half-written document as unsaved', async () => {
    const page = await homePage();
    expect(hasUnsavedChanges()).toBe(false);
    page.querySelector('textarea')!.value = 'draft notes';
    expect(hasUnsavedChanges()).toBe(true);
  });

  it('forgets it once the document is created', async () => {
    const page = await homePage();
    page.querySelector('textarea')!.value = 'draft notes';
    vi.spyOn(api, 'createDocument').mockResolvedValue({
      id: 'abc123DEF4',
      title: 'Untitled',
      language: 'markdown',
      visibility: 'PUBLIC',
      createdBy: 'alice',
      createdAt: '2026-09-27T00:00:00Z',
      updatedAt: '2026-09-27T00:00:00Z',
      latestVersion: 1,
    });
    createButton(page).click();
    await vi.waitFor(() => expect(api.createDocument).toHaveBeenCalled());
    await vi.waitFor(() => expect(hasUnsavedChanges()).toBe(false));
  });
});

describe('create form expiry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  async function createWith(expiry: string): Promise<Record<string, unknown>> {
    const page = await homePage();
    page.querySelector('textarea')!.value = 'draft notes';
    page.querySelector<HTMLSelectElement>('#doc-expiry')!.value = expiry;
    const create = vi.spyOn(api, 'createDocument').mockResolvedValue({
      id: 'abc123DEF4',
      title: 'Untitled',
      language: 'markdown',
      visibility: 'PUBLIC',
      createdBy: 'alice',
      createdAt: '2026-09-27T00:00:00Z',
      updatedAt: '2026-09-27T00:00:00Z',
      latestVersion: 1,
    });
    createButton(page).click();
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    return create.mock.calls[0]![0] as Record<string, unknown>;
  }

  it('offers Never and a set of periods, labelled Expires', async () => {
    const page = await homePage();
    const select = page.querySelector<HTMLSelectElement>('#doc-expiry')!;
    expect(page.querySelector('label[for="doc-expiry"]')?.textContent).toBe('Expires');
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Never',
      'In 1 day',
      'In 7 days',
      'In 30 days',
      'In 90 days',
      'In 1 year',
    ]);
    expect(select.value).toBe('');
  });

  it('sends the chosen number of days', async () => {
    expect(await createWith('7')).toMatchObject({ expiresInDays: 7 });
  });

  it('sends no expiry for Never', async () => {
    expect(await createWith('')).not.toHaveProperty('expiresInDays');
  });
});

describe('document list focus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  const listed = (id: string): ApiDocument => ({
    id,
    title: `Note ${id}`,
    language: 'markdown',
    visibility: 'PRIVATE',
    createdBy: 'alice',
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
    latestVersion: 1,
  });

  async function pagedHome(...pages: Array<{ items: ApiDocument[]; nextCursor?: string }>) {
    const list = vi.spyOn(api, 'listDocuments');
    for (const page of pages) list.mockResolvedValueOnce(page);
    document.body.innerHTML = '<main></main>';
    const main = document.querySelector('main')!;
    await renderHomePage(main);
    return { main, list, loadMore: main.querySelector<HTMLButtonElement>('#load-more-btn')! };
  }

  const link = (main: HTMLElement, id: string) =>
    main.querySelector<HTMLAnchorElement>(`a.doc-list-link[href="#/d/${id}"]`);

  it('moves focus to the first document Load More added, so the last page does not lose it', async () => {
    const { main, loadMore } = await pagedHome(
      { items: [listed('d1'), listed('d2')], nextCursor: 'd2' },
      { items: [listed('d3')] },
    );
    loadMore.focus();
    loadMore.click();
    await vi.waitFor(() => expect(link(main, 'd3')).not.toBeNull());
    expect(loadMore.style.display).toBe('none');
    expect(document.activeElement).toBe(link(main, 'd3'));
  });

  it('also moves focus to the first new document while more remain', async () => {
    const { main, loadMore } = await pagedHome(
      { items: [listed('d1')], nextCursor: 'd1' },
      { items: [listed('d2')], nextCursor: 'd2' },
    );
    loadMore.focus();
    loadMore.click();
    await vi.waitFor(() => expect(document.activeElement).toBe(link(main, 'd2')));
    expect(loadMore.style.display).not.toBe('none');
  });

  it('moves focus to the last document when the last page brought none', async () => {
    const { main, loadMore } = await pagedHome(
      { items: [listed('d1'), listed('d2')], nextCursor: 'd2' },
      { items: [] },
    );
    loadMore.focus();
    loadMore.click();
    await vi.waitFor(() => expect(loadMore.style.display).toBe('none'));
    expect(document.activeElement).toBe(link(main, 'd2'));
  });

  it('keeps focus on Load More when a page added nothing but more remain', async () => {
    const { list, loadMore } = await pagedHome(
      { items: [listed('d1')], nextCursor: 'd1' },
      { items: [], nextCursor: 'd9' },
    );
    loadMore.focus();
    loadMore.click();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadMore.style.display).not.toBe('none');
    expect(document.activeElement).toBe(loadMore);
  });

  it('keeps focus in the search box when a search loads results', async () => {
    const { main, list } = await pagedHome(
      { items: [listed('d1')] },
      { items: [listed('d2')], nextCursor: 'd2' },
    );
    const search = main.querySelector<HTMLInputElement>('input[aria-label="Search documents"]')!;
    search.focus();
    search.value = 'note';
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(link(main, 'd2')).not.toBeNull());
    expect(document.activeElement).toBe(search);
  });
});
