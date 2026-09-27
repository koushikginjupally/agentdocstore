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

describe('deleting a comment', () => {
  afterEach(() => vi.restoreAllMocks());

  async function clickDeleteOnOwnComment(answer: boolean): Promise<void> {
    await deletableAs('bob', 'alice');
    vi.spyOn(window, 'confirm').mockReturnValue(answer);
    vi.spyOn(api, 'deleteComment').mockResolvedValue(undefined);
    const del = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Delete')!;
    del.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('asks first, since a deleted comment cannot be restored', async () => {
    await clickDeleteOnOwnComment(true);
    expect(window.confirm).toHaveBeenCalledWith('Delete this comment permanently?');
    expect(api.deleteComment).toHaveBeenCalledWith('d1', 'c1');
  });

  it('keeps the comment when the user declines', async () => {
    await clickDeleteOnOwnComment(false);
    expect(api.deleteComment).not.toHaveBeenCalled();
  });
});
