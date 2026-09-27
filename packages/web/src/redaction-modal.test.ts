// @vitest-environment jsdom
/**
 * Keyboard and focus behaviour of the credential-redaction dialog.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showRedactionModal } from './redaction-modal.js';

let opener: HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML = '<button id="before">Before</button>';
  opener = document.createElement('button');
  opener.textContent = 'Create Document';
  document.body.appendChild(opener);
  opener.focus();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('.modal button')].find(
    (b) => b.textContent === label,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

function tab(shift = false): void {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }),
  );
}

describe('redaction modal', () => {
  it('removes its keydown listener however it is closed', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    for (const label of ['Cancel', 'Save Anyway', 'Redact & Save']) {
      const pending = showRedactionModal(['generic-secret']);
      button(label).click();
      await pending;
    }
    const pending = showRedactionModal(['generic-secret']);
    document.querySelector<HTMLElement>('.modal-overlay')!.click();
    await pending;

    const added = add.mock.calls.filter(([type]) => type === 'keydown').length;
    const removed = remove.mock.calls.filter(([type]) => type === 'keydown').length;
    expect(added).toBe(4);
    expect(removed).toBe(4);
  });

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    const pending = showRedactionModal(['generic-secret']);
    expect(document.activeElement).toBe(button('Redact & Save'));

    tab();
    expect(document.activeElement).toBe(button('Cancel'));
    tab(true);
    expect(document.activeElement).toBe(button('Redact & Save'));

    button('Cancel').click();
    await pending;
  });

  it('returns focus to the opener once the caller re-enables it', async () => {
    // Mirrors the create/save handlers: the button is disabled before the
    // request (which moves focus to <body>), passed in, then re-enabled.
    opener.disabled = true;
    opener.blur();
    const pending = showRedactionModal(['generic-secret'], opener).finally(() => {
      opener.disabled = false;
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await pending).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(opener);
  });
});
