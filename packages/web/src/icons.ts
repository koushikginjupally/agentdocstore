/**
 * Inline SVG icons for empty/error states and action buttons.
 *
 * Emoji rendered as missing-glyph boxes on systems without an emoji font, their
 * colours ignored the theme, and screen readers announced the emoji name before
 * the label ("wastebasket Delete"). These use `currentColor`, so they follow the
 * surrounding text colour in light and dark mode, and are decorative
 * (`aria-hidden`): the adjacent text always carries the meaning.
 *
 * The markup is static and contains no user input, so it is safe to assign to
 * innerHTML.
 */

import { escapeHtml } from './dom.js';

function icon(paths: string, className: string, size: number): string {
  return (
    `<svg class="${className}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true" focusable="false">${paths}</svg>`
  );
}

const stateIcon = (paths: string): string => icon(paths, 'state-icon', 40);
const buttonIcon = (paths: string): string => icon(paths, 'action-icon', 16);

const SEARCH = '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>';
const DOCUMENT =
  '<path d="M8 3h7l4 4v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>' +
  '<path d="M15 3v4h4"/><path d="M9 12h6M9 16h4"/>';
const ERROR = '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>';

/** Magnifying glass: nothing found / no search results. */
export const ICON_SEARCH = stateIcon(SEARCH);

/** Stack of pages: an empty document list. */
export const ICON_DOCUMENTS = stateIcon(DOCUMENT);

/** Circle with a cross: something failed to load. */
export const ICON_ERROR = stateIcon(ERROR);

/** All state icons, for tests. */
export const STATE_ICONS = { ICON_SEARCH, ICON_DOCUMENTS, ICON_ERROR } as const;

/** Button-sized action icons. */
export const BUTTON_ICONS = {
  link: buttonIcon(
    '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/>' +
      '<path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  ),
  copy: buttonIcon(
    '<rect x="9" y="9" width="11" height="11" rx="2"/>' + '<path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  ),
  edit: buttonIcon('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13 7 4 4"/>'),
  history: buttonIcon(
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  ),
  trash: buttonIcon(
    '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/>' +
      '<path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  ),
  sun: buttonIcon(
    '<circle cx="12" cy="12" r="4"/>' +
      '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  ),
  moon: buttonIcon('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  warning: buttonIcon('<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>'),
} as const;

export type ButtonIcon = keyof typeof BUTTON_ICONS;

/**
 * Markup for an icon followed by a text label. The label is escaped, and it is
 * the element's whole accessible name because the icon is aria-hidden.
 */
export function iconLabelHtml(name: ButtonIcon, label: string): string {
  return `${BUTTON_ICONS[name]}<span>${escapeHtml(label)}</span>`;
}
