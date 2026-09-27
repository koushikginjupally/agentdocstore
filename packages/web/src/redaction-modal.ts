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
export function showRedactionModal(
  detected: string[],
  returnFocusTo?: HTMLElement,
): Promise<RedactionChoice | null> {
  return new Promise((resolve) => {
    // Focus goes back here when the dialog closes, so keyboard users land
    // where they were rather than at the top of the page. Callers pass the
    // triggering button explicitly: they disable it before the request, and a
    // browser moves focus off a button when it is disabled, so
    // document.activeElement is usually <body> by the time this runs.
    const current = document.activeElement;
    const opener =
      returnFocusTo ??
      (current instanceof HTMLElement && current !== document.body ? current : null);
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
    cancelBtn.addEventListener('click', () => close(null));

    const skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn-danger';
    skipBtn.textContent = 'Save Anyway';
    skipBtn.addEventListener('click', () => close({ policy: 'skip' }));

    const redactBtn = document.createElement('button');
    redactBtn.className = 'btn btn-primary';
    redactBtn.textContent = 'Redact & Save';
    redactBtn.addEventListener('click', () => close({ policy: 'redact' }));

    actions.appendChild(cancelBtn);
    actions.appendChild(skipBtn);
    actions.appendChild(redactBtn);

    modal.appendChild(title);
    modal.appendChild(body);
    modal.appendChild(actions);
    overlay.appendChild(modal);

    const focusable = [cancelBtn, skipBtn, redactBtn];

    // Every way out goes through here, so the keydown listener is always
    // removed and focus always returns to the opener.
    function close(choice: RedactionChoice | null): void {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(choice);
      // Callers disable the button that opened the dialog while the request is
      // in flight and re-enable it in a finally block, and focus() on a
      // disabled button is a no-op. Restore focus on the next task, after that
      // finally has run.
      setTimeout(() => {
        if (opener?.isConnected) opener.focus();
      }, 0);
    }

    // Escape closes; Tab and Shift+Tab cycle within the dialog (aria-modal
    // alone does not stop focus reaching the page behind it).
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
        return;
      }
      if (e.key !== 'Tab') return;
      const index = focusable.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.shiftKey ? -1 : 1;
      const next = focusable[(index + step + focusable.length) % focusable.length];
      e.preventDefault();
      next?.focus();
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    redactBtn.focus();
  });
}
