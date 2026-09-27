/**
 * Inline SVG icons for empty and error states.
 *
 * Emoji rendered as missing-glyph boxes on systems without an emoji font, and
 * their colours ignored the theme. These use `currentColor`, so they follow the
 * surrounding text colour in light and dark mode. They are decorative
 * (`aria-hidden`): the adjacent text always carries the meaning.
 *
 * The markup is static and contains no user input, so it is safe to assign to
 * innerHTML.
 */

function icon(paths: string): string {
  return (
    '<svg class="state-icon" viewBox="0 0 24 24" width="40" height="40" fill="none" ' +
    'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true" focusable="false">${paths}</svg>`
  );
}

/** Magnifying glass: nothing found / no search results. */
export const ICON_SEARCH = icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>');

/** Stack of pages: an empty document list. */
export const ICON_DOCUMENTS = icon(
  '<path d="M8 3h7l4 4v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>' +
    '<path d="M15 3v4h4"/><path d="M9 12h6M9 16h4"/>',
);

/** Circle with a cross: something failed to load. */
export const ICON_ERROR = icon('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>');

/** All state icons, for tests. */
export const STATE_ICONS = { ICON_SEARCH, ICON_DOCUMENTS, ICON_ERROR } as const;
