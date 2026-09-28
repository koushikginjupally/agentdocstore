/**
 * Unit tests for pure logic in the web package.
 * Runs in vitest node environment — no browser DOM needed for these.
 */
import { readFileSync } from 'node:fs';
import { LIMITS } from '@agentdocstore/core';
import { BUTTON_ICONS, STATE_ICONS, iconLabelHtml } from './icons.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseRoute } from './router.js';
import {
  buildTitle,
  emptyListMessage,
  searchCountMessage,
  commentSizeMessage,
  contentSizeMessage,
  MAX_COMMENT_BYTES,
  MAX_DIFF_CHANGED_LINES,
  MAX_DIFF_INPUT_BYTES,
  MAX_TITLE_BYTES,
  utf8Bytes,
  WORDMARK_HTML,
  HTML_IFRAME_SANDBOX,
  CONTENT_MAX_WIDTH,
} from './constants.js';
import { getRendererType, LANGUAGE_RENDERER_MAP } from './renderers.js';
import { runGuarded, onClick } from './dom.js';
import { copyTitle } from './new-document-draft.js';

// ---- Router tests ----
describe('parseRoute', () => {
  it('parses the home route', () => {
    const route = parseRoute('/');
    expect(route.page).toBe('home');
    expect(route.params).toEqual({});
  });

  it('parses a view route', () => {
    const route = parseRoute('/d/abc123');
    expect(route.page).toBe('view');
    expect(route.params).toEqual({ id: 'abc123' });
  });

  it('parses an edit route', () => {
    const route = parseRoute('/d/abc123/edit');
    expect(route.page).toBe('edit');
    expect(route.params).toEqual({ id: 'abc123' });
  });

  it('parses a versions route', () => {
    const route = parseRoute('/d/abc123/versions');
    expect(route.page).toBe('versions');
    expect(route.params).toEqual({ id: 'abc123' });
  });

  it('returns not-found for unknown paths', () => {
    const route = parseRoute('/unknown/path');
    expect(route.page).toBe('not-found');
    expect(route.params).toEqual({});
  });

  it('returns not-found for empty string', () => {
    const route = parseRoute('');
    expect(route.page).toBe('home');
  });

  it('handles paths without leading slash', () => {
    const route = parseRoute('d/xyz789');
    expect(route.page).toBe('view');
    expect(route.params).toEqual({ id: 'xyz789' });
  });

  it('decodes URI-encoded ids', () => {
    const route = parseRoute('/d/hello%20world');
    expect(route.page).toBe('view');
    expect(route.params).toEqual({ id: 'hello world' });
  });

  it('ignores query strings', () => {
    const route = parseRoute('/d/abc123?version=2');
    expect(route.page).toBe('view');
    expect(route.params).toEqual({ id: 'abc123' });
  });

  it('does not match nested paths under versions', () => {
    const route = parseRoute('/d/abc123/versions/extra');
    expect(route.page).toBe('not-found');
  });

  it('parses an old-version route', () => {
    const route = parseRoute('/d/abc123/v/2');
    expect(route.page).toBe('version');
    expect(route.params).toEqual({ id: 'abc123', version: '2' });
  });

  it('only accepts a whole version number', () => {
    expect(parseRoute('/d/abc123/v/latest').page).toBe('not-found');
    expect(parseRoute('/d/abc123/v/2x').page).toBe('not-found');
    expect(parseRoute('/d/abc123/v/').page).toBe('not-found');
  });
});

// ---- Title builder tests ----
describe('buildTitle', () => {
  it('returns base title when no doc title', () => {
    expect(buildTitle()).toBe('AgentDocStore');
  });

  it('returns base title for empty string', () => {
    expect(buildTitle('')).toBe('AgentDocStore');
  });

  it('includes doc title with separator', () => {
    expect(buildTitle('My Document')).toBe('My Document \u00b7 AgentDocStore');
  });

  it('preserves special characters in title', () => {
    expect(buildTitle('Hello <World>')).toBe('Hello <World> \u00b7 AgentDocStore');
  });
});

