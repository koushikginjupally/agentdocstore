// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../api.js';
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
