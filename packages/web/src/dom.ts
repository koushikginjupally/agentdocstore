/** DOM helper utilities. */

import { showToast } from './toast.js';

/**
 * Run a possibly-async callback and make sure a failure is visible.
 *
 * Browser callbacks (`addEventListener`, `hashchange`) discard whatever the
 * listener returns, so a rejected promise inside an `async` listener becomes an
 * unhandled rejection: the user sees a button that did nothing. Everything that
 * hands an async function to the DOM goes through here instead, so the worst
 * case is a toast rather than silence.
 */
export function runGuarded(context: string, fn: () => void | Promise<void>): void {
  const report = (err: unknown): void => {
    console.error(`${context} failed`, err);
    showToast(
      `${context} failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      'error',
    );
  };
  try {
    const result = fn();
    if (result instanceof Promise) void result.catch(report);
  } catch (err) {
    report(err);
  }
}

/**
 * Attach a click handler that may be async, with rejections reported.
 * `context` names the action for the failure message ('Delete doc').
 */
export function onClick(
  target: HTMLElement,
  context: string,
  handler: () => void | Promise<void>,
): void {
  target.addEventListener('click', () => {
    runGuarded(context, handler);
  });
}

/** Create an element with optional class and attributes. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts?: { className?: string; attrs?: Record<string, string>; text?: string; html?: string },
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (opts?.className) e.className = opts.className;
  if (opts?.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      e.setAttribute(k, v);
    }
  }
  if (opts?.text) e.textContent = opts.text;
  if (opts?.html) e.innerHTML = opts.html;
  return e;
}

/** Shorthand for querySelector with type. */
export function qs<T extends HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}

/**
 * Move focus to the page's main heading after a client-side navigation.
 *
 * Rendering a new page replaces the element that had focus (the link or button
 * the user activated), which drops focus to <body>: a screen reader announces
 * nothing and the next Tab starts from the top. Focusing the heading announces
 * the new page and starts the Tab order inside it. tabindex="-1" makes the
 * heading focusable by script without adding it to the Tab order.
 */
export function focusPageHeading(root: ParentNode): void {
  const heading = root.querySelector<HTMLElement>('h1') ?? root.querySelector<HTMLElement>('h2');
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}

/**
 * Point the user at a form field that failed validation.
 *
 * A toast alone disappears after a few seconds and does not say which field is
 * wrong. This marks the field (aria-invalid, which screen readers announce and
 * the stylesheet outlines) and moves focus into it; the mark clears as soon as
 * the user edits the field.
 */
export function markFieldInvalid(field: HTMLInputElement | HTMLTextAreaElement): void {
  field.setAttribute('aria-invalid', 'true');
  field.addEventListener('input', () => field.removeAttribute('aria-invalid'), { once: true });
  field.focus();
}

/** Format ISO date for display. */
export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Copy text to clipboard and show feedback. */
/** "Expires in" choices offered in the create and edit forms, in days. */
export const EXPIRY_CHOICES: ReadonlyArray<{ readonly days: number; readonly label: string }> = [
  { days: 1, label: 'In 1 day' },
  { days: 7, label: 'In 7 days' },
  { days: 30, label: 'In 30 days' },
  { days: 90, label: 'In 90 days' },
  { days: 365, label: 'In 1 year' },
];

/**
 * A labelled "Expires" select for a form row. `leading` options come first
 * (for example "Never", or "Keep" on the edit page); then one option per
 * EXPIRY_CHOICES entry, whose value is the number of days.
 */
export function expiryField(
  id: string,
  leading: ReadonlyArray<{ readonly value: string; readonly label: string }>,
): { group: HTMLDivElement; select: HTMLSelectElement } {
  const group = document.createElement('div');
  group.className = 'form-group';
  group.style.flex = '1';
  group.style.minWidth = '150px';
  const label = document.createElement('label');
  label.setAttribute('for', id);
  label.textContent = 'Expires';
  const select = document.createElement('select');
  select.id = id;
  const options = [
    ...leading,
    ...EXPIRY_CHOICES.map((c) => ({ value: String(c.days), label: c.label })),
  ];
  for (const { value, label: text } of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    select.appendChild(opt);
  }
  group.appendChild(label);
  group.appendChild(select);
  return { group, select };
}

/** File extension for each document language, for downloads. */
const FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  markdown: 'md',
  mermaid: 'mmd',
  plaintext: 'txt',
  text: 'txt',
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  java: 'java',
  go: 'go',
  rust: 'rs',
  json: 'json',
  yaml: 'yaml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  sql: 'sql',
  bash: 'sh',
  dockerfile: 'dockerfile',
};

/** Characters Windows, macOS or Linux reject in a file name. */
const UNSAFE_FILE_NAME_CHARS = '<>:"/\\|?*';

/**
 * A file name for downloading a document: its title with characters that file
 * systems reject replaced by `-`, at most 100 characters, and the extension
 * for its language.
 */
export function downloadFileName(title: string, language: string): string {
  const cleaned = [...title]
    .map((ch) => (ch.charCodeAt(0) < 32 || UNSAFE_FILE_NAME_CHARS.includes(ch) ? '-' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim();
  return `${cleaned || 'document'}.${FILE_EXTENSIONS[language] ?? 'txt'}`;
}

/**
 * Save `text` as a file on the user's machine. Uses a temporary object URL,
 * so nothing is fetched and nothing leaves the browser.
 */
export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke once the browser has taken the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-HTTPS contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

/** Escape HTML in user content. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Build the LANGUAGES array for select dropdowns. */
export const LANGUAGES: readonly string[] = [
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
