// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from './api.js';
import { canDeleteCommentAs, renderCommentPanel } from './comments.js';

const comments = [
  {
    id: 'c1',
    documentId: 'd1',
    author: 'bob',
    body: 'from bob',
    resolved: false,
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
  },
  {
    id: 'c2',
    documentId: 'd1',
    author: 'carol',
    body: 'from carol',
    resolved: false,
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
  },
];

/** Render the panel as `viewer` on a document owned by `owner`; return which comments show Delete. */
async function deletableAs(viewer: string | Error, owner: string): Promise<string[]> {
  vi.spyOn(api, 'getComments').mockResolvedValue(comments);
  vi.spyOn(api, 'whoami').mockImplementation(() =>
    viewer instanceof Error ? Promise.reject(viewer) : Promise.resolve({ user: viewer }),
  );
  document.body.innerHTML = '';
  renderCommentPanel('d1', document.body, owner);
  await vi.waitFor(() => expect(document.querySelectorAll('.comment-item')).toHaveLength(2));
  return [...document.querySelectorAll('.comment-item')]
    .filter((item) => [...item.querySelectorAll('button')].some((b) => b.textContent === 'Delete'))
    .map((item) => item.querySelector('.comment-body')?.textContent ?? '');
}

describe('comment Delete button', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows Delete only on your own comments', async () => {
    expect(await deletableAs('bob', 'alice')).toEqual(['from bob']);
  });

  it('shows Delete on every comment for the document owner', async () => {
    expect(await deletableAs('alice', 'alice')).toEqual(['from bob', 'from carol']);
  });

  it('hides Delete everywhere when the viewer is unknown', async () => {
    expect(await deletableAs(new Error('offline'), 'alice')).toEqual([]);
  });

  it('matches the server rule', () => {
    expect(canDeleteCommentAs('bob', 'alice', 'bob')).toBe(true);
    expect(canDeleteCommentAs('alice', 'alice', 'bob')).toBe(true);
    expect(canDeleteCommentAs('carol', 'alice', 'bob')).toBe(false);
    expect(canDeleteCommentAs(null, 'alice', 'bob')).toBe(false);
    expect(canDeleteCommentAs('', '', '')).toBe(false);
  });
});
