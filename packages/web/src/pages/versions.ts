/** Versions page: list versions, pick two for diff view. */
import { api, ApiError } from '../api.js';
import { ICON_ERROR, ICON_SEARCH } from '../icons.js';
import { href } from '../router.js';
import { buildTitle } from '../constants.js';
import { formatDate } from '../dom.js';
import { showToast } from '../toast.js';

export async function renderVersionsPage(id: string, container: HTMLElement): Promise<void> {
  container.innerHTML = '<div class="loading-state"><span class="spinner"></span> Loading...</div>';

  try {
    const [doc, versions] = await Promise.all([api.getDocument(id), api.getVersions(id)]);

    document.title = buildTitle(`Versions: ${doc.title}`);
    container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'flex-between mb-16';

    const left = document.createElement('div');
    const h1 = document.createElement('h1');
    h1.style.fontSize = '1.3rem';
    h1.textContent = `Versions of "${doc.title}"`;
    left.appendChild(h1);

    const backLink = document.createElement('a');
    backLink.href = href(`/d/${id}`);
    backLink.className = 'btn btn-sm';
    backLink.textContent = '← Back to Document';

    header.appendChild(left);
    header.appendChild(backLink);
    container.appendChild(header);

    // Version list card
    const card = document.createElement('div');
    card.className = 'card';

    const instructions = document.createElement('p');
    instructions.className = 'text-muted text-sm mb-16';
    instructions.textContent = 'Select two versions to compare:';
    card.appendChild(instructions);

    const selectedVersions: Set<number> = new Set();

    const list = document.createElement('ul');
    list.className = 'version-list';

    // Sort versions descending (newest first)
    const sorted = [...versions].sort((a, b) => b.version - a.version);

    for (const ver of sorted) {
      const li = document.createElement('li');
      li.className = 'version-list-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'version-checkbox';
      checkbox.setAttribute('aria-label', `Select version ${ver.version}`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (selectedVersions.size >= 2) {
            // Uncheck oldest selection
            const oldest = Math.min(...selectedVersions);
            selectedVersions.delete(oldest);
            const oldCb = list.querySelector(
              `input[data-version="${oldest}"]`,
            ) as HTMLInputElement | null;
            if (oldCb) oldCb.checked = false;
          }
          selectedVersions.add(ver.version);
        } else {
          selectedVersions.delete(ver.version);
        }
      });
      checkbox.setAttribute('data-version', String(ver.version));

      const info = document.createElement('div');
      info.style.flex = '1';

      const versionLabel = document.createElement('span');
      versionLabel.className = 'version-badge';
      versionLabel.textContent = `v${ver.version}`;

      const meta = document.createElement('span');
      meta.className = 'text-muted text-sm';
      meta.style.marginLeft = '8px';
      meta.textContent = `${ver.createdBy} · ${formatDate(ver.createdAt)}`;

      info.appendChild(versionLabel);
      info.appendChild(meta);
      if (ver.message) {
        const note = document.createElement('div');
        note.className = 'version-message text-sm';
        note.textContent = ver.message;
        info.appendChild(note);
      }

      li.appendChild(checkbox);
      li.appendChild(info);
      const viewLink = document.createElement('a');
      viewLink.className = 'btn btn-sm';
      viewLink.href = href(`/d/${id}/v/${ver.version}`);
      viewLink.textContent = 'View';
      viewLink.setAttribute('aria-label', `View version ${ver.version}`);
      li.appendChild(viewLink);
      list.appendChild(li);
    }

    card.appendChild(list);

    // Compare button
    const compareBtn = document.createElement('button');
    compareBtn.className = 'btn btn-primary mt-16';
    compareBtn.textContent = 'Compare Selected';
    compareBtn.addEventListener('click', () => {
      if (selectedVersions.size !== 2) {
        showToast('Select exactly two versions to compare', 'error');
        return;
      }
      const [from, to] = [...selectedVersions].sort((a, b) => a - b);
      if (from !== undefined && to !== undefined) {
        void showDiff(id, from, to, diffContainer);
      }
    });
    card.appendChild(compareBtn);

    container.appendChild(card);

    // Diff container
    const diffContainer = document.createElement('div');
    diffContainer.id = 'diff-output';
    diffContainer.className = 'mt-24';
    container.appendChild(diffContainer);
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
        `Failed to load versions: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error',
      );
      container.innerHTML = `<div class="empty-state"><div class="icon">${ICON_ERROR}</div><div>Failed to load versions</div></div>`;
    }
  }
}

async function showDiff(
  documentId: string,
  from: number,
  to: number,
  container: HTMLElement,
): Promise<void> {
  container.innerHTML =
    '<div class="loading-state"><span class="spinner"></span> Computing diff...</div>';

  try {
    const result = await api.getDiff(documentId, from, to);
    container.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = `Diff: v${from} → v${to}`;
    container.appendChild(title);

    if (result.diff === '') {
      const same = document.createElement('p');
      same.className = 'text-muted';
      same.textContent = 'These versions have the same content.';
      container.appendChild(same);
      return;
    }

    const diffDiv = document.createElement('div');
    diffDiv.className = 'diff-container';

    // The diff opens with a file header ("=====", "--- vN", "+++ vM") that
    // repeats the title above; "--- vN" and "+++ vM" would otherwise show as a
    // removed and an added line. Rendering starts at the first hunk.
    const lines = result.diff.split('\n');
    const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
    for (const line of lines.slice(Math.max(firstHunk, 0))) {
      const lineEl = document.createElement('div');
      lineEl.className = 'diff-line';

      if (line.startsWith('@@')) {
        lineEl.className = 'diff-hunk';
        lineEl.textContent = line;
      } else if (line.startsWith('+')) {
        lineEl.className = 'diff-line diff-add';
        lineEl.textContent = line;
      } else if (line.startsWith('-')) {
        lineEl.className = 'diff-line diff-del';
        lineEl.textContent = line;
      } else {
        lineEl.textContent = line;
      }

      diffDiv.appendChild(lineEl);
    }

    container.appendChild(diffDiv);
  } catch (err) {
    container.innerHTML = '';
    showToast(
      `Failed to compute diff: ${err instanceof Error ? err.message : 'Unknown error'}`,
      'error',
    );
    container.innerHTML = '<p class="text-muted">Failed to compute diff.</p>';
  }
}
