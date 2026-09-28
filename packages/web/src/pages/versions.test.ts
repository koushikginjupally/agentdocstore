// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError } from '../api.js';
import { renderVersionsPage } from './versions.js';

const doc = {
  id: 'd1',
  title: 'Shared notes',
  language: 'plaintext',
  visibility: 'PUBLIC' as const,
  createdBy: 'alice',
  createdAt: '2026-09-27T00:00:00Z',
  updatedAt: '2026-09-27T00:00:00Z',
  latestVersion: 2,
  version: 2,
  content: 'second',
};

const version = (n: number) => ({
  documentId: 'd1',
  version: n,
  content: `v${n}`,
  createdBy: 'alice',
  createdAt: '2026-09-27T00:00:00Z',
});

describe('versions page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('links every version to a page that shows it in full', async () => {
    vi.spyOn(api, 'getDocument').mockResolvedValue(doc);
    vi.spyOn(api, 'getVersions').mockResolvedValue([version(1), version(2)]);
    document.body.innerHTML = '';
    await renderVersionsPage('d1', document.body);

    const links = [...document.querySelectorAll('.version-list-item a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
      a.getAttribute('aria-label'),
    ]);
    expect(links).toEqual([
      ['View', '#/d/d1/v/2', 'View version 2'],
      ['View', '#/d/d1/v/1', 'View version 1'],
    ]);
  });
});

describe('comparing two versions', () => {
  afterEach(() => vi.restoreAllMocks());

  async function compare(diff: string): Promise<HTMLElement> {
    vi.spyOn(api, 'getDocument').mockResolvedValue(doc);
    vi.spyOn(api, 'getVersions').mockResolvedValue([version(1), version(2)]);
    vi.spyOn(api, 'getDiff').mockResolvedValue({ diff });
    document.body.innerHTML = '';
    await renderVersionsPage('d1', document.body);
    for (const box of document.querySelectorAll<HTMLInputElement>('.version-checkbox')) box.click();
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent === 'Compare Selected')!
      .click();
    await vi.waitFor(() => expect(document.querySelector('#diff-output h2')).not.toBeNull());
    return document.querySelector<HTMLElement>('#diff-output')!;
  }

  it('puts the diff heading one level under the page h1', async () => {
    await compare('@@ -1 +1 @@\n-a\n+b\n');
    expect([...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => h.tagName)).toEqual([
      'H1',
      'H2',
    ]);
  });

  it('shows the changes without the file header lines, which are not changes', async () => {
    const output = await compare(
      [
        '===================================================================',
        '--- v1',
        '+++ v2',
        '@@ -1,2 +1,2 @@',
        ' line one',
        '-line two',
        '+line 2',
        '',
      ].join('\n'),
    );
    const rows = [...output.querySelectorAll('.diff-container > div')].map((el) => [
      el.className,
      el.textContent,
    ]);
    expect(rows).toEqual([
      ['diff-hunk', '@@ -1,2 +1,2 @@'],
      ['diff-line', ' line one'],
      ['diff-line diff-del', '-line two'],
      ['diff-line diff-add', '+line 2'],
      ['diff-line', ''],
    ]);
  });

  it('says so when the two versions have the same content', async () => {
    const output = await compare('');
    expect(output.querySelector('.diff-container')).toBeNull();
    expect(output.textContent).toContain('These versions have the same content.');
  });
});

// Two versions over the diff size limit got only "Failed to compute diff."
// under the list; the server's reason flashed by in a toast.
describe('a comparison the server refuses', () => {
  afterEach(() => vi.restoreAllMocks());

  async function refusedCompare(error: Error): Promise<HTMLElement> {
    vi.spyOn(api, 'getDocument').mockResolvedValue(doc);
    vi.spyOn(api, 'getVersions').mockResolvedValue([version(1), version(2)]);
    vi.spyOn(api, 'getDiff').mockRejectedValue(error);
    document.body.innerHTML = '';
    await renderVersionsPage('d1', document.body);
    for (const box of document.querySelectorAll<HTMLInputElement>('.version-checkbox')) box.click();
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent === 'Compare Selected')!
      .click();
    const output = document.querySelector<HTMLElement>('#diff-output')!;
    await vi.waitFor(() => expect(output.querySelector('.loading-state')).toBeNull());
    return output;
  }

  it('says in the page that the versions are too large to compare, and links each in full', async () => {
    const output = await refusedCompare(
      new ApiError('Old content exceeds diff size limit (3080000 > 2097152 bytes)', 413),
    );
    expect(output.getAttribute('role')).toBeNull();
    const note = output.querySelector('[role="alert"]')!;
    expect(note.textContent).toContain('too large to compare');
    expect(note.textContent).toContain('2 MB');
    expect(
      [...note.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Open version 1', '#/d/d1/v/1'],
      ['Open version 2', '#/d/d1/v/2'],
    ]);
  });

  it("shows any other failure's own message in the page", async () => {
    const output = await refusedCompare(new ApiError('Version 2 not found', 404));
    expect(output.querySelector('[role="alert"]')!.textContent).toContain('Version 2 not found');
  });
});
