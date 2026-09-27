// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { downloadFileName, downloadText, focusPageHeading, markFieldInvalid } from './dom.js';

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

describe('downloadFileName', () => {
  it('uses the title and the extension for the language', () => {
    expect(downloadFileName('Release notes', 'markdown')).toBe('Release notes.md');
    expect(downloadFileName('retry', 'typescript')).toBe('retry.ts');
    expect(downloadFileName('build', 'dockerfile')).toBe('build.dockerfile');
    expect(downloadFileName('notes', 'plaintext')).toBe('notes.txt');
  });

  it('replaces characters that file systems reject', () => {
    expect(downloadFileName('a/b\\c:d*e?f"g<h>i|j', 'json')).toBe('a-b-c-d-e-f-g-h-i-j.json');
    expect(downloadFileName('line\nbreak', 'text')).toBe('line-break.txt');
  });

  it('falls back to a name when the title leaves nothing usable', () => {
    expect(downloadFileName('   ', 'markdown')).toBe('document.md');
    expect(downloadFileName('...', 'markdown')).toBe('document.md');
    expect(downloadFileName('x', 'klingon')).toBe('x.txt');
  });

  it('keeps names to a sensible length', () => {
    expect(downloadFileName('a'.repeat(300), 'markdown')).toBe(`${'a'.repeat(100)}.md`);
  });
});

describe('downloadText', () => {
  it('saves the text through a temporary object URL, with no request', () => {
    const created: Blob[] = [];
    const revoked: string[] = [];
    const clicked: Array<{ href: string; download: string }> = [];
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = (blob: Blob): string => {
      created.push(blob);
      return 'blob:test/1';
    };
    URL.revokeObjectURL = (url: string): void => {
      revoked.push(url);
    };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    vi.useFakeTimers();
    try {
      downloadText('hello', 'notes.md');
      vi.runAllTimers();
      expect(created).toHaveLength(1);
      expect(created[0]!.type).toBe('text/plain;charset=utf-8');
      expect(clicked).toEqual([{ href: 'blob:test/1', download: 'notes.md' }]);
      expect(revoked).toEqual(['blob:test/1']);
      expect(document.querySelector('a[download]')).toBeNull();
    } finally {
      vi.useRealTimers();
      click.mockRestore();
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
  });
});
