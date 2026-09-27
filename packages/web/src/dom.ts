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
