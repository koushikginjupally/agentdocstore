// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { addMarkdownShortcuts } from './markdown-shortcuts.js';

function editor(value: string, language = 'markdown') {
  document.body.innerHTML = `
    <select id="lang"><option value="markdown">markdown</option><option value="python">python</option></select>
    <textarea id="content"></textarea>`;
  const select = document.querySelector<HTMLSelectElement>('#lang')!;
  const area = document.querySelector<HTMLTextAreaElement>('#content')!;
  select.value = language;
  area.value = value;
  addMarkdownShortcuts(area, select);
  return { area, select };
}

/** Press a shortcut in the text box; returns whether the browser default was kept. */
function press(area: HTMLTextAreaElement, key: string, mod: 'ctrl' | 'meta' = 'ctrl'): boolean {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: mod === 'ctrl',
    metaKey: mod === 'meta',
    bubbles: true,
    cancelable: true,
  });
  return area.dispatchEvent(event);
}

const selected = (area: HTMLTextAreaElement): string =>
  area.value.slice(area.selectionStart, area.selectionEnd);

describe('markdown shortcuts', () => {
  it('Ctrl+B makes the selection bold and keeps it selected', () => {
    const { area } = editor('ship the fix today');
    area.setSelectionRange(9, 12); // "fix"
    expect(press(area, 'b')).toBe(false);
    expect(area.value).toBe('ship the **fix** today');
    expect(selected(area)).toBe('fix');
  });

  it('Ctrl+I makes the selection italic', () => {
    const { area } = editor('ship the fix today');
    area.setSelectionRange(9, 12);
    press(area, 'i');
    expect(area.value).toBe('ship the *fix* today');
    expect(selected(area)).toBe('fix');
  });

  it('undoes the formatting when pressed again on the same text', () => {
    const { area } = editor('ship the **fix** today');
    area.setSelectionRange(11, 14); // "fix" inside the markers
    press(area, 'b');
    expect(area.value).toBe('ship the fix today');
    expect(selected(area)).toBe('fix');
  });

  it('combines bold and italic, and takes each off on its own', () => {
    const { area } = editor('**fix**');
    area.setSelectionRange(2, 5);
    press(area, 'i');
    expect(area.value).toBe('***fix***');
    expect(selected(area)).toBe('fix');
    press(area, 'b');
    expect(area.value).toBe('*fix*');
    expect(selected(area)).toBe('fix');
    press(area, 'i');
    expect(area.value).toBe('fix');
  });

  it('with nothing selected, adds the markers and puts the cursor between them', () => {
    const { area } = editor('note: ');
    area.setSelectionRange(6, 6);
    press(area, 'b');
    expect(area.value).toBe('note: ****');
    expect(area.selectionStart).toBe(8);
    expect(area.selectionEnd).toBe(8);
  });

  it('takes Cmd on a Mac as well as Ctrl, and upper-case keys', () => {
    const { area } = editor('fix');
    area.setSelectionRange(0, 3);
    press(area, 'B', 'meta');
    expect(area.value).toBe('**fix**');
  });

  it('tells the page the text changed, so unsaved-changes checks see it', () => {
    const { area } = editor('fix');
    let inputs = 0;
    area.addEventListener('input', () => inputs++);
    area.setSelectionRange(0, 3);
    press(area, 'b');
    expect(inputs).toBe(1);
  });

  it('does nothing when the document is not markdown', () => {
    const { area } = editor('fix', 'python');
    area.setSelectionRange(0, 3);
    expect(press(area, 'b')).toBe(true);
    expect(area.value).toBe('fix');
  });

  it('leaves other key combinations alone', () => {
    const { area } = editor('fix');
    area.setSelectionRange(0, 3);
    const shifted = new KeyboardEvent('keydown', {
      key: 'b',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    expect(area.dispatchEvent(shifted)).toBe(true);
    expect(press(area, 'k')).toBe(true);
    expect(area.value).toBe('fix');
  });

  it('announces the shortcuts only while the language is markdown', () => {
    const { area, select } = editor('fix');
    expect(area.getAttribute('aria-keyshortcuts')).toBe('Control+B Control+I Meta+B Meta+I');
    select.value = 'python';
    select.dispatchEvent(new Event('change'));
    expect(area.hasAttribute('aria-keyshortcuts')).toBe(false);
  });
});
