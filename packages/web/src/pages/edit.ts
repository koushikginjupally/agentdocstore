/** Edit doc page: update content, title, language, visibility. */
import { api, ApiError, CredentialScanError, resolveViewer } from '../api.js';
import { ICON_ERROR, ICON_SEARCH } from '../icons.js';
import { navigate, href, setUnsavedChangesCheck, watchForUnsavedChanges } from '../router.js';
import { buildTitle } from '../constants.js';
import { expiryField, formatDate, LANGUAGES } from '../dom.js';
import { contentPreview } from '../preview.js';
import { addMarkdownShortcuts } from '../markdown-shortcuts.js';
import { fileLoader } from '../file-load.js';
import { showToast } from '../toast.js';
import { showRedactionModal } from '../redaction-modal.js';

export async function renderEditPage(id: string, container: HTMLElement): Promise<void> {
  container.innerHTML = '<div class="loading-state"><span class="spinner"></span> Loading...</div>';

  try {
    const [doc, viewer] = await Promise.all([api.getDocument(id), resolveViewer()]);

    // Only the owner may update (core canWrite), so a form would only fail on
    // Save. An unknown viewer still gets the form: the server enforces the
    // rule, and a failed lookup must not tell the real owner they cannot edit.
    if (viewer !== null && viewer !== '' && viewer !== doc.createdBy) {
      renderNotOwner(id, doc.title, doc.createdBy, container);
      return;
    }

    document.title = buildTitle(`Editing: ${doc.title}`);

    container.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'card';

    const heading = document.createElement('h1');
    heading.className = 'panel-title';
    heading.textContent = 'Edit Document';
    card.appendChild(heading);

    // Title
    const titleGroup = document.createElement('div');
    titleGroup.className = 'form-group';
    const titleLabel = document.createElement('label');
    titleLabel.setAttribute('for', 'edit-title');
    titleLabel.textContent = 'Title';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.id = 'edit-title';
    titleInput.value = doc.title;
    titleGroup.appendChild(titleLabel);
    titleGroup.appendChild(titleInput);
    card.appendChild(titleGroup);

    // Language + Visibility row
    const rowDiv = document.createElement('div');
    rowDiv.className = 'flex-row gap-16';
    rowDiv.style.flexWrap = 'wrap';

    const langGroup = document.createElement('div');
    langGroup.className = 'form-group';
    langGroup.style.flex = '1';
    langGroup.style.minWidth = '150px';
    const langLabel = document.createElement('label');
    langLabel.setAttribute('for', 'edit-language');
    langLabel.textContent = 'Language';
    const langSelect = document.createElement('select');
    langSelect.id = 'edit-language';
    for (const lang of LANGUAGES) {
      const opt = document.createElement('option');
      opt.value = lang;
      opt.textContent = lang;
      if (lang === doc.language) opt.selected = true;
      langSelect.appendChild(opt);
    }
    langGroup.appendChild(langLabel);
    langGroup.appendChild(langSelect);

    const visGroup = document.createElement('div');
    visGroup.className = 'form-group';
    visGroup.style.flex = '1';
    visGroup.style.minWidth = '150px';
    const visLabel = document.createElement('label');
    visLabel.setAttribute('for', 'edit-visibility');
    visLabel.textContent = 'Visibility';
    const visSelect = document.createElement('select');
    visSelect.id = 'edit-visibility';
    for (const v of ['PUBLIC', 'PRIVATE']) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      if (v === doc.visibility) opt.selected = true;
      visSelect.appendChild(opt);
    }
    visGroup.appendChild(visLabel);
    visGroup.appendChild(visSelect);

    rowDiv.appendChild(langGroup);
    rowDiv.appendChild(visGroup);
    // "keep" leaves the expiry untouched, so saving an unrelated edit never
    // changes it; "never" removes it; a number sets it that many days from now.
    const expiry = expiryField('edit-expiry', [
      {
        value: 'keep',
        label: doc.expiresAt ? `Keep: ${formatDate(doc.expiresAt)}` : 'Keep: never expires',
      },
      ...(doc.expiresAt ? [{ value: 'never', label: 'Never' }] : []),
    ]);
    rowDiv.appendChild(expiry.group);
    card.appendChild(rowDiv);

    // Content
    const contentGroup = document.createElement('div');
    contentGroup.className = 'form-group';
    const contentLabel = document.createElement('label');
    contentLabel.setAttribute('for', 'edit-content');
    contentLabel.textContent = 'Content';
    const contentArea = document.createElement('textarea');
    contentArea.id = 'edit-content';
    contentArea.value = doc.content;
    contentArea.rows = 20;
    addMarkdownShortcuts(contentArea, langSelect);
    const preview = contentPreview(contentArea, langSelect);
    const loader = fileLoader({
      contentArea,
      titleInput,
      languageSelect: langSelect,
      // Show what was loaded, not a preview of what was there before.
      onLoaded: () => {
        if (preview.toggle.getAttribute('aria-pressed') === 'true') preview.toggle.click();
      },
    });
    const contentTools = document.createElement('div');
    contentTools.className = 'flex-row';
    contentTools.append(loader.button, preview.toggle);
    const contentHeader = document.createElement('div');
    contentHeader.className = 'flex-between';
    contentHeader.append(contentLabel, contentTools);
    contentGroup.appendChild(contentHeader);
    contentGroup.appendChild(contentArea);
    contentGroup.appendChild(preview.panel);
    contentGroup.appendChild(loader.input);
    card.appendChild(contentGroup);

    // Edit message
    const msgGroup = document.createElement('div');
    msgGroup.className = 'form-group';
    const msgLabel = document.createElement('label');
    msgLabel.setAttribute('for', 'edit-message');
    msgLabel.textContent = 'Edit Message (optional)';
    const msgInput = document.createElement('input');
    msgInput.type = 'text';
    msgInput.id = 'edit-message';
    msgInput.placeholder = 'Describe your changes...';
    // Matches LIMITS.MAX_EDIT_MESSAGE_CHARS on the server.
    msgInput.maxLength = 500;
    msgGroup.appendChild(msgLabel);
    msgGroup.appendChild(msgInput);
    card.appendChild(msgGroup);

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'flex-row';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Save Changes';

    const cancelBtn = document.createElement('a');
    cancelBtn.className = 'btn';
    cancelBtn.href = href(`/d/${id}`);
    cancelBtn.textContent = 'Cancel';

    saveBtn.addEventListener(
      'click',
      () =>
        void handleSave(
          id,
          doc.latestVersion,
          titleInput,
          langSelect,
          visSelect,
          contentArea,
          msgInput,
          expiry.select,
          saveBtn,
        ),
    );

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    card.appendChild(btnRow);

    container.appendChild(card);
    // Cancel, the header link or Back would otherwise drop edits silently.
    watchForUnsavedChanges([
      titleInput,
      langSelect,
      visSelect,
      expiry.select,
      contentArea,
      msgInput,
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      document.title = buildTitle('Not Found');
      container.innerHTML = `
        <div class="empty-state">
          <div class="icon">${ICON_SEARCH}</div>
          <div>Document not found</div>
          <a href="${href('/')}" class="btn mt-16">Go Home</a>
        </div>
      `;
    } else {
      showToast(
        `Failed to load doc: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error',
      );
      container.innerHTML = `<div class="empty-state"><div class="icon">${ICON_ERROR}</div><div>Failed to load doc</div></div>`;
    }
  }
}

/** What a signed-in non-owner sees at /d/:id/edit instead of the form. */
function renderNotOwner(id: string, title: string, owner: string, container: HTMLElement): void {
  document.title = buildTitle(title);
  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'card';

  const heading = document.createElement('h1');
  heading.className = 'panel-title';
  heading.textContent = 'Only the owner can edit this document';

  const note = document.createElement('p');
  note.className = 'text-muted mb-16';
  note.textContent = `This document belongs to ${owner}.`;

  const back = document.createElement('a');
  back.className = 'btn';
  back.href = href(`/d/${id}`);
  back.textContent = 'Back to document';

  card.appendChild(heading);
  card.appendChild(note);
  card.appendChild(back);
  container.appendChild(card);
}

/**
 * Say, in the form, that a newer version was saved while this page was open.
 * The typed text stays where it is. The notice links to the newer version in a
 * new tab, to compare, and offers to save this text as the version after it:
 * nothing is lost, since the newer version stays in the history.
 */
async function showVersionConflict(
  id: string,
  saveBtn: HTMLButtonElement,
  saveOver: (latestVersion: number) => Promise<void>,
): Promise<void> {
  const { latestVersion } = await api.getDocument(id);
  const buttons = saveBtn.parentElement!;
  buttons.parentElement?.querySelector('.version-conflict')?.remove();

  const notice = document.createElement('div');
  notice.className = 'version-notice version-conflict mb-16';
  notice.setAttribute('role', 'alert');
  const text = document.createElement('p');
  text.textContent =
    `This document was saved as version ${latestVersion} while you were editing, ` +
    `so your changes are not saved yet. They are still here.`;

  const actions = document.createElement('div');
  actions.className = 'flex-row mt-8';
  const open = document.createElement('a');
  open.className = 'btn btn-sm';
  open.href = href(`/d/${id}/v/${latestVersion}`);
  open.target = '_blank';
  open.rel = 'noopener';
  open.textContent = `Open version ${latestVersion} in a new tab`;
  const over = document.createElement('button');
  over.type = 'button';
  over.className = 'btn btn-sm';
  over.textContent = `Save mine as version ${latestVersion + 1}`;
  over.title = `Version ${latestVersion} stays in the history`;
  over.addEventListener('click', () => {
    notice.remove();
    void saveOver(latestVersion);
  });
  actions.append(open, over);

  notice.append(text, actions);
  buttons.before(notice);
  // The Save button lost focus while it was disabled; put it on the notice so
  // the next Tab reaches its two choices. Focusable by script, not a Tab stop.
  notice.tabIndex = -1;
  notice.focus();
}

async function handleSave(
  id: string,
  loadedVersion: number,
  titleInput: HTMLInputElement,
  langSelect: HTMLSelectElement,
  visSelect: HTMLSelectElement,
  contentArea: HTMLTextAreaElement,
  msgInput: HTMLInputElement,
  expirySelect: HTMLSelectElement,
  saveBtn: HTMLButtonElement,
): Promise<void> {
  saveBtn.disabled = true;

  const input: {
    title: string;
    language: string;
    visibility: string;
    content: string;
    editMessage?: string;
    expiresInDays?: number | null;
    latestVersion: number;
  } = {
    title: titleInput.value.trim(),
    language: langSelect.value,
    visibility: visSelect.value,
    content: contentArea.value,
    // The version this page loaded: if someone saved since, the server refuses
    // instead of this save overwriting theirs.
    latestVersion: loadedVersion,
  };
  const editMsg = msgInput.value.trim();
  if (editMsg) input.editMessage = editMsg;
  if (expirySelect.value === 'never') input.expiresInDays = null;
  else if (expirySelect.value !== 'keep') input.expiresInDays = Number(expirySelect.value);

  try {
    await api.updateDocument(id, input);
    setUnsavedChangesCheck(null);
    navigate(`/d/${id}`);
    showToast('Document updated!', 'success');
  } catch (err) {
    if (err instanceof CredentialScanError) {
      const choice = await showRedactionModal(err.detected, saveBtn);
      if (choice) {
        try {
          await api.updateDocument(id, { ...input, redactionPolicy: choice.policy });
          setUnsavedChangesCheck(null);
          navigate(`/d/${id}`);
          showToast('Document updated!', 'success');
        } catch (err2) {
          showToast(`Failed: ${err2 instanceof Error ? err2.message : 'Unknown error'}`, 'error');
        }
      }
    } else if (err instanceof ApiError && err.status === 409) {
      // Someone saved a newer version since this page loaded it.
      await showVersionConflict(id, saveBtn, (latest) =>
        handleSave(
          id,
          latest,
          titleInput,
          langSelect,
          visSelect,
          contentArea,
          msgInput,
          expirySelect,
          saveBtn,
        ),
      ).catch(() =>
        showToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error'),
      );
    } else {
      showToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  } finally {
    saveBtn.disabled = false;
  }
}
