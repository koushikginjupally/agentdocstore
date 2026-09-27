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
