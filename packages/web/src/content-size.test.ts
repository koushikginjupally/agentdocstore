// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { MAX_CONTENT_BYTES } from './constants.js';
import { contentSizeNote } from './content-size.js';

function box(value = ''): HTMLTextAreaElement {
  const area = document.createElement('textarea');
  area.id = 'doc-content';
  area.value = value;
  return area;
}

function type(area: HTMLTextAreaElement, value: string): void {
  area.value = value;
  area.dispatchEvent(new Event('input'));
}

describe('contentSizeNote', () => {
  it('says nothing for an ordinary document', () => {
    const area = box('# Notes\n\nShort.');
    const { note } = contentSizeNote(area);
    expect(note.textContent).toBe('');
    expect(note.classList.contains('over-limit')).toBe(false);
  });

  it('describes the box, keeping any description it already had', () => {
    const area = box();
    area.setAttribute('aria-describedby', 'hint');
    const { note } = contentSizeNote(area);
    expect(note.id).toBe('doc-content-size');
    expect(area.getAttribute('aria-describedby')).toBe('hint doc-content-size');
  });

  it('shows the size while typing once the content nears the limit', () => {
    const area = box();
    const { note } = contentSizeNote(area);
    type(area, 'x'.repeat(4_800_000));
    expect(note.textContent).toBe('4,800,000 of 5,242,880 bytes');
    expect(note.classList.contains('over-limit')).toBe(false);
  });

  it('counts UTF-8 bytes, as the server does, not characters', () => {
    const area = box();
    const { note } = contentSizeNote(area);
    type(area, 'é'.repeat(2_400_000));
    expect(note.textContent).toBe('4,800,000 of 5,242,880 bytes');
  });

  it('says how much to cut, and is marked, once over the limit', () => {
    const area = box();
    const { note } = contentSizeNote(area);
    type(area, 'x'.repeat(MAX_CONTENT_BYTES + 5));
    expect(note.textContent).toBe(
      '5,242,885 of 5,242,880 bytes. Shorten the content by 5 bytes to save it.',
    );
    expect(note.classList.contains('over-limit')).toBe(true);
    type(area, 'x'.repeat(10));
    expect(note.textContent).toBe('');
    expect(note.classList.contains('over-limit')).toBe(false);
  });

  it('measures content that was already in the box, and again on update()', () => {
    const area = box('x'.repeat(4_800_000));
    const size = contentSizeNote(area);
    expect(size.note.textContent).toBe('4,800,000 of 5,242,880 bytes');
    area.value = 'x'.repeat(5_000_000); // set from code: no input event
    size.update();
    expect(size.note.textContent).toBe('5,000,000 of 5,242,880 bytes');
  });
});
