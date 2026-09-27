/** Home page: create form + my documents list + search. */
import { api, CredentialScanError } from '../api.js';
import type { ApiDocument } from '../api.js';
import { navigate, href, setUnsavedChangesCheck, watchForUnsavedChanges } from '../router.js';
import { buildTitle, emptyListMessage } from '../constants.js';
import { expiryField, formatDate, LANGUAGES, markFieldInvalid } from '../dom.js';
import { showToast } from '../toast.js';
import { ICON_DOCUMENTS, ICON_SEARCH } from '../icons.js';
import { showRedactionModal } from '../redaction-modal.js';

export async function renderHomePage(container: HTMLElement): Promise<void> {
  document.title = buildTitle();
  container.innerHTML = '';

  // Create form card
  const formCard = document.createElement('div');
  formCard.className = 'card mb-16';

  const formTitle = document.createElement('h2');
  formTitle.className = 'panel-title';
  formTitle.textContent = 'Create New Document';
  formCard.appendChild(formTitle);

  // Title input
  const titleGroup = document.createElement('div');
  titleGroup.className = 'form-group';
  const titleLabel = document.createElement('label');
  titleLabel.setAttribute('for', 'doc-title');
  titleLabel.textContent = 'Title';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.id = 'doc-title';
  titleInput.placeholder = 'Untitled doc';
  titleGroup.appendChild(titleLabel);
  titleGroup.appendChild(titleInput);
  formCard.appendChild(titleGroup);

  // Language + Visibility row
  const rowDiv = document.createElement('div');
  rowDiv.className = 'flex-row gap-16';
  rowDiv.style.flexWrap = 'wrap';

  const langGroup = document.createElement('div');
  langGroup.className = 'form-group';
  langGroup.style.flex = '1';
  langGroup.style.minWidth = '150px';
  const langLabel = document.createElement('label');
  langLabel.setAttribute('for', 'doc-language');
  langLabel.textContent = 'Language';
  const langSelect = document.createElement('select');
  langSelect.id = 'doc-language';
  for (const lang of LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = lang;
    opt.textContent = lang;
    langSelect.appendChild(opt);
  }
  langGroup.appendChild(langLabel);
  langGroup.appendChild(langSelect);

  const visGroup = document.createElement('div');
  visGroup.className = 'form-group';
  visGroup.style.flex = '1';
  visGroup.style.minWidth = '150px';
  const visLabel = document.createElement('label');
  visLabel.setAttribute('for', 'doc-visibility');
  visLabel.textContent = 'Visibility';
  const visSelect = document.createElement('select');
  visSelect.id = 'doc-visibility';
  for (const v of ['PUBLIC', 'PRIVATE']) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    visSelect.appendChild(opt);
  }
  visGroup.appendChild(visLabel);
  visGroup.appendChild(visSelect);

  rowDiv.appendChild(langGroup);
  rowDiv.appendChild(visGroup);
  const expiry = expiryField('doc-expiry', [{ value: '', label: 'Never' }]);
  rowDiv.appendChild(expiry.group);
  formCard.appendChild(rowDiv);

  // Content textarea
  const contentGroup = document.createElement('div');
  contentGroup.className = 'form-group';
  const contentLabel = document.createElement('label');
  contentLabel.setAttribute('for', 'doc-content');
  contentLabel.textContent = 'Content';
  const contentArea = document.createElement('textarea');
  contentArea.id = 'doc-content';
  contentArea.placeholder = 'Write or paste your content here...';
  contentArea.rows = 15;
  contentGroup.appendChild(contentLabel);
  contentGroup.appendChild(contentArea);
  formCard.appendChild(contentGroup);

  // Submit button
  const createBtn = document.createElement('button');
  createBtn.className = 'btn btn-primary';
  createBtn.textContent = 'Create Document';
  createBtn.addEventListener(
    'click',
    () =>
      void handleCreate(titleInput, langSelect, visSelect, contentArea, expiry.select, createBtn),
  );
  formCard.appendChild(createBtn);

  container.appendChild(formCard);
  // Opening a document from the list would otherwise drop a half-written one.
  watchForUnsavedChanges([titleInput, contentArea]);

  // Search + My Documents section
  const listSection = document.createElement('div');
  listSection.className = 'card';

  const listTitle = document.createElement('h2');
  listTitle.className = 'panel-title';
  listTitle.textContent = 'My Documents';
  listSection.appendChild(listTitle);

  // Search bar
  const searchBar = document.createElement('div');
  searchBar.className = 'search-bar';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search documents...';
  searchInput.setAttribute('aria-label', 'Search documents');
  const searchBtn = document.createElement('button');
  searchBtn.className = 'btn';
  searchBtn.textContent = 'Search';
  searchBar.appendChild(searchInput);
  searchBar.appendChild(searchBtn);
  listSection.appendChild(searchBar);

  const documentListEl = document.createElement('ul');
  documentListEl.className = 'doc-list';
  documentListEl.id = 'doc-list';
  listSection.appendChild(documentListEl);

  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.className = 'btn mt-16';
  loadMoreBtn.textContent = 'Load More';
  loadMoreBtn.style.display = 'none';
  loadMoreBtn.id = 'load-more-btn';
  listSection.appendChild(loadMoreBtn);

  container.appendChild(listSection);

  // Load initial list
  let currentCursor: string | undefined;
  let currentQuery = '';

  const loadDocuments = async (append: boolean) => {
    try {
      const result = await api.listDocuments(
        currentQuery || undefined,
        append ? currentCursor : undefined,
        20,
      );
      if (!append) documentListEl.innerHTML = '';
      renderDocumentList(result.items, documentListEl);
      currentCursor = result.nextCursor;
      loadMoreBtn.style.display = result.nextCursor ? 'inline-flex' : 'none';
      if (!append && result.items.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'empty-state';
        const icon = document.createElement('div');
        icon.className = 'icon';
        icon.setAttribute('aria-hidden', 'true');
        // Static SVG markup from icons.ts — never user input.
        icon.innerHTML = currentQuery ? ICON_SEARCH : ICON_DOCUMENTS;
        const message = document.createElement('div');
        message.textContent = emptyListMessage(currentQuery);
        empty.append(icon, message);
        documentListEl.replaceChildren(empty);
      }
    } catch (err) {
      showToast(
        `Failed to load documents: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error',
      );
    }
  };

  searchBtn.addEventListener('click', () => {
    currentQuery = searchInput.value.trim();
    void loadDocuments(false);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      currentQuery = searchInput.value.trim();
      void loadDocuments(false);
    }
  });
  loadMoreBtn.addEventListener('click', () => void loadDocuments(true));

  await loadDocuments(false);
}

async function handleCreate(
  titleInput: HTMLInputElement,
  langSelect: HTMLSelectElement,
  visSelect: HTMLSelectElement,
  contentArea: HTMLTextAreaElement,
  expirySelect: HTMLSelectElement,
  createBtn: HTMLButtonElement,
): Promise<void> {
  const title = titleInput.value.trim() || 'Untitled';
  const content = contentArea.value;
  const language = langSelect.value;
  const visibility = visSelect.value;
  // '' is "Never"; any other value is a number of days.
  const expiry = expirySelect.value ? { expiresInDays: Number(expirySelect.value) } : {};

  if (!content) {
    showToast('Content is required', 'error');
    markFieldInvalid(contentArea);
    return;
  }

  createBtn.disabled = true;
  try {
    const doc = await api.createDocument({ title, content, language, visibility, ...expiry });
    setUnsavedChangesCheck(null);
    navigate(`/d/${doc.id}`);
    showToast('Document created!', 'success');
  } catch (err) {
    if (err instanceof CredentialScanError) {
      const choice = await showRedactionModal(err.detected, createBtn);
      if (choice) {
        try {
          const doc = await api.createDocument({
            title,
            content,
            language,
            visibility,
            ...expiry,
            redactionPolicy: choice.policy,
          });
          setUnsavedChangesCheck(null);
          navigate(`/d/${doc.id}`);
          showToast('Document created!', 'success');
        } catch (err2) {
          showToast(`Failed: ${err2 instanceof Error ? err2.message : 'Unknown error'}`, 'error');
        }
      }
    } else {
      showToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  } finally {
    createBtn.disabled = false;
  }
}

function renderDocumentList(documents: ApiDocument[], listEl: HTMLElement): void {
  for (const doc of documents) {
    const li = document.createElement('li');
    li.className = 'doc-list-item';

    // REAL <a> anchor for proper middle-click / cmd-click behavior
    const link = document.createElement('a');
    link.className = 'doc-list-link';
    link.href = href(`/d/${doc.id}`);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'doc-title';
    titleSpan.textContent = doc.title;

    const meta = document.createElement('div');
    meta.className = 'doc-meta';
    const visBadge =
      doc.visibility === 'PRIVATE'
        ? '<span class="visibility-badge private">Private</span>'
        : '<span class="visibility-badge public">Public</span>';
    meta.innerHTML = `${visBadge} &middot; ${doc.language} &middot; v${doc.latestVersion} &middot; ${formatDate(doc.updatedAt)}`;

    link.appendChild(titleSpan);
    link.appendChild(meta);
    li.appendChild(link);
    listEl.appendChild(li);
  }
}
