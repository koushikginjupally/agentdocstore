// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, type ApiDocument } from '../api.js';
import { emptyListMessage } from '../constants.js';
import { offerNewDocumentDraft, takeNewDocumentDraft } from '../new-document-draft.js';
import * as toast from '../toast.js';
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

/** Heading levels in document order, e.g. [1, 2, 2]. */
const headingLevels = (root: ParentNode): number[] =>
  [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1]));

describe('home page headings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has one h1 for the page, above the two panel headings', async () => {
    const main = await homePage();
    expect(headingLevels(main)).toEqual([1, 2, 2]);
    const h1 = main.querySelector('h1')!;
    expect(h1.textContent).toBe('Documents');
    // Screen readers get the page heading; the two panels keep their look.
    expect(h1.classList.contains('sr-only')).toBe(true);
  });
});

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

describe('search match count', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  const found = (id: string): ApiDocument => ({
    id,
    title: `Note ${id}`,
    language: 'markdown',
    visibility: 'PUBLIC',
    createdBy: 'alice',
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
    latestVersion: 1,
  });

  async function searchFor(
    query: string,
    ...pages: Array<{ items: ApiDocument[]; total?: number; nextCursor?: string }>
  ) {
    const list = vi.spyOn(api, 'listDocuments').mockResolvedValueOnce({ items: [found('mine')] });
    for (const page of pages) list.mockResolvedValueOnce(page);
    document.body.innerHTML = '<main></main>';
    const main = document.querySelector('main')!;
    await renderHomePage(main);
    const status = main.querySelector<HTMLElement>('[role="status"]')!;
    const input = main.querySelector<HTMLInputElement>('input[aria-label="Search documents"]')!;
    input.value = query;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { main, status, input, list };
  }

  it('shows nothing for the plain list of your documents', async () => {
    vi.spyOn(api, 'listDocuments').mockResolvedValue({ items: [found('mine')] });
    document.body.innerHTML = '<main></main>';
    const main = document.querySelector('main')!;
    await renderHomePage(main);
    expect(main.querySelector('[role="status"]')!.textContent).toBe('');
  });

  it('says how many documents a search matched, in a status region', async () => {
    const { status } = await searchFor('note', {
      items: [found('a'), found('b')],
      total: 25,
      nextCursor: '2',
    });
    expect(status.textContent).toBe('25 documents match “note”');
    expect(status.classList.contains('sr-only')).toBe(false);
  });

  it('keeps the count for the whole search when Load More adds a page', async () => {
    const { main, status } = await searchFor(
      'note',
      { items: [found('a')], total: 2, nextCursor: '1' },
      { items: [found('b')], total: 2 },
    );
    main.querySelector<HTMLButtonElement>('#load-more-btn')!.click();
    await vi.waitFor(() =>
      expect(main.querySelector('a.doc-list-link[href="#/d/b"]')).not.toBeNull(),
    );
    expect(status.textContent).toBe('2 documents match “note”');
  });

  it('announces no matches without repeating the empty message on screen', async () => {
    const { main, status } = await searchFor('zebra', { items: [], total: 0 });
    expect(status.textContent).toBe(emptyListMessage('zebra'));
    expect(status.classList.contains('sr-only')).toBe(true);
    expect(main.querySelector('.doc-list .empty-state')!.textContent).toContain('“zebra”');
  });

  it('clears the count when the search is cleared', async () => {
    const { status, input, list } = await searchFor('note', { items: [found('a')], total: 1 });
    expect(status.textContent).toBe('1 document matches “note”');
    list.mockResolvedValueOnce({ items: [found('mine')] });
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.waitFor(() => expect(status.textContent).toBe(''));
  });
});

describe('create form preview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  it('previews the new document in the language chosen', async () => {
    const page = await homePage();
    page.querySelector<HTMLTextAreaElement>('#doc-content')!.value = '## Steps';
    page.querySelector<HTMLSelectElement>('#doc-language')!.value = 'markdown';
    const toggle = [...page.querySelectorAll('button')].find((b) => b.textContent === 'Preview')!;
    toggle.click();
    const panel = page.querySelector<HTMLElement>(`#${toggle.getAttribute('aria-controls')}`)!;
    await vi.waitFor(() => expect(panel.querySelector('h2')?.textContent).toBe('Steps'));
    expect(page.querySelector<HTMLTextAreaElement>('#doc-content')!.hidden).toBe(true);
  });
});

