/**
 * Built-in {@link IdentityProvider} implementations for the three auth modes.
 */

import type { Identity, IdentityProvider } from '@agentdocstore/core';
import { userInfo } from 'node:os';

// ---------------------------------------------------------------------------
// single-user (default)
// ---------------------------------------------------------------------------

/**
 * Every request is attributed to a single user — either the supplied name or
 * the OS login. Useful for local-only / personal instances.
 */
export function createSingleUserIdentity(user?: string): IdentityProvider {
  const resolved = user ?? userInfo().username;
  const identity: Identity = { user: resolved };
  return { identify: () => identity };
}

// ---------------------------------------------------------------------------
// trusted-header
// ---------------------------------------------------------------------------

/**
 * Identity is read from a request header set by a trusted reverse proxy.
 *
 * ⚠️  The proxy MUST strip this header from client traffic — if a client can
 * set it directly, they can impersonate anyone.
 */
export function createTrustedHeaderIdentity(header: string): IdentityProvider {
  const key = header.toLowerCase();
  return {
    identify(headers) {
      const value = headers[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`Missing or empty identity header '${header}'`);
      }
      return { user: value.trim() };
    },
  };
}

// ---------------------------------------------------------------------------
// token (static bearer map)
// ---------------------------------------------------------------------------

/**
 * Bearer tokens mapped to usernames. The caller sends
 * `Authorization: Bearer <token>` and we resolve the user from the map.
 */
export function createTokenIdentity(tokens: Readonly<Record<string, string>>): IdentityProvider {
  const map = new Map(Object.entries(tokens));
  return {
    identify(headers) {
      const auth = headers['authorization'];
      if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
        throw new Error('Missing or invalid Authorization header');
      }
      const token = auth.slice('Bearer '.length).trim();
      const user = map.get(token);
      if (user === undefined) {
        throw new Error('Invalid token');
      }
      return { user };
    },
  };
}
