// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { focusPageHeading, markFieldInvalid } from './dom.js';

describe('markFieldInvalid', () => {
  it('flags and focuses the field, then clears the flag once the user types', () => {
    document.body.innerHTML = '<textarea id="c"></textarea><button>Create</button>';
    const field = document.getElementById('c') as HTMLTextAreaElement;
    (document.querySelector('button') as HTMLButtonElement).focus();

    markFieldInvalid(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);

    field.value = 'x';
    field.dispatchEvent(new Event('input'));
    expect(field.hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('focusPageHeading', () => {
  let main: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    main = document.createElement('main');
    document.body.appendChild(main);
  });

  it('focuses the first h1 so the new page is announced', () => {
    main.innerHTML = '<h2>Sub</h2><h1>Doc title</h1><button>Edit</button>';
    focusPageHeading(main);
    const h1 = main.querySelector('h1');
    expect(document.activeElement).toBe(h1);
    // Focusable by script only; it must not become a Tab stop.
    expect(h1?.getAttribute('tabindex')).toBe('-1');
  });

  it('falls back to the first h2 when the page has no h1', () => {
    main.innerHTML = '<h2>Create New Document</h2><h2>My Documents</h2>';
    focusPageHeading(main);
    expect(document.activeElement?.textContent).toBe('Create New Document');
  });

  it('keeps an existing tabindex and does nothing without a heading', () => {
    main.innerHTML = '<h1 tabindex="0">Kept</h1>';
    focusPageHeading(main);
    expect(main.querySelector('h1')?.getAttribute('tabindex')).toBe('0');

    main.innerHTML = '<p>No heading</p>';
    document.body.focus();
    expect(() => focusPageHeading(main)).not.toThrow();
  });
});
