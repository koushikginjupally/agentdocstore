/**
 * Redaction modal for the 409 credential-scan flow.
 * Shows detected credential types and offers Redact / Save Anyway options.
 */

import { iconLabelHtml } from './icons.js';

export interface RedactionChoice {
  policy: 'redact' | 'skip';
}

/**
 * Show the redaction modal and return the user's choice.
 * Returns null if cancelled.
 */
export function showRedactionModal(detected: string[]): Promise<RedactionChoice | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Credentials detected');

    const modal = document.createElement('div');
    modal.className = 'modal';

    const title = document.createElement('h2');
    title.className = 'modal-title';
    title.innerHTML = iconLabelHtml('warning', 'Credentials Detected');

    const body = document.createElement('div');
    body.className = 'modal-body';

    const desc = document.createElement('p');
    desc.textContent = 'The following credential types were detected in your content:';

    const list = document.createElement('ul');
    list.style.margin = '12px 0';
    list.style.paddingLeft = '20px';
    for (const type of detected) {
      const li = document.createElement('li');
      li.textContent = type;
      li.style.fontWeight = '500';
      list.appendChild(li);
    }

    const question = document.createElement('p');
    question.textContent = 'How would you like to proceed?';

    body.appendChild(desc);
    body.appendChild(list);
    body.appendChild(question);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });

    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn-danger';
    skipBtn.textContent = 'Save Anyway';
    skipBtn.addEventListener('click', () => {
      overlay.remove();
      resolve({ policy: 'skip' });
    });

    const redactBtn = document.createElement('button');
    redactBtn.className = 'btn btn-primary';
    redactBtn.textContent = 'Redact & Save';
    redactBtn.addEventListener('click', () => {
      overlay.remove();
      resolve({ policy: 'redact' });
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(skipBtn);
    actions.appendChild(redactBtn);

    modal.appendChild(title);
    modal.appendChild(body);
    modal.appendChild(actions);
    overlay.appendChild(modal);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });

    // Close on Escape
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(null);
      }
    };
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    redactBtn.focus();
  });
}
