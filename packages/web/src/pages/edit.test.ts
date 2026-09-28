// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError } from '../api.js';
import * as toastModule from '../toast.js';
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

  it('titles the edit form with the page h1', async () => {
    const page = await editPageAs('alice');
    expect([...page.querySelectorAll('h1, h2, h3')].map((h) => h.tagName)).toEqual(['H1']);
    expect(page.querySelector('h1')?.textContent).toBe('Edit Document');
  });

  it('tells another viewer only the owner can edit, with a way back', async () => {
    const page = await editPageAs('bob');
    expect(page.querySelector('#edit-content')).toBeNull();
    expect(saveButton(page)).toBeUndefined();
    expect(page.querySelector('h1')?.textContent).toBe('Only the owner can edit this document');
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

  it('saves against the version it loaded, so a newer save is not overwritten', async () => {
    const page = await editPageAs('alice');
    page.querySelector<HTMLTextAreaElement>('#edit-content')!.value = 'rewritten';
    const save = vi.spyOn(api, 'updateDocument').mockResolvedValue({ ...doc, latestVersion: 2 });
    (saveButton(page) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![1]).toMatchObject({ content: 'rewritten', latestVersion: 1 });
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

describe('edit form expiry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  async function saveWith(
    current: string | undefined,
    choice: string,
  ): Promise<{ page: HTMLElement; sent: Record<string, unknown> }> {
    vi.spyOn(api, 'getDocument').mockResolvedValue({
      ...doc,
      ...(current ? { expiresAt: current } : {}),
    });
    vi.spyOn(api, 'whoami').mockResolvedValue({ user: 'alice' });
    document.body.innerHTML = '<main></main>';
    const page = document.querySelector('main')!;
    await renderEditPage('d1', page);
    page.querySelector<HTMLSelectElement>('#edit-expiry')!.value = choice;
    const update = vi.spyOn(api, 'updateDocument').mockResolvedValue(doc);
    (saveButton(page) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    return { page, sent: update.mock.calls[0]![1] as Record<string, unknown> };
  }

  it('keeps the current expiry unless another choice is made', async () => {
    const { sent } = await saveWith('2026-10-04T00:00:00.000Z', 'keep');
    expect(sent).not.toHaveProperty('expiresInDays');
  });

  it('removes the expiry with Never', async () => {
    const { sent } = await saveWith('2026-10-04T00:00:00.000Z', 'never');
    expect(sent).toMatchObject({ expiresInDays: null });
  });

  it('sets a new expiry from now', async () => {
    const { sent } = await saveWith(undefined, '30');
    expect(sent).toMatchObject({ expiresInDays: 30 });
  });

  it('names the current expiry and offers Never only when there is one', async () => {
    const withExpiry = await editPageAs('alice');
    expect(
      [...withExpiry.querySelector<HTMLSelectElement>('#edit-expiry')!.options].map((o) => o.value),
    ).toEqual(['keep', '1', '7', '30', '90', '365']);
    vi.restoreAllMocks();
    vi.spyOn(api, 'getDocument').mockResolvedValue({ ...doc, expiresAt: '2026-10-04T00:00:00Z' });
    vi.spyOn(api, 'whoami').mockResolvedValue({ user: 'alice' });
    document.body.innerHTML = '<main></main>';
    const page = document.querySelector('main')!;
    await renderEditPage('d1', page);
    const select = page.querySelector<HTMLSelectElement>('#edit-expiry')!;
    expect(select.options[0]!.textContent).toMatch(/^Keep: /);
    expect(select.options[1]!.value).toBe('never');
  });
});

describe('preview while editing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  const previewButton = (root: HTMLElement): HTMLButtonElement =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Preview')!;

  async function editing(content: string, language: string) {
    const page = await editPageAs('alice');
    const box = page.querySelector<HTMLTextAreaElement>('#edit-content')!;
    box.value = content;
    page.querySelector<HTMLSelectElement>('#edit-language')!.value = language;
    return { page, box, toggle: previewButton(page) };
  }

  it('bolds the selection with Ctrl+B when the document is markdown', async () => {
    const { box } = await editing('Ship it.', 'markdown');
    box.setSelectionRange(0, 4);
    box.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(box.value).toBe('**Ship** it.');
  });

  it('shows the text as the document page will, then the text again', async () => {
    const { page, box, toggle } = await editing('# Plan\n\nShip it.', 'markdown');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    const panel = page.querySelector<HTMLElement>(`#${toggle.getAttribute('aria-controls')}`)!;
    expect(panel.hidden).toBe(true);

    toggle.click();
    await vi.waitFor(() => expect(panel.querySelector('h1')?.textContent).toBe('Plan'));
    expect(panel.hidden).toBe(false);
    expect(box.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    expect(panel.hidden).toBe(true);
    expect(box.hidden).toBe(false);
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe('# Plan\n\nShip it.');
  });

  it('renders in the language chosen on the form', async () => {
    const { page, toggle } = await editing('# Not a heading', 'plaintext');
    toggle.click();
    const panel = page.querySelector<HTMLElement>(`#${toggle.getAttribute('aria-controls')}`)!;
    await vi.waitFor(() => expect(panel.textContent).toContain('# Not a heading'));
    expect(panel.querySelector('h1')).toBeNull();
  });

  it('sanitizes the preview the way the document page does', async () => {
    const { page, toggle } = await editing('Hi <img src="x" onerror="alert(1)">', 'markdown');
    toggle.click();
    const panel = page.querySelector<HTMLElement>(`#${toggle.getAttribute('aria-controls')}`)!;
    await vi.waitFor(() => expect(panel.querySelector('img')).not.toBeNull());
    expect(panel.querySelector('img')!.hasAttribute('onerror')).toBe(false);
  });

  it('still counts the text as unsaved while previewing', async () => {
    const { toggle } = await editing('changed text', 'markdown');
    toggle.click();
    expect(hasUnsavedChanges()).toBe(true);
  });
});

describe('loading a file on the edit page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  it('replaces the content after asking, and keeps the title', async () => {
    const page = await editPageAs('alice');
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const input = page.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {
      value: [new File(['print("v2")\n'], 'script.py')],
      configurable: true,
    });
    input.dispatchEvent(new Event('change'));
    const content = page.querySelector<HTMLTextAreaElement>('#edit-content')!;
    await vi.waitFor(() => expect(content.value).toBe('print("v2")\n'));
    expect(ask).toHaveBeenCalled();
    expect(page.querySelector<HTMLInputElement>('#edit-title')!.value).toBe('Shared notes');
    expect(page.querySelector<HTMLSelectElement>('#edit-language')!.value).toBe('python');
  });
});

