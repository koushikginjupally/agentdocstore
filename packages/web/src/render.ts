/**
 * Content rendering: delegates to the correct renderer based on language.
 * All rendering libraries are bundled from node_modules (zero external fetch).
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import mermaid from 'mermaid';
import { getRendererType } from './renderers.js';
import { HTML_IFRAME_SANDBOX } from './constants.js';

// ---- highlight.js theme (bundled) ----
import 'highlight.js/styles/github-dark.css';

// Initialize mermaid with strict security
let mermaidInitialized = false;
function ensureMermaid(): void {
  if (mermaidInitialized) return;
  mermaidInitialized = true;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'dark',
  });
}

// Configure marked for safe rendering
marked.setOptions({
  gfm: true,
  breaks: false,
});

/**
 * Render content into an HTML element based on language.
 * Returns the container element.
 */
export async function renderContent(
  language: string,
  content: string,
  container: HTMLElement,
): Promise<void> {
  const renderer = getRendererType(language);

  switch (renderer) {
    case 'markdown':
      await renderMarkdown(content, container);
      break;
    case 'mermaid':
      await renderMermaid(content, container);
      break;
    case 'code':
      renderCode(content, language, container);
      break;
    case 'html':
      renderHtml(content, container);
      break;
    case 'json':
      renderJson(content, container);
      break;
    case 'plaintext':
      renderPlaintext(content, container);
      break;
  }
}

async function renderMarkdown(content: string, container: HTMLElement): Promise<void> {
  const raw = await marked.parse(content);
  // No ADD_TAGS: iframes stay stripped, as docs/SECURITY.md states, so a
  // document cannot embed another site (a fake sign-in page, a tracker) inside
  // AgentDocStore. HTML documents have their own sandboxed renderer.
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
  container.innerHTML = `<div class="markdown-body">${clean}</div>`;
  addHeadingIds(container);
  container.addEventListener('click', followInDocumentLink);
}

/**
 * Prefix for heading ids in rendered markdown. The prefix keeps document text
 * from producing an id the app itself uses (DOM clobbering).
 */
export const HEADING_ID_PREFIX = 'user-content-';

/** A heading's anchor name, as GitHub builds it: lowercase, punctuation dropped, spaces as `-`. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function addHeadingIds(container: HTMLElement): void {
  const seen = new Map<string, number>();
  for (const heading of container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    const slug = headingSlug(heading.textContent ?? '');
    if (slug === '') continue;
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    heading.id = `${HEADING_ID_PREFIX}${count === 0 ? slug : `${slug}-${count}`}`;
  }
}

/**
 * A `#section` link inside a document would otherwise change the app's hash
 * route and show "Page Not Found". Scroll to the matching heading instead;
 * `#/…` links are app routes and are left to the router.
 */
function followInDocumentLink(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
  const href = link?.getAttribute('href') ?? '';
  if (!link || href.startsWith('#/')) return;
  event.preventDefault();

  const container = event.currentTarget as HTMLElement;
  let fragment = href.slice(1);
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    // Malformed escape: match it as written.
  }
  const wanted = [`${HEADING_ID_PREFIX}${headingSlug(fragment)}`, fragment];
  const target = [...container.querySelectorAll<HTMLElement>('[id]')].find((el) =>
    wanted.includes(el.id),
  );
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start' });
}

async function renderMermaid(content: string, container: HTMLElement): Promise<void> {
  ensureMermaid();
  container.innerHTML = '<div class="mermaid-container"><div class="mermaid-render"></div></div>';
  const target = container.querySelector('.mermaid-render') as HTMLElement;
  try {
    const id = `mermaid-${Date.now()}`;
    const { svg } = await mermaid.render(id, content);
    target.innerHTML = svg;
  } catch (err) {
    target.innerHTML = `<pre class="text-muted">${escapeHtml(String(err))}</pre>`;
  }
}

function renderCode(content: string, language: string, container: HTMLElement): void {
  const lines = content.split('\n');
  // Map language names to hljs aliases
  const langMap: Record<string, string> = {
    dockerfile: 'dockerfile',
    bash: 'bash',
  };
  const hljsLang = langMap[language] ?? language;

  let highlighted: string;
  try {
    const result = hljs.highlight(content, { language: hljsLang, ignoreIllegals: true });
    highlighted = result.value;
  } catch {
    highlighted = escapeHtml(content);
  }

  const highlightedLines = highlighted.split('\n');

  const rows = lines
    .map((_, i) => {
      const lineContent = highlightedLines[i] ?? '';
      return `<tr><td class="line-number" aria-hidden="true">${i + 1}</td><td class="line-content">${lineContent}</td></tr>`;
    })
    .join('');

  container.innerHTML = `<div class="code-block"><table role="presentation">${rows}</table></div>`;
}

function renderHtml(content: string, container: HTMLElement): void {
  const iframe = document.createElement('iframe');
  iframe.className = 'html-frame';
  iframe.setAttribute('sandbox', HTML_IFRAME_SANDBOX);
  iframe.srcdoc = content;
  iframe.title = 'HTML content preview';
  container.innerHTML = '';
  container.appendChild(iframe);
}

function renderJson(content: string, container: HTMLElement): void {
  let formatted: string;
  let isValid = true;
  try {
    const parsed = JSON.parse(content);
    formatted = JSON.stringify(parsed, null, 2);
  } catch {
    formatted = content;
    isValid = false;
  }

  const toggleId = `json-toggle-${Date.now()}`;
  container.innerHTML = `
    <div class="json-toggle">
      ${isValid ? `<label><input type="checkbox" id="${toggleId}" checked /> Pretty-print</label>` : '<span class="text-muted text-sm">Invalid JSON (showing raw)</span>'}
    </div>
    <div class="code-block"><pre style="padding: 16px; margin: 0;"><code id="${toggleId}-code">${escapeHtml(formatted)}</code></pre></div>
  `;

  if (isValid) {
    const checkbox = document.getElementById(toggleId) as HTMLInputElement | null;
    const codeEl = document.getElementById(`${toggleId}-code`);
    if (checkbox && codeEl) {
      checkbox.addEventListener('change', () => {
        try {
          const parsed = JSON.parse(content);
          codeEl.textContent = checkbox.checked
            ? JSON.stringify(parsed, null, 2)
            : JSON.stringify(parsed);
        } catch {
          // already shown raw
        }
      });
    }
  }
}

function renderPlaintext(content: string, container: HTMLElement): void {
  container.innerHTML = `<div class="code-block"><pre style="padding: 16px; margin: 0;">${escapeHtml(content)}</pre></div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
