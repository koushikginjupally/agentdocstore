/** View doc page: renders content, version badge, copy buttons, comment panel. */
import { api, ApiError, resolveViewer } from '../api.js';
import { ICON_ERROR, ICON_SEARCH, iconLabelHtml } from '../icons.js';
import { href, navigate } from '../router.js';
import { buildTitle } from '../constants.js';
import { renderContent } from '../render.js';
import { formatDate, copyToClipboard, onClick } from '../dom.js';
import { showToast } from '../toast.js';
import { renderCommentPanel } from '../comments.js';

/**
 * Render a document. With `version`, show that version's content: when it is
 * not the latest, the page is read-only — no Edit or Delete (they act on the
 * whole document) and no comments (they belong to the document, not to one
 * old version) — and says so, with a link to the latest version.
 */
export async function renderViewPage(
  id: string,
  container: HTMLElement,
  version?: number,
): Promise<void> {
  container.innerHTML = '<div class="loading-state"><span class="spinner"></span> Loading...</div>';

  // Asked once per page and shared with the comment panel.
  const viewerLookup = resolveViewer();

  try {
    const [doc, viewer] = await Promise.all([api.getDocument(id, version), viewerLookup]);
    const isOldVersion = version !== undefined && version < doc.latestVersion;
    document.title = buildTitle(isOldVersion ? `${doc.title} (v${version})` : doc.title);
    // Edit and Delete are owner-only on the server (core canWrite/canDelete),
    // so only the owner is offered them. An unknown viewer sees neither.
    const isOwner = !isOldVersion && viewer !== null && viewer !== '' && viewer === doc.createdBy;

    container.innerHTML = '';

    // Header area
    const header = document.createElement('div');
    header.className = 'flex-between mb-16';
    header.style.flexWrap = 'wrap';
    header.style.gap = '12px';

    const left = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.style.fontSize = '1.5rem';
    h1.style.fontWeight = '600';
    h1.textContent = doc.title;
    left.appendChild(h1);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'flex-row mt-8';
    metaDiv.style.flexWrap = 'wrap';
    metaDiv.style.gap = '8px';

    const visBadge = document.createElement('span');
    visBadge.className = `visibility-badge ${doc.visibility.toLowerCase()}`;
    visBadge.textContent = doc.visibility;

    const langBadge = document.createElement('span');
    langBadge.className = 'text-muted text-sm';
    langBadge.textContent = doc.language;

    const versionBadge = document.createElement('span');
    versionBadge.className = 'version-badge';
    versionBadge.textContent = `v${isOldVersion ? version : doc.latestVersion}`;

    const dateBadge = document.createElement('span');
    dateBadge.className = 'text-muted text-sm';
    dateBadge.textContent = formatDate(doc.updatedAt);

    const authorBadge = document.createElement('span');
    authorBadge.className = 'text-muted text-sm';
    authorBadge.textContent = `by ${doc.createdBy}`;

    metaDiv.appendChild(visBadge);
    metaDiv.appendChild(langBadge);
    metaDiv.appendChild(versionBadge);
    // The document's last-updated time belongs to the latest version; beside
    // an old version it would read as that version's date.
    if (!isOldVersion) metaDiv.appendChild(dateBadge);
    metaDiv.appendChild(authorBadge);
    left.appendChild(metaDiv);

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'flex-row';
    // Wrap like the header and meta rows; without it the five buttons overflow
    // a phone-width screen and "Delete" is pushed off the edge.
    actions.style.flexWrap = 'wrap';

    const copyLinkBtn = document.createElement('button');
    copyLinkBtn.className = 'btn btn-sm';
    copyLinkBtn.innerHTML = iconLabelHtml('link', 'Copy Link');
    onClick(copyLinkBtn, 'Copy link', async () => {
      const path = isOldVersion ? `/d/${id}/v/${version}` : `/d/${id}`;
      const url = `${window.location.origin}${href(path)}`;
      const ok = await copyToClipboard(url);
      showToast(ok ? 'Link copied!' : 'Failed to copy', ok ? 'success' : 'error');
    });

    const copyRawBtn = document.createElement('button');
    copyRawBtn.className = 'btn btn-sm';
    copyRawBtn.innerHTML = iconLabelHtml('copy', 'Copy Raw');
    onClick(copyRawBtn, 'Copy raw content', async () => {
      const ok = await copyToClipboard(doc.content);
      showToast(ok ? 'Content copied!' : 'Failed to copy', ok ? 'success' : 'error');
    });

    const editBtn = document.createElement('a');
    editBtn.className = 'btn btn-sm';
    editBtn.href = href(`/d/${id}/edit`);
    editBtn.innerHTML = iconLabelHtml('edit', 'Edit');

    const versionsBtn = document.createElement('a');
    versionsBtn.className = 'btn btn-sm';
    versionsBtn.href = href(`/d/${id}/versions`);
    versionsBtn.innerHTML = iconLabelHtml('history', 'Versions');

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-sm btn-danger';
    deleteBtn.innerHTML = iconLabelHtml('trash', 'Delete');
    onClick(deleteBtn, 'Delete doc', async () => {
      if (!confirm('Delete this doc permanently?')) return;
      try {
        await api.deleteDocument(id);
        navigate('/');
        showToast('Document deleted', 'success');
      } catch (err) {
        showToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
      }
    });

    actions.appendChild(copyLinkBtn);
    actions.appendChild(copyRawBtn);
    if (isOwner) actions.appendChild(editBtn);
    actions.appendChild(versionsBtn);
    if (isOwner) actions.appendChild(deleteBtn);

    header.appendChild(left);
    header.appendChild(actions);
    container.appendChild(header);

    if (isOldVersion) {
      const notice = document.createElement('div');
      notice.className = 'version-notice mb-16';
      notice.setAttribute('role', 'note');
      const text = document.createElement('span');
      text.textContent = `You are viewing version ${version} of ${doc.latestVersion}. `;
      const latestLink = document.createElement('a');
      latestLink.href = href(`/d/${id}`);
      latestLink.textContent = 'View the latest version';
      notice.appendChild(text);
      notice.appendChild(latestLink);
      container.appendChild(notice);
    }

    // Content rendering
    const contentDiv = document.createElement('div');
    contentDiv.className = 'card';
    container.appendChild(contentDiv);
    await renderContent(doc.language, doc.content, contentDiv);

    // Comment panel
    if (!isOldVersion) renderCommentPanel(id, container, doc.createdBy, viewerLookup);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      document.title = buildTitle('Not Found');
      // A missing version of a document that may still exist: point at the
      // document itself rather than only at home. Built with DOM nodes, not
      // markup, because `id` comes straight from the address bar.
      const [message, backHref, backLabel] =
        version !== undefined
          ? ['Version not found', href(`/d/${id}`), 'Go to the document']
          : ['Document not found', href('/'), 'Go Home'];
      container.innerHTML = `<div class="empty-state"><div class="icon">${ICON_SEARCH}</div></div>`;
      const state = container.querySelector('.empty-state')!;
      const text = document.createElement('div');
      text.textContent = message;
      const back = document.createElement('a');
      back.className = 'btn mt-16';
      back.href = backHref;
      back.textContent = backLabel;
      state.appendChild(text);
      state.appendChild(back);
    } else {
      showToast(
        `Failed to load doc: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error',
      );
      container.innerHTML = `<div class="empty-state"><div class="icon">${ICON_ERROR}</div><div>Failed to load doc</div></div>`;
    }
  }
}