describe('saving after someone else saved', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  const reason =
    'This document changed since you loaded it: you have version 1, the latest is version 2';

  /** The page loaded version 1; version 2 is saved before this page saves. */
  async function conflicted() {
    const page = await editPageAs('alice');
    vi.mocked(api.getDocument).mockResolvedValue({ ...doc, latestVersion: 2, version: 2 });
    const box = page.querySelector<HTMLTextAreaElement>('#edit-content')!;
    box.value = 'my rewrite';
    const toast = vi.spyOn(toastModule, 'showToast').mockImplementation(() => undefined);
    const save = vi
      .spyOn(api, 'updateDocument')
      .mockRejectedValueOnce(new ApiError(`API error 409: ${reason}`, 409, { error: reason }));
    (saveButton(page) as HTMLButtonElement).click();
    const notice = await vi.waitFor(() => {
      const found = page.querySelector<HTMLElement>('.version-conflict');
      expect(found).not.toBeNull();
      return found!;
    });
    return { page, box, save, toast, notice };
  }

  it('says so in the form, keeps the text, and offers the newer version in a new tab', async () => {
    const { box, notice, toast } = await conflicted();
    expect(notice.getAttribute('role')).toBe('alert');
    // Focus goes to the notice (the Save button lost it while disabled), so
    // the next Tab reaches its two choices.
    expect(document.activeElement).toBe(notice);
    expect(notice.getAttribute('tabindex')).toBe('-1');
    expect(notice.textContent).toContain('saved as version 2 while you were editing');
    expect(box.value).toBe('my rewrite');
    expect(hasUnsavedChanges()).toBe(true);
    const link = notice.querySelector<HTMLAnchorElement>('a')!;
    expect(link.textContent).toBe('Open version 2 in a new tab');
    expect(link.getAttribute('href')).toBe('#/d/d1/v/2');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(toast).not.toHaveBeenCalled();
  });

  it('saves the text as the next version on request, keeping version 2 in the history', async () => {
    const { notice, save } = await conflicted();
    save.mockResolvedValueOnce({ ...doc, latestVersion: 3 });
    const again = [...notice.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save mine as version 3',
    )!;
    again.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![1]).toMatchObject({ content: 'my rewrite', latestVersion: 2 });
    await vi.waitFor(() => expect(hasUnsavedChanges()).toBe(false));
  });

  it('shows one notice, not a pile, when the save conflicts again', async () => {
    const { page, save } = await conflicted();
    save.mockRejectedValueOnce(new ApiError(`API error 409: ${reason}`, 409, { error: reason }));
    (saveButton(page) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(page.querySelectorAll('.version-conflict')).toHaveLength(1);
  });
});
