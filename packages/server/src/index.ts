/**
 * @agentdocstore/server — Hono HTTP server for AgentDocStore.
 *
 * Public API:
 * - {@link createServer} — build a Hono app (no listening, suitable for tests)
 * - {@link startServer} — build + bind + listen + optional expiry sweep
 */

export { createServer, startServer, resolveIdentityProvider } from './server.js';
export type { AuthMode, CreateServerOptions, StartServerOptions, ServerHandle } from './server.js';
export {
  createSingleUserIdentity,
  createTrustedHeaderIdentity,
  createTokenIdentity,
} from './identity.js';
