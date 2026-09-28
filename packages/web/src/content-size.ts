/**
 * The size note under a document's content box. It stays empty for ordinary
 * documents, shows the size against the server's limit from 90% of it, and
 * says how much to cut once over — so a writer near the limit sees it while
 * typing instead of learning it from a refused save.
 */

import { MAX_CONTENT_BYTES, contentSizeMessage, utf8Bytes } from './constants.js';

export interface ContentSizeNote {
  /** The note, to place right after the box. */
  readonly note: HTMLParagraphElement;
  /** Measure again. Typing does this itself; call it after setting the value from code. */
  readonly update: () => void;
}

export function contentSizeNote(area: HTMLTextAreaElement): ContentSizeNote {
  const note = document.createElement('p');
  note.id = `${area.id}-size`;
  note.className = 'content-size text-sm text-muted';
  const described = area.getAttribute('aria-describedby');
  area.setAttribute('aria-describedby', described ? `${described} ${note.id}` : note.id);

  const update = (): void => {
    const text = area.value;
    // A UTF-16 unit is at most 3 bytes of UTF-8, so a box this short cannot be
    // near the limit; skip encoding it on every keystroke.
    const bytes = text.length * 3 < MAX_CONTENT_BYTES * 0.9 ? 0 : utf8Bytes(text);
    note.textContent = contentSizeMessage(bytes);
    note.classList.toggle('over-limit', bytes > MAX_CONTENT_BYTES);
  };
  area.addEventListener('input', update);
  update();
  return { note, update };
}
