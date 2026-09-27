/** A Preview toggle for the content field of the create and edit forms. */
import { renderContent } from './render.js';

/**
 * A Preview button and the panel it shows in place of the text box: the text
 * rendered the way the document page will render it, in the language picked
 * on the form. It goes through the same renderer, and so the same sanitizing,
 * as the document page. Pressing it again brings the text box back, focused.
 *
 * The button is a toggle (aria-pressed) whose label stays "Preview".
 */
export function contentPreview(
  contentArea: HTMLTextAreaElement,
  languageSelect: HTMLSelectElement,
): { toggle: HTMLButtonElement; panel: HTMLElement } {
  const panel = document.createElement('div');
  panel.id = `${contentArea.id}-preview`;
  panel.className = 'content-preview';
  panel.hidden = true;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'btn btn-sm';
  toggle.textContent = 'Preview';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.setAttribute('aria-controls', panel.id);

  toggle.addEventListener('click', () => {
    const previewing = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(previewing));
    if (!previewing) {
      panel.hidden = true;
      panel.replaceChildren();
      contentArea.hidden = false;
      contentArea.focus();
      return;
    }
    // A fresh element each time, so nothing the renderer attached to the last
    // preview carries over.
    const view = document.createElement('div');
    panel.replaceChildren(view);
    contentArea.hidden = true;
    panel.hidden = false;
    renderContent(languageSelect.value, contentArea.value, view).catch((err: unknown) => {
      view.textContent = `Could not show a preview: ${err instanceof Error ? err.message : 'unknown error'}`;
    });
  });

  return { toggle, panel };
}
