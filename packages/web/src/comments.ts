/** Comment panel for a doc. */
import { api } from './api.js';
import type { ApiComment } from './api.js';
import { formatDate, onClick } from './dom.js';
import { showToast } from './toast.js';

export function renderCommentPanel(documentId: string, container: HTMLElement): void {
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

  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn btn-primary';
  submitBtn.textContent = 'Comment';
  onClick(submitBtn, 'Add comment', async () => {
    const body = textarea.value.trim();
    if (!body) return;
    submitBtn.disabled = true;
    try {
      await api.addComment(documentId, body);
      textarea.value = '';
      await loadComments(documentId, listEl);
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

  container.appendChild(panel);

  // Load existing comments
  void loadComments(documentId, listEl);
}

async function loadComments(documentId: string, listEl: HTMLElement): Promise<void> {
  try {
    const comments = await api.getComments(documentId);
    renderCommentList(documentId, comments, listEl);
  } catch {
    listEl.innerHTML = '<p class="text-muted text-sm">Failed to load comments.</p>';
  }
}

function renderCommentList(documentId: string, comments: ApiComment[], listEl: HTMLElement): void {
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
        await loadComments(documentId, listEl);
      } catch (err) {
        showToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-sm btn-danger';
    deleteBtn.textContent = 'Delete';
    onClick(deleteBtn, 'Delete comment', async () => {
      try {
        await api.deleteComment(documentId, comment.id);
        await loadComments(documentId, listEl);
        showToast('Comment deleted', 'success');
      } catch (err) {
        showToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
      }
    });

    actions.appendChild(resolveBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(header);
    item.appendChild(body);
    item.appendChild(actions);
    listEl.appendChild(item);
  }
}
