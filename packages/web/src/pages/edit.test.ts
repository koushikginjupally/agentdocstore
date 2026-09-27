// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../api.js';
import { hasUnsavedChanges, setUnsavedChangesCheck } from '../router.js';
import { renderEditPage } from './edit.js';

const doc = {
  id: 'd1',
  title: 'Shared notes',
  language: 'plaintext',
  visibility: 'PUBLIC' as const,
  createdBy: 'alice',
  createdAt: '2026-09-27T00:00:00Z',
  updatedAt: '2026-09-27T00:00:00Z',
  latestVersion: 1,
  version: 1,
  content: 'hello',
};

/** Render the edit page as `viewer` and return the container. */
async function editPageAs(viewer: string | Error): Promise<HTMLElement> {
  vi.spyOn(api, 'getDocument').mockResolvedValue(doc);
  vi.spyOn(api, 'whoami').mockImplementation(() =>
    viewer instanceof Error ? Promise.reject(viewer) : Promise.resolve({ user: viewer }),
  );
  document.body.innerHTML = '<main></main>';
  const main = document.querySelector('main')!;
  await renderEditPage('d1', main);
  return main;
}

const saveButton = (root: HTMLElement): Element | undefined =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'Save Changes');

describe('edit page access', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the edit form to the document owner', async () => {
    const page = await editPageAs('alice');
    expect(page.querySelector('#edit-content')).not.toBeNull();
    expect(saveButton(page)).toBeDefined();
  });

  it('tells another viewer only the owner can edit, with a way back', async () => {
    const page = await editPageAs('bob');
    expect(page.querySelector('#edit-content')).toBeNull();
    expect(saveButton(page)).toBeUndefined();
    expect(page.querySelector('h2')?.textContent).toBe('Only the owner can edit this document');
    expect(page.textContent).toContain('This document belongs to alice.');
    const back = page.querySelector<HTMLAnchorElement>('a.btn');
    expect(back?.textContent).toBe('Back to document');
    expect(back?.getAttribute('href')).toBe('#/d/d1');
  });

  it('keeps the form when the viewer cannot be determined', async () => {
    // The server still enforces ownership; a failed identity lookup must not
    // tell the real owner they cannot edit.
    const page = await editPageAs(new Error('offline'));
    expect(page.querySelector('#edit-content')).not.toBeNull();
    expect(saveButton(page)).toBeDefined();
  });

  it('shows the owner name as text, not markup', async () => {
    vi.spyOn(api, 'getDocument').mockResolvedValue({ ...doc, createdBy: '<b>mallory</b>' });
    vi.spyOn(api, 'whoami').mockResolvedValue({ user: 'bob' });
    document.body.innerHTML = '<main></main>';
    const main = document.querySelector('main')!;
    await renderEditPage('d1', main);
    expect(main.querySelector('b')).toBeNull();
    expect(main.textContent).toContain('This document belongs to <b>mallory</b>.');
  });
});

describe('edit page unsaved changes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  it('reports typed changes, and forgets them once the save succeeds', async () => {
    const page = await editPageAs('alice');
    expect(hasUnsavedChanges()).toBe(false);

    const content = page.querySelector<HTMLTextAreaElement>('#edit-content')!;
    content.value = 'rewritten';
    expect(hasUnsavedChanges()).toBe(true);

    vi.spyOn(api, 'updateDocument').mockResolvedValue({ ...doc, latestVersion: 2 });
    (saveButton(page) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(api.updateDocument).toHaveBeenCalled());
    await vi.waitFor(() => expect(hasUnsavedChanges()).toBe(false));
  });

  it('keeps reporting them when the save fails', async () => {
    const page = await editPageAs('alice');
    page.querySelector<HTMLInputElement>('#edit-title')!.value = 'Renamed';
    vi.spyOn(api, 'updateDocument').mockRejectedValue(new Error('offline'));
    (saveButton(page) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(api.updateDocument).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hasUnsavedChanges()).toBe(true);
  });
});
