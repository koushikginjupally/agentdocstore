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