// ---- Renderer mapping tests ----
describe('getRendererType', () => {
  it('maps markdown to markdown renderer', () => {
    expect(getRendererType('markdown')).toBe('markdown');
  });

  it('maps mermaid to mermaid renderer', () => {
    expect(getRendererType('mermaid')).toBe('mermaid');
  });

  it('maps html to html renderer (iframe)', () => {
    expect(getRendererType('html')).toBe('html');
  });

  it('maps json to json renderer', () => {
    expect(getRendererType('json')).toBe('json');
  });

  it('maps plaintext to plaintext renderer', () => {
    expect(getRendererType('plaintext')).toBe('plaintext');
  });

  it('maps text to plaintext renderer', () => {
    expect(getRendererType('text')).toBe('plaintext');
  });

  it('maps javascript to code renderer', () => {
    expect(getRendererType('javascript')).toBe('code');
  });

  it('maps typescript to code renderer', () => {
    expect(getRendererType('typescript')).toBe('code');
  });

  it('maps python to code renderer', () => {
    expect(getRendererType('python')).toBe('code');
  });

  it('maps java to code renderer', () => {
    expect(getRendererType('java')).toBe('code');
  });

  it('maps go to code renderer', () => {
    expect(getRendererType('go')).toBe('code');
  });

  it('maps rust to code renderer', () => {
    expect(getRendererType('rust')).toBe('code');
  });

  it('maps yaml to code renderer', () => {
    expect(getRendererType('yaml')).toBe('code');
  });

  it('maps xml to code renderer', () => {
    expect(getRendererType('xml')).toBe('code');
  });

  it('maps css to code renderer', () => {
    expect(getRendererType('css')).toBe('code');
  });

  it('maps sql to code renderer', () => {
    expect(getRendererType('sql')).toBe('code');
  });

  it('maps bash to code renderer', () => {
    expect(getRendererType('bash')).toBe('code');
  });

  it('maps dockerfile to code renderer', () => {
    expect(getRendererType('dockerfile')).toBe('code');
  });

  it('maps unknown language to code renderer', () => {
    expect(getRendererType('unknown-lang')).toBe('code');
  });
});

// ---- Language renderer map completeness ----
describe('LANGUAGE_RENDERER_MAP', () => {
  const CORE_LANGUAGES = [
    'markdown',
    'mermaid',
    'plaintext',
    'text',
    'javascript',
    'typescript',
    'python',
    'java',
    'go',
    'rust',
    'json',
    'yaml',
    'xml',
    'html',
    'css',
    'sql',
    'bash',
    'dockerfile',
  ];

  it('contains all core languages', () => {
    for (const lang of CORE_LANGUAGES) {
      expect(LANGUAGE_RENDERER_MAP).toHaveProperty(lang);
    }
  });

  it('every entry matches getRendererType', () => {
    for (const [lang, expected] of Object.entries(LANGUAGE_RENDERER_MAP)) {
      expect(getRendererType(lang)).toBe(expected);
    }
  });
});

// ---- Constants tests ----
describe('WORDMARK_HTML', () => {
  it('renders the complete AgentDocStore brand', () => {
    expect(WORDMARK_HTML.replace(/<[^>]+>/g, '')).toBe('AgentDocStore');
  });
});

describe('HTML_IFRAME_SANDBOX', () => {
  it('has the exact required sandbox attribute value', () => {
    expect(HTML_IFRAME_SANDBOX).toBe('allow-scripts allow-popups allow-popups-to-escape-sandbox');
  });

  it('has exactly three tokens', () => {
    const tokens = HTML_IFRAME_SANDBOX.split(' ');
    expect(tokens).toHaveLength(3);
  });

  it('includes allow-scripts', () => {
    expect(HTML_IFRAME_SANDBOX).toContain('allow-scripts');
  });

  it('includes allow-popups', () => {
    expect(HTML_IFRAME_SANDBOX).toContain('allow-popups');
  });

  it('includes allow-popups-to-escape-sandbox', () => {
    expect(HTML_IFRAME_SANDBOX).toContain('allow-popups-to-escape-sandbox');
  });
});

describe('CONTENT_MAX_WIDTH', () => {
  it('caps at 1920px and 96vw', () => {
    expect(CONTENT_MAX_WIDTH).toBe('min(1920px, 96vw)');
  });
});

