// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../api.js';
import { renderViewPage } from './view.js';

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

/** Render the view page as `viewer`; return the labels of the document's action controls. */
async function actionsAs(viewer: string | Error): Promise<string[]> {
  vi.spyOn(api, 'getDocument').mockResolvedValue(doc);
  vi.spyOn(api, 'getComments').mockResolvedValue([]);
  vi.spyOn(api, 'whoami').mockImplementation(() =>
    viewer instanceof Error ? Promise.reject(viewer) : Promise.resolve({ user: viewer }),
  );
  document.body.innerHTML = '';
  await renderViewPage('d1', document.body);
  const header = document.querySelector('.flex-between');
  return [...(header?.querySelectorAll('a, button') ?? [])].map((el) => el.textContent ?? '');
}

describe('view page document actions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('offers Edit and Delete to the document owner', async () => {
    expect(await actionsAs('alice')).toEqual([
      'Copy Link',
      'Copy Raw',
      'Edit',
      'Versions',
      'Delete',
    ]);
  });

  it('hides Edit and Delete from other viewers', async () => {
    expect(await actionsAs('bob')).toEqual(['Copy Link', 'Copy Raw', 'Versions']);
  });

  it('hides Edit and Delete when the viewer is unknown', async () => {
    expect(await actionsAs(new Error('offline'))).toEqual(['Copy Link', 'Copy Raw', 'Versions']);
  });

  it('asks who the viewer is once for the whole page', async () => {
    await actionsAs('bob');
    await vi.waitFor(() => expect(document.querySelector('#comment-list p')).not.toBeNull());
    expect(api.whoami).toHaveBeenCalledTimes(1);
  });
});
