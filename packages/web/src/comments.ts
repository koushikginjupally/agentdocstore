/** Comment panel for a doc. */
import { api, resolveViewer } from './api.js';
import type { ApiComment } from './api.js';
import { formatDate, markFieldInvalid, onClick } from './dom.js';
import { MAX_COMMENT_BYTES, commentSizeMessage, utf8Bytes } from './constants.js';
import { watchForUnsavedChanges } from './router.js';
import { showToast } from './toast.js';

/**
 * Whether `viewer` may delete a comment by `author` on a document owned by
 * `docOwner`. Mirrors the server rule (core `canDeleteComment`): the comment's
 * author or the document owner. The server still enforces it; this only keeps
 * the UI from offering a button that would fail.
 */
export function canDeleteCommentAs(
  viewer: string | null,
  docOwner: string,
  author: string,
): boolean {
  if (!viewer) return false;
  return viewer === docOwner || viewer === author;
}

export function renderCommentPanel(
  documentId: string,
  container: HTMLElement,
  docOwner: string,
  // Resolved once per panel, or passed in by a page that already asked. If the
  // viewer is unknown, no Delete buttons are shown (fail closed).
  viewer: Promise<string | null> = resolveViewer(),
): void {
  const ctx: PanelContext = { documentId, docOwner, viewer };

  const panel = document.createElement('div');
  panel.className = 'comment-panel';

  const title = document.createElement('h3');
  title.className = 'panel-title';
  title.textContent = 'Comments';
  panel.appendChild(title);

  const listEl = document.createElement('div');
  listEl.id = 'comment-list';
  panel.appendChild(listEl);

  // Add comment form
  const form = document.createElement('div');
  form.className = 'comment-form';

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Add a comment...';
  textarea.setAttribute('aria-label', 'New comment');
  // A half-written comment is lost when the page changes, so leaving asks
  // first, as the edit page does. Posting clears the box, which ends it.
  watchForUnsavedChanges([textarea]);

  // The comment's size against the server's limit, once it gets close, so the
  // writer sees it while typing instead of after a rejected post.
  const sizeNote = document.createElement('p');
  sizeNote.id = 'comment-size';
  sizeNote.className = 'comment-size text-sm text-muted';
  textarea.setAttribute('aria-describedby', sizeNote.id);
  const showSize = (): number => {
    const bytes = utf8Bytes(textarea.value.trim());
    sizeNote.textContent = commentSizeMessage(bytes);
    sizeNote.classList.toggle('over-limit', bytes > MAX_COMMENT_BYTES);
    return bytes;
  };
  textarea.addEventListener('input', showSize);

  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn btn-primary';
  submitBtn.textContent = 'Comment';
  onClick(submitBtn, 'Add comment', async () => {
    const body = textarea.value.trim();
    if (!body) return;
    if (showSize() > MAX_COMMENT_BYTES) {
      // The note already says how much to cut; point the user back at it.
      markFieldInvalid(textarea);
      return;
    }
    submitBtn.disabled = true;
    try {
      await api.addComment(documentId, body);
      textarea.value = '';
      showSize();
      await loadComments(ctx, listEl);
      showToast('Comment added', 'success');
    } catch (err) {
      showToast(
        `Failed to add comment: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error',
      );
    } finally {
      submitBtn.disabled = false;
    }
  });

  form.appendChild(textarea);
  form.appendChild(submitBtn);
  panel.appendChild(form);
  panel.appendChild(sizeNote);

  container.appendChild(panel);

  // Load existing comments
  void loadComments(ctx, listEl);
}

interface PanelContext {
  readonly documentId: string;
  readonly docOwner: string;
  readonly viewer: Promise<string | null>;
}

async function loadComments(ctx: PanelContext, listEl: HTMLElement): Promise<void> {
  try {
    const [comments, viewer] = await Promise.all([api.getComments(ctx.documentId), ctx.viewer]);
    renderCommentList(ctx, viewer, comments, listEl);
  } catch {
    listEl.innerHTML = '<p class="text-muted text-sm">Failed to load comments.</p>';
  }
}

function renderCommentList(
  ctx: PanelContext,
  viewer: string | null,
  comments: ApiComment[],
  listEl: HTMLElement,
): void {
  const { documentId } = ctx;
  listEl.innerHTML = '';

  if (comments.length === 0) {
    listEl.innerHTML = '<p class="text-muted text-sm">No comments yet.</p>';
    return;
  }

  for (const comment of comments) {
    const item = document.createElement('div');
    item.className = `comment-item${comment.resolved ? ' comment-resolved' : ''}`;

    const header = document.createElement('div');
    header.className = 'comment-header';

    const author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = comment.author;

    const time = document.createElement('span');
    time.className = 'comment-time';
    time.textContent = formatDate(comment.createdAt);

    header.appendChild(author);
    header.appendChild(time);

    const body = document.createElement('div');
    body.className = 'comment-body';
    body.textContent = comment.body;

    const actions = document.createElement('div');
    actions.className = 'flex-row mt-8';

    const resolveBtn = document.createElement('button');
    resolveBtn.className = 'btn btn-sm';
    resolveBtn.textContent = comment.resolved ? 'Unresolve' : 'Resolve';
    onClick(resolveBtn, comment.resolved ? 'Unresolve comment' : 'Resolve comment', async () => {
      try {
        await api.resolveComment(documentId, comment.id, !comment.resolved);
        await loadComments(ctx, listEl);
      } catch (err) {
        showToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
      }
    });

    let deleteBtn: HTMLButtonElement | null = null;
    if (canDeleteCommentAs(viewer, ctx.docOwner, comment.author)) {
      deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-sm btn-danger';
      deleteBtn.textContent = 'Delete';
      onClick(deleteBtn, 'Delete comment', async () => {
        // Like the document's own Delete: there is no undo.
        if (!confirm('Delete this comment permanently?')) return;
        try {
          await api.deleteComment(documentId, comment.id);
          await loadComments(ctx, listEl);
          showToast('Comment deleted', 'success');
        } catch (err) {
          showToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
        }
      });
    }

    actions.appendChild(resolveBtn);
    if (deleteBtn) actions.appendChild(deleteBtn);

    item.appendChild(header);
    item.appendChild(body);
    item.appendChild(actions);
    listEl.appendChild(item);
  }
}