describe('create form from a copy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
    takeNewDocumentDraft();
  });

  const draft = {
    title: 'Copy of Runbook',
    language: 'markdown',
    visibility: 'PRIVATE' as const,
    content: '# Runbook\n\n1. Check',
  };

  it('fills the form from the copy and says it is not saved yet', async () => {
    offerNewDocumentDraft(draft);
    const page = await homePage();
    expect(page.querySelector<HTMLInputElement>('#doc-title')!.value).toBe('Copy of Runbook');
    expect(page.querySelector<HTMLSelectElement>('#doc-language')!.value).toBe('markdown');
    expect(page.querySelector<HTMLSelectElement>('#doc-visibility')!.value).toBe('PRIVATE');
    expect(page.querySelector<HTMLTextAreaElement>('#doc-content')!.value).toBe(
      '# Runbook\n\n1. Check',
    );
    expect(page.textContent).toContain('This copy is not saved yet.');
    // Leaving now would drop the copy, so it counts as unsaved.
    expect(hasUnsavedChanges()).toBe(true);
  });

  it('uses the copy once; the next visit starts empty', async () => {
    offerNewDocumentDraft(draft);
    await homePage();
    setUnsavedChangesCheck(null);
    const page = await homePage();
    expect(page.querySelector<HTMLInputElement>('#doc-title')!.value).toBe('');
    expect(page.textContent).not.toContain('This copy is not saved yet.');
    expect(hasUnsavedChanges()).toBe(false);
  });
});

describe('loading a file into the create form', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  function choose(page: HTMLElement, file: File): void {
    const input = page.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  const notes = (): File => new File(['# Release notes\n\n- Faster search\n'], 'Release notes.md');

  it('is started from a labelled button', async () => {
    const page = await homePage();
    const button = [...page.querySelectorAll('button')].find((b) => b.textContent === 'Load File');
    expect(button).toBeDefined();
    expect(page.querySelector('input[type="file"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('fills the content, the title and the language from the file', async () => {
    const page = await homePage();
    choose(page, notes());
    const content = page.querySelector<HTMLTextAreaElement>('#doc-content')!;
    await vi.waitFor(() => expect(content.value).toBe('# Release notes\n\n- Faster search\n'));
    expect(page.querySelector<HTMLInputElement>('#doc-title')!.value).toBe('Release notes');
    expect(page.querySelector<HTMLSelectElement>('#doc-language')!.value).toBe('markdown');
    expect(hasUnsavedChanges()).toBe(true);
  });

  it('keeps a title that was already typed', async () => {
    const page = await homePage();
    page.querySelector<HTMLInputElement>('#doc-title')!.value = 'My title';
    choose(page, notes());
    await vi.waitFor(() =>
      expect(page.querySelector<HTMLTextAreaElement>('#doc-content')!.value).not.toBe(''),
    );
    expect(page.querySelector<HTMLInputElement>('#doc-title')!.value).toBe('My title');
  });

  it('asks before replacing text already in the box, and keeps it when declined', async () => {
    const page = await homePage();
    const content = page.querySelector<HTMLTextAreaElement>('#doc-content')!;
    content.value = 'typed by hand';
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    choose(page, notes());
    await vi.waitFor(() => expect(ask).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(content.value).toBe('typed by hand');
  });

  it('loads a file dropped on the text box', async () => {
    const page = await homePage();
    const content = page.querySelector<HTMLTextAreaElement>('#doc-content')!;
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [notes()] } });
    content.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(content.value).toContain('Faster search'));
  });

  it('says why a file cannot be loaded, and changes nothing', async () => {
    const page = await homePage();
    const shown = vi.spyOn(toast, 'showToast');
    choose(page, new File([new Uint8Array([0x00, 0x01])], 'logo.png'));
    await vi.waitFor(() =>
      expect(shown).toHaveBeenCalledWith('logo.png does not look like a text file.', 'error'),
    );
    expect(page.querySelector<HTMLTextAreaElement>('#doc-content')!.value).toBe('');
  });
});
