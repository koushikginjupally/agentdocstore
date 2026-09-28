// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { addMarkdownShortcuts, markdownFormatButtons } from './markdown-shortcuts.js';

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

describe('Bold and Italic buttons', () => {
  function withButtons(value: string, language = 'markdown') {
    const { area, select } = editor(value, language);
    const group = markdownFormatButtons(area, select);
    document.body.appendChild(group);
    const button = (name: string): HTMLButtonElement =>
      group.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
    return { area, select, group, bold: button('Bold'), italic: button('Italic') };
  }

  it('offers Bold and Italic for markdown, named for screen readers', () => {
    const { group, bold, italic } = withButtons('fix');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('Formatting');
    expect(group.hidden).toBe(false);
    expect([bold.textContent, italic.textContent]).toEqual(['B', 'I']);
    expect([bold.type, italic.type]).toEqual(['button', 'button']);
    expect(bold.title).toMatch(/^Bold \((Ctrl\+|⌘)B\)$/);
    expect(italic.title).toMatch(/^Italic \((Ctrl\+|⌘)I\)$/);
  });

  it('shows them only while the language is markdown', () => {
    const { select, group } = withButtons('fix', 'python');
    expect(group.hidden).toBe(true);
    select.value = 'markdown';
    select.dispatchEvent(new Event('change'));
    expect(group.hidden).toBe(false);
    select.value = 'python';
    select.dispatchEvent(new Event('change'));
    expect(group.hidden).toBe(true);
  });

  it('Bold makes the selection bold and puts the cursor back in the box', () => {
    const { area, bold } = withButtons('ship the fix today');
    area.setSelectionRange(9, 12); // "fix"
    bold.focus();
    bold.click();
    expect(area.value).toBe('ship the **fix** today');
    expect(selected(area)).toBe('fix');
    expect(document.activeElement).toBe(area);
  });

  it('pressing Bold again takes it off, and the two combine', () => {
    const { area, bold, italic } = withButtons('fix');
    area.setSelectionRange(0, 3);
    bold.click();
    italic.click();
    expect(area.value).toBe('***fix***');
    bold.click();
    expect(area.value).toBe('*fix*');
    expect(selected(area)).toBe('fix');
  });

  it('Italic with nothing selected puts the markers in with the cursor between', () => {
    const { area, italic } = withButtons('a');
    area.setSelectionRange(1, 1);
    italic.click();
    expect(area.value).toBe('a**');
    expect([area.selectionStart, area.selectionEnd]).toEqual([2, 2]);
  });

  it('a mouse press keeps the focus, and so the selection, in the box', () => {
    const { bold } = withButtons('fix');
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    expect(bold.dispatchEvent(press)).toBe(false);
  });

  it('hides them while the box is hidden for a preview', async () => {
    const { area, group } = withButtons('fix');
    area.hidden = true;
    await Promise.resolve();
    expect(group.hidden).toBe(true);
    area.hidden = false;
    await Promise.resolve();
    expect(group.hidden).toBe(false);
  });
});
