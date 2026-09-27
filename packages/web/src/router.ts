/**
 * Minimal hash-based client-side router.
 *
 * Routes use the hash fragment: `#/`, `#/d/:id`, `#/d/:id/edit`, `#/d/:id/versions`.
 * This avoids server-side catch-all configuration — any path serves index.html.
 */

import { runGuarded } from './dom.js';

export interface Route {
  readonly page: 'home' | 'view' | 'version' | 'edit' | 'versions' | 'not-found';
  readonly params: Readonly<Record<string, string>>;
}

interface RoutePattern {
  page: Route['page'];
  pattern: RegExp;
  paramNames: readonly string[];
}

const ROUTES: readonly RoutePattern[] = [
  { page: 'home', pattern: /^\/$/, paramNames: [] },
  { page: 'versions', pattern: /^\/d\/([^/]+)\/versions$/, paramNames: ['id'] },
  { page: 'version', pattern: /^\/d\/([^/]+)\/v\/(\d+)$/, paramNames: ['id', 'version'] },
  { page: 'edit', pattern: /^\/d\/([^/]+)\/edit$/, paramNames: ['id'] },
  { page: 'view', pattern: /^\/d\/([^/]+)$/, paramNames: ['id'] },
];

/** Parse a hash path (without the `#`) into a Route. */
export function parseRoute(path: string): Route {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const clean = normalized.split('?')[0] ?? normalized;

  for (const route of ROUTES) {
    const match = clean.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        const name = route.paramNames[i];
        const value = match[i + 1];
        if (name !== undefined && value !== undefined) {
          params[name] = decodeURIComponent(value);
        }
      }
      return { page: route.page, params };
    }
  }

  return { page: 'not-found', params: {} };
}

/** Get the current route from window.location.hash. */
export function currentRoute(): Route {
  const hash = window.location.hash.slice(1) || '/';
  return parseRoute(hash);
}

/** Navigate to a hash path. */
export function navigate(path: string): void {
  window.location.hash = path;
}

/** Build a hash href for use in <a> tags. */
export function href(path: string): string {
  return `#${path}`;
}

export type RouteHandler = (route: Route) => void | Promise<void>;

let _handler: RouteHandler | null = null;

// ---- Unsaved changes ----
//
// A page with a form registers a check. While it reports unsaved changes,
// leaving the page asks first (in-app links, the Back button) and the browser
// warns on reload or tab close. Every completed navigation clears the check,
// so each page registers its own.

let unsavedCheck: (() => boolean) | null = null;

/** Asked before in-app navigation discards unsaved changes. */
export const LEAVE_PROMPT = 'You have unsaved changes. Leave this page and discard them?';

/** Register the current page's "has unsaved changes" check, or clear it with `null`. */
export function setUnsavedChangesCheck(check: (() => boolean) | null): void {
  unsavedCheck = check;
}

/** True when leaving the current page would discard changes the user made. */
export function hasUnsavedChanges(): boolean {
  return unsavedCheck?.() ?? false;
}

/** Treat the page as having unsaved changes while any field differs from its value now. */
export function watchForUnsavedChanges(
  fields: ReadonlyArray<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
): void {
  const initial = fields.map((field) => field.value);
  setUnsavedChangesCheck(() => fields.some((field, i) => field.value !== initial[i]));
}

/** Listen for route changes and invoke the handler. */
export function onRoute(handler: RouteHandler): void {
  _handler = handler;
  // In-app links ask before the browser navigates, so declining leaves no
  // extra history entry behind. Modified clicks open a new tab and leave
  // nothing, so they are not asked about. Only `#/…` links change page: a
  // `#heading` link inside a document scrolls to that heading instead.
  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href^="#/"]') : null;
      if (!link || link.getAttribute('href') === (window.location.hash || '#/')) return;
      if (!hasUnsavedChanges()) return;
      if (window.confirm(LEAVE_PROMPT)) {
        unsavedCheck = null; // Leaving was confirmed; hashchange must not ask again.
      } else {
        event.preventDefault();
      }
    },
    true,
  );
  window.addEventListener('hashchange', (event) => {
    // Back/Forward and typed addresses arrive here, after the fact.
    if (hasUnsavedChanges() && !window.confirm(LEAVE_PROMPT)) {
      // Stay: put the previous address back. replaceState fires no
      // hashchange, so the page and what was typed into it are untouched.
      history.replaceState(history.state, '', event.oldURL);
      return;
    }
    unsavedCheck = null;
    runGuarded('Page render', () => handler(currentRoute()));
  });
  window.addEventListener('beforeunload', (event) => {
    // Reload, tab close or leaving the app: the browser shows its own prompt.
    if (hasUnsavedChanges()) event.preventDefault();
  });
  // Initial route
  runGuarded('Page render', () => handler(currentRoute()));
}

/** Remove the route listener (for cleanup). */
export function offRoute(): void {
  _handler = null;
}
