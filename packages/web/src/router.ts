/**
 * Minimal hash-based client-side router.
 *
 * Routes use the hash fragment: `#/`, `#/d/:id`, `#/d/:id/edit`, `#/d/:id/versions`.
 * This avoids server-side catch-all configuration — any path serves index.html.
 */

import { runGuarded } from './dom.js';

export interface Route {
  readonly page: 'home' | 'view' | 'edit' | 'versions' | 'not-found';
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

/** Listen for route changes and invoke the handler. */
export function onRoute(handler: RouteHandler): void {
  _handler = handler;
  window.addEventListener('hashchange', () => {
    runGuarded('Page render', () => handler(currentRoute()));
  });
  // Initial route
  runGuarded('Page render', () => handler(currentRoute()));
}

/** Remove the route listener (for cleanup). */
export function offRoute(): void {
  _handler = null;
}