// ---- Guarded async handlers ----
//
// `addEventListener` discards the promise an async listener returns, so before
// these helpers existed a rejection inside a click handler became an unhandled
// rejection: the button appeared to do nothing at all. These tests pin the
// contract that a failure is always surfaced.
describe('runGuarded / onClick', () => {
  interface StubEl {
    className: string;
    textContent: string;
    setAttribute(): void;
    appendChild(): void;
    remove(): void;
  }

  let created: StubEl[] = [];

  function stubDocument(): void {
    created = [];
    const make = (): StubEl => {
      const e: StubEl = {
        className: '',
        textContent: '',
        setAttribute: () => undefined,
        appendChild: () => undefined,
        remove: () => undefined,
      };
      created.push(e);
      return e;
    };
    // Minimal DOM: the toast path only needs createElement + body.appendChild.
    (globalThis as unknown as { document: unknown }).document = {
      createElement: make,
      body: { appendChild: () => undefined },
    };
  }

  /** Let a rejected promise settle so the guard's catch can run. */
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    stubDocument();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { document?: unknown }).document;
  });

  it('reports an async rejection instead of leaving it unhandled', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runGuarded('Delete doc', () => Promise.reject(new Error('boom')));
    await flush();
    expect(spy).toHaveBeenCalled();
    expect(created.some((e) => e.textContent.includes('boom'))).toBe(true);
    expect(created.some((e) => e.textContent.includes('Delete doc'))).toBe(true);
  });

  it('reports a synchronous throw', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runGuarded('Copy link', () => {
      throw new Error('sync-boom');
    });
    expect(spy).toHaveBeenCalled();
    expect(created.some((e) => e.textContent.includes('sync-boom'))).toBe(true);
  });

  it('stays silent when the handler succeeds', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let ran = false;
    runGuarded('Add comment', async () => {
      await Promise.resolve();
      ran = true;
    });
    await flush();
    expect(ran).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('onClick routes a rejecting listener through the guard', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let listener: (() => void) | undefined;
    const target = {
      addEventListener: (_type: string, fn: () => void) => {
        listener = fn;
      },
    } as unknown as HTMLElement;

    onClick(target, 'Resolve comment', () => Promise.reject(new Error('listener-boom')));
    expect(listener).toBeDefined();
    listener?.();
    await flush();
    expect(spy).toHaveBeenCalled();
    expect(created.some((e) => e.textContent.includes('listener-boom'))).toBe(true);
  });
});

describe('emptyListMessage', () => {
  it('invites creating a document when nothing was searched', () => {
    expect(emptyListMessage('')).toBe('No documents yet. Create your first one above!');
    expect(emptyListMessage('   ')).toBe('No documents yet. Create your first one above!');
  });

  it('names the query instead of claiming the library is empty', () => {
    const msg = emptyListMessage('  zebra  ');
    expect(msg).toContain('“zebra”');
    expect(msg).not.toContain('No documents yet');
  });

  it('returns the query as plain text for textContent', () => {
    expect(emptyListMessage('<img src=x>')).toContain('<img src=x>');
  });
});

describe('searchCountMessage', () => {
  it('counts matches in the singular and the plural', () => {
    expect(searchCountMessage(1, 'zebra')).toBe('1 document matches “zebra”');
    expect(searchCountMessage(25, ' zebra ')).toBe('25 documents match “zebra”');
  });

  it('says there are no matches the same way the empty list does', () => {
    expect(searchCountMessage(0, 'zebra')).toBe(emptyListMessage('zebra'));
  });

  it('returns the query as plain text for textContent', () => {
    expect(searchCountMessage(2, '<img src=x>')).toContain('<img src=x>');
  });
});

