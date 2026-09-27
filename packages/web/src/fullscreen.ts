/**
 * Read a document full screen.
 *
 * Offered only where the browser can show an element full screen (iPhone
 * Safari cannot). In full screen the document holds the focus, so the arrow,
 * Page and Space keys scroll it, and it shows its own Exit Full Screen button;
 * Escape also leaves. Focus then returns to the button that opened it.
 */

import { iconLabelHtml } from './icons.js';
import { showToast } from './toast.js';

/** Whether this browser can show an element full screen. */
function canShowFullScreen(): boolean {
  return (
    document.fullscreenEnabled === true &&
    typeof HTMLElement.prototype.requestFullscreen === 'function'
  );
}

/**
 * A Full Screen button for `target`, or null where the browser cannot do it.
 * Call it once `target` holds its content: the exit bar goes at the top.
 */
export function fullScreenButton(target: HTMLElement): HTMLButtonElement | null {
  if (!canShowFullScreen()) return null;

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn btn-sm';
  open.innerHTML = iconLabelHtml('expand', 'Full Screen');

  // Hidden by the stylesheet unless `target` is full screen.
  const bar = document.createElement('div');
  bar.className = 'fullscreen-bar';
  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'btn btn-sm';
  exit.innerHTML = iconLabelHtml('collapse', 'Exit Full Screen');
  exit.addEventListener('click', () => {
    void document.exitFullscreen().catch(() => undefined);
  });
  bar.appendChild(exit);
  target.prepend(bar);

  // Focusable by script, so the keyboard scrolls it; not a Tab stop.
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');

  let shown = false;
  open.addEventListener('click', () => {
    target.requestFullscreen().then(
      () => {
        shown = true;
        target.focus();
      },
      () => showToast('Full screen is not available here', 'error'),
    );
  });
  // Fired at the element on the way in and out, however it ends.
  target.addEventListener('fullscreenchange', () => {
    if (shown && document.fullscreenElement !== target) {
      shown = false;
      open.focus();
    }
  });
  // Browsers normally take Escape themselves; where they pass it to the page
  // instead, it still leaves.
  target.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.fullscreenElement === target) {
      void document.exitFullscreen().catch(() => undefined);
    }
  });

  return open;
}
