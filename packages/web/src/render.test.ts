// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderContent } from './render.js';

async function renderMarkdown(source: string): Promise<HTMLElement> {
  const container = document.createElement('div');
  await renderContent('markdown', source, container);
  return container;
}

describe('markdown sanitizing', () => {
  it('drops iframes, so a document cannot embed another site', async () => {
    const page = await renderMarkdown(
      'Before\n\n<iframe src="https://example.com/login"></iframe>\n\nAfter',
    );
    expect(page.querySelector('iframe')).toBeNull();
    expect(page.textContent).toContain('Before');
    expect(page.textContent).toContain('After');
  });

  it('drops scripts and event handlers', async () => {
    const page = await renderMarkdown(
      '<img src="x.png" onerror="alert(1)"><script>alert(2)</script>\n\n**kept**',
    );
    expect(page.querySelector('script')).toBeNull();
    expect(page.querySelector('img')?.getAttribute('onerror')).toBeNull();
    expect(page.querySelector('strong')?.textContent).toBe('kept');
  });
});

describe('in-document links', () => {
  /** Click the link with `text` inside `page`; return whether its navigation was cancelled. */
  function click(page: HTMLElement, text: string): boolean {
    const link = [...page.querySelectorAll('a')].find((a) => a.textContent === text)!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('gives headings prefixed, de-duplicated ids', async () => {
    const page = await renderMarkdown('# Run Book!\n\n## Rollback\n\n## Rollback\n\n### Étape 2');
    expect([...page.querySelectorAll('h1, h2, h3')].map((h) => h.id)).toEqual([
      'user-content-run-book',
      'user-content-rollback',
      'user-content-rollback-1',
      'user-content-étape-2',
    ]);
  });

  it('scrolls to the heading instead of changing the page route', async () => {
    const page = await renderMarkdown('[the rollback steps](#rollback)\n\n## Rollback');
    document.body.appendChild(page);
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const before = window.location.hash;
      expect(click(page, 'the rollback steps')).toBe(true);
      expect(window.location.hash).toBe(before);
      const heading = page.querySelector('h2')!;
      expect(scrolled).toEqual([heading]);
      expect(document.activeElement).toBe(heading);
    } finally {
      Element.prototype.scrollIntoView = original;
      page.remove();
    }
  });

  it('keeps an unknown section link from changing the route', async () => {
    const page = await renderMarkdown('[nowhere](#missing-section)');
    expect(click(page, 'nowhere')).toBe(true);
  });

  it('leaves links to other app pages to the router', async () => {
    const page = await renderMarkdown('[another document](#/d/abc123DEF4)');
    const link = page.querySelector('a')!;
    // Stop jsdom from navigating after the renderer's listener has decided.
    let cancelledByRenderer = true;
    page.addEventListener('click', (event) => {
      cancelledByRenderer = event.defaultPrevented;
      event.preventDefault();
    });
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(cancelledByRenderer).toBe(false);
  });
});