describe('comment size', () => {
  it('uses the same limit as the server', () => {
    expect(MAX_COMMENT_BYTES).toBe(LIMITS.MAX_COMMENT_BYTES);
  });

  it('names the same diff limit as the server', () => {
    expect(MAX_DIFF_INPUT_BYTES).toBe(LIMITS.MAX_DIFF_INPUT_BYTES);
  });

  it('names the same changed-lines limit as the server', () => {
    expect(MAX_DIFF_CHANGED_LINES).toBe(LIMITS.MAX_DIFF_CHANGED_LINES);
  });

  it('counts UTF-8 bytes, as the server does', () => {
    expect(utf8Bytes('abc')).toBe(3);
    expect(utf8Bytes('é')).toBe(2);
    expect(utf8Bytes('日本')).toBe(6);
    expect(utf8Bytes('🙂')).toBe(4);
  });

  it('says nothing until a comment is close to the limit', () => {
    expect(commentSizeMessage(0)).toBe('');
    expect(commentSizeMessage(8_999)).toBe('');
  });

  it('shows the size near the limit, and up to it', () => {
    expect(commentSizeMessage(9_000)).toBe('9,000 of 10,000 bytes');
    expect(commentSizeMessage(10_000)).toBe('10,000 of 10,000 bytes');
  });

  it('says how much to cut once over the limit', () => {
    expect(commentSizeMessage(10_976)).toBe(
      '10,976 of 10,000 bytes. Shorten the comment by 976 bytes to post it.',
    );
    expect(commentSizeMessage(10_001)).toBe(
      '10,001 of 10,000 bytes. Shorten the comment by 1 byte to post it.',
    );
  });
});

describe('the content size note', () => {
  it('says nothing until the content is close to the limit', () => {
    expect(contentSizeMessage(0)).toBe('');
    expect(contentSizeMessage(4_718_591)).toBe('');
  });

  it('shows the size from 90% of the limit, and up to it', () => {
    expect(contentSizeMessage(4_718_592)).toBe('4,718,592 of 5,242,880 bytes');
    expect(contentSizeMessage(5_242_880)).toBe('5,242,880 of 5,242,880 bytes');
  });

  it('says how much to cut once over the limit', () => {
    expect(contentSizeMessage(5_242_885)).toBe(
      '5,242,885 of 5,242,880 bytes. Shorten the content by 5 bytes to save it.',
    );
    expect(contentSizeMessage(5_242_881)).toBe(
      '5,242,881 of 5,242,880 bytes. Shorten the content by 1 byte to save it.',
    );
  });
});

describe('the title of a copy', () => {
  it('starts with "Copy of"', () => {
    expect(copyTitle('Runbook')).toBe('Copy of Runbook');
  });

  it('keeps the original title when the prefix would pass the title limit', () => {
    expect(MAX_TITLE_BYTES).toBe(LIMITS.MAX_TITLE_BYTES);
    const long = 'x'.repeat(MAX_TITLE_BYTES - 7);
    expect(copyTitle(long)).toBe(long);
    const fits = 'x'.repeat(MAX_TITLE_BYTES - 8);
    expect(copyTitle(fits)).toBe(`Copy of ${fits}`);
  });
});

describe('state icons', () => {
  it.each(Object.entries(STATE_ICONS))('%s is a decorative, theme-coloured SVG', (_name, svg) => {
    expect(svg.startsWith('<svg class="state-icon"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it('page empty and error states no longer use emoji icons', () => {
    const pages = ['not-found', 'edit', 'view', 'versions', 'home'];
    for (const page of pages) {
      const src = readFileSync(new URL(`./pages/${page}.ts`, import.meta.url), 'utf8');
      expect(src, page).not.toMatch(/class="icon">[^<$]/u);
      expect(src, page).not.toMatch(/icon\.textContent = /);
    }
  });
});

describe('button icons', () => {
  it.each(Object.entries(BUTTON_ICONS))('%s is a decorative, theme-coloured SVG', (_name, svg) => {
    expect(svg.startsWith('<svg class="action-icon"')).toBe(true);
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('aria-hidden="true"');
  });

  it('iconLabelHtml escapes the label and keeps it as the only text', () => {
    const html = iconLabelHtml('trash', '<b>Delete</b>');
    expect(html).toContain('<span>&lt;b&gt;Delete&lt;/b&gt;</span>');
    expect(html.replace(/<svg[\s\S]*?<\/svg>/, '')).toBe('<span>&lt;b&gt;Delete&lt;/b&gt;</span>');
  });

  it('action buttons and the redaction title carry no emoji', () => {
    for (const file of ['./pages/view.ts', './redaction-modal.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src, file).not.toMatch(/textContent = '[^\p{L}\p{N}\s'][^']*'/u);
    }
  });
});

describe('view page layout', () => {
  it('lets the action button row wrap on narrow screens', () => {
    const src = readFileSync(new URL('./pages/view.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/actions\.style\.flexWrap = 'wrap'/);
  });
});
