// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../api.js';
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
    await vi.waitFor(() => expect(document.querySelector('#diff-output h3')).not.toBeNull());
    return document.querySelector<HTMLElement>('#diff-output')!;
  }

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
