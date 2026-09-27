// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderNotFoundPage } from './not-found.js';

describe('not-found page', () => {
  it('names the page in its h1', () => {
    document.body.innerHTML = '<main></main>';
    const main = document.querySelector('main')!;
    renderNotFoundPage(main);
    expect([...main.querySelectorAll('h1, h2, h3')].map((h) => h.tagName)).toEqual(['H1']);
    expect(main.querySelector('h1')?.textContent).toBe('Page Not Found');
  });
});
