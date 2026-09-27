// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from './api.js';
import { canDeleteCommentAs, renderCommentPanel } from './comments.js';
import { hasUnsavedChanges, setUnsavedChangesCheck } from './router.js';

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

describe('a half-written comment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  async function commentForm(): Promise<{ box: HTMLTextAreaElement; post: HTMLButtonElement }> {
    vi.spyOn(api, 'getComments').mockResolvedValue([]);
    vi.spyOn(api, 'whoami').mockResolvedValue({ user: 'alice' });
    document.body.innerHTML = '';
    renderCommentPanel('d1', document.body, 'alice');
    await vi.waitFor(() => expect(api.getComments).toHaveBeenCalled());
    return {
      box: document.querySelector<HTMLTextAreaElement>('textarea[aria-label="New comment"]')!,
      post: [...document.querySelectorAll('button')].find((b) => b.textContent === 'Comment')!,
    };
  }

  it('counts as unsaved, so leaving the page asks first', async () => {
    const { box } = await commentForm();
    expect(hasUnsavedChanges()).toBe(false);
    box.value = 'Please check step 3';
    expect(hasUnsavedChanges()).toBe(true);
  });

  it('is no longer unsaved once it has been posted', async () => {
    const { box, post } = await commentForm();
    vi.spyOn(api, 'addComment').mockResolvedValue({ ...comments[0]!, body: 'Please check step 3' });
    box.value = 'Please check step 3';
    post.click();
    await vi.waitFor(() => expect(box.value).toBe(''));
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('stays unsaved when posting fails, since the text is kept', async () => {
    const { box, post } = await commentForm();
    vi.spyOn(api, 'addComment').mockRejectedValue(new Error('Comment too long'));
    box.value = 'Please check step 3';
    post.click();
    await vi.waitFor(() => expect(api.addComment).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(box.value).toBe('Please check step 3');
    expect(hasUnsavedChanges()).toBe(true);
  });
});

describe('comment size note', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnsavedChangesCheck(null);
  });

  async function form() {
    vi.spyOn(api, 'getComments').mockResolvedValue([]);
    vi.spyOn(api, 'whoami').mockResolvedValue({ user: 'alice' });
    document.body.innerHTML = '';
    renderCommentPanel('d1', document.body, 'alice');
    await vi.waitFor(() => expect(api.getComments).toHaveBeenCalled());
    const box = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="New comment"]')!;
    const note = document.getElementById(box.getAttribute('aria-describedby') ?? '')!;
    const post = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Comment')!;
    const type = (text: string): void => {
      box.value = text;
      box.dispatchEvent(new Event('input'));
    };
    return { box, note, post, type };
  }

  it('is linked to the comment box and empty for a short comment', async () => {
    const { note, type } = await form();
    expect(note).not.toBeNull();
    type('Looks good');
    expect(note.textContent).toBe('');
  });

  it('shows the size as the comment nears the limit', async () => {
    const { note, type } = await form();
    type('x'.repeat(9_500));
    expect(note.textContent).toBe('9,500 of 10,000 bytes');
    expect(note.classList.contains('over-limit')).toBe(false);
  });

  it('counts bytes, not characters', async () => {
    const { note, type } = await form();
    type('é'.repeat(5_000));
    expect(note.textContent).toBe('10,000 of 10,000 bytes');
    type('é'.repeat(5_001));
    expect(note.classList.contains('over-limit')).toBe(true);
  });

  it('measures the comment as it will be sent, without surrounding space', async () => {
    const { note, type } = await form();
    type(`${'x'.repeat(10_000)}   \n`);
    expect(note.classList.contains('over-limit')).toBe(false);
  });

  it('says how much to cut, and does not post a comment over the limit', async () => {
    const { box, note, post, type } = await form();
    const add = vi.spyOn(api, 'addComment');
    type('x'.repeat(10_976));
    expect(note.textContent).toBe(
      '10,976 of 10,000 bytes. Shorten the comment by 976 bytes to post it.',
    );
    expect(note.classList.contains('over-limit')).toBe(true);
    post.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(add).not.toHaveBeenCalled();
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.value).toHaveLength(10_976);
  });

  it('clears once the comment is posted', async () => {
    const { note, post, type } = await form();
    vi.spyOn(api, 'addComment').mockResolvedValue({ ...comments[0]!, body: 'x' });
    type('x'.repeat(9_500));
    post.click();
    await vi.waitFor(() => expect(note.textContent).toBe(''));
  });
});
