/**
 * Ctrl+B and Ctrl+I (Cmd on a Mac) in the content box of a markdown document:
 * make the selection bold or italic, or take that off again. With nothing
 * selected, the markers go in with the cursor between them. Other languages
 * keep the keys as they are.
 *
 * Emphasis is counted in asterisks around the text: 1 is italic, 2 bold, 3
 * both, so the two shortcuts combine and undo independently.
 */

const SHORTCUTS = 'Control+B Control+I Meta+B Meta+I';

export function addMarkdownShortcuts(
  contentArea: HTMLTextAreaElement,
  languageSelect: HTMLSelectElement,
): void {
  const isMarkdown = (): boolean => languageSelect.value === 'markdown';

  // Screen readers announce the shortcuts; only while they work.
  const announce = (): void => {
    if (isMarkdown()) contentArea.setAttribute('aria-keyshortcuts', SHORTCUTS);
    else contentArea.removeAttribute('aria-keyshortcuts');
  };
  announce();
  languageSelect.addEventListener('change', announce);
  contentArea.addEventListener('focus', announce);

  contentArea.addEventListener('keydown', (e) => {
    if (!isMarkdown() || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const key = e.key.toLowerCase();
    const stars = key === 'b' ? 2 : key === 'i' ? 1 : 0;
    if (stars === 0) return;
    e.preventDefault();
    toggleEmphasis(contentArea, stars);
  });
}

/** Asterisks in a row ending just before `from` (step -1) or starting at it (step 1). */
function runOfStars(text: string, from: number, step: 1 | -1): number {
  let count = 0;
  for (let i = step === 1 ? from : from - 1; i >= 0 && i < text.length; i += step) {
    if (text[i] !== '*') break;
    count++;
  }
  return count;
}

function toggleEmphasis(area: HTMLTextAreaElement, stars: 1 | 2): void {
  const text = area.value;
  let start = area.selectionStart;
  let end = area.selectionEnd;
  // A selection that took in the markers counts them as around it.
  while (start < end && text[start] === '*') start++;
  while (end > start && text[end - 1] === '*') end--;

  const core = text.slice(start, end);
  const around = Math.min(runOfStars(text, start, -1), runOfStars(text, end, 1), 3);
  const on = stars === 2 ? around >= 2 : around % 2 === 1;

  if (on) {
    replace(area, start - stars, end + stars, core);
    area.setSelectionRange(start - stars, start - stars + core.length);
  } else {
    const marker = '*'.repeat(stars);
    replace(area, start, end, `${marker}${core}${marker}`);
    area.setSelectionRange(start + stars, start + stars + core.length);
  }
}

/** Replace a range as one edit: one undo step, and one input event for listeners. */
function replace(area: HTMLTextAreaElement, start: number, end: number, text: string): void {
  area.focus();
  area.setSelectionRange(start, end);
  // insertText keeps the browser's own undo history; where it is missing (or
  // refused) the text is set directly and the change announced by hand.
  const inserted =
    typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  if (!inserted) {
    area.setRangeText(text, start, end, 'end');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
