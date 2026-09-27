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

describe('contents list for long documents', () => {
  const long = '# Runbook\n\nIntro\n\n## Deploy\n\nSteps\n\n### Roll back\n\nMore\n\n## Checks\n';

  it('lists the h1-h3 headings in order, closed until opened, as a labelled navigation', async () => {
    const page = await renderMarkdown(long);
    const nav = page.querySelector('nav[aria-label="Contents"]')!;
    expect(nav).not.toBeNull();
    const details = nav.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Contents (4)');
    const links = [...nav.querySelectorAll('a')];
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Runbook', '#user-content-runbook'],
      ['Deploy', '#user-content-deploy'],
      ['Roll back', '#user-content-roll-back'],
      ['Checks', '#user-content-checks'],
    ]);
    expect(links.map((a) => a.parentElement!.className)).toEqual([
      'toc-h1',
      'toc-h2',
      'toc-h3',
      'toc-h2',
    ]);
  });

  it('is left out of a short document', async () => {
    const page = await renderMarkdown('# Notes\n\n## One\n\nText');
    expect(page.querySelector('nav')).toBeNull();
  });

  it('does not count h4 and smaller headings', async () => {
    const page = await renderMarkdown('# Notes\n\n#### A\n\n#### B\n\n##### C');
    expect(page.querySelector('nav')).toBeNull();
  });

  it('shows heading text only, never markup from the document', async () => {
    const page = await renderMarkdown('# A <em>b</em>\n\n## C\n\n## D');
    const first = page.querySelector('nav a')!;
    expect(first.textContent).toBe('A b');
    expect(first.querySelector('em')).toBeNull();
  });

  it('jumps to the heading within the document', async () => {
    const page = await renderMarkdown(long);
    document.body.appendChild(page);
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const before = window.location.hash;
      const link = [...page.querySelectorAll('nav a')].find((a) => a.textContent === 'Checks')!;
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      link.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(window.location.hash).toBe(before);
      const heading = page.querySelector('#user-content-checks')!;
      expect(scrolled).toEqual([heading]);
      expect(document.activeElement).toBe(heading);
    } finally {
      Element.prototype.scrollIntoView = original;
      page.remove();
    }
  });
});
