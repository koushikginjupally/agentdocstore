/**
 * `agentdocstore serve` — start the HTTP server with static web UI + MCP handler.
 */

import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer, resolveIdentityProvider } from '@agentdocstore/server';
import type { AuthMode as ServerAuthMode, ServerHandle } from '@agentdocstore/server';
import { createHttpHandler } from '@agentdocstore/mcp';
import type { IdentityProvider } from '@agentdocstore/core';

import type { ResolvedConfig } from './config.js';
import { loadTokensFile } from './config.js';
import { loadProvider } from './provider-loader.js';
import { installNetworkFuse } from './fuse.js';

// ---------------------------------------------------------------------------
// MIME lookup
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Headers for the web UI's own files. The Hono app adds nosniff and its CSP to
 * API responses, but these files are served here, outside it. A script/style
 * CSP for the UI needs its own design (inline styles, the sandboxed HTML
 * preview), so only nosniff is sent for now.
 */
const STATIC_HEADERS = { 'X-Content-Type-Options': 'nosniff' } as const;

function mimeFor(file: string): string {
  return MIME_TYPES[extname(file)] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Static file serving from web/dist
// ---------------------------------------------------------------------------

/**
 * Locate the `packages/web/dist/` directory. We walk up from this file
 * to find the monorepo root, then resolve packages/web/dist.
 */
function findWebDist(): string {
  // At runtime: packages/cli/dist/serve.js → up 3 → repo root
  const thisFile = fileURLToPath(import.meta.url);
  const cliDist = join(thisFile, '..'); // packages/cli/dist
  const cliPkg = join(cliDist, '..'); // packages/cli
  const packages = join(cliPkg, '..'); // packages
  const repoRoot = join(packages, '..'); // repo root
  return join(repoRoot, 'packages', 'web', 'dist');
}

// ---------------------------------------------------------------------------
// serve command
// ---------------------------------------------------------------------------

export async function runServe(config: ResolvedConfig): Promise<ServerHandle> {
  // Offline mode: arm the fuse BEFORE constructing anything, so a provider or
  // dependency that tries to reach the network during startup is caught too.
  if (config.mode === 'offline') {
    installNetworkFuse();
  }

  // Build the auth mode, then ONE identity provider shared by REST and /mcp.
  // This comes before the store is opened: a missing or bad tokens file is a
  // configuration error and should not touch, or lock, the data dir.
  const auth: ServerAuthMode = buildAuthMode(config);
  const identity: IdentityProvider = resolveIdentityProvider(auth);

  // Load the configured provider. This also enforces the mode policy (loopback
  // bind, local-only store) and aborts startup on a violation.
  const loaded = await loadProvider({
    selection: config.provider,
    dataDir: config.dataDir,
    mode: config.mode,
    host: config.host,
    expose: config.expose,
  });
  const provider = loaded.provider;

  if (loaded.module === 'memory') {
    console.log('Using ephemeral in-memory storage (data will be lost on restart).');
  } else if (loaded.module === 'fs') {
    console.log(`Data directory: ${config.dataDir}`);
  } else {
    console.log(`Provider: ${loaded.name} (${loaded.module})`);
  }

  // From here the provider holds the data dir (the fs provider's lock), so a
  // start that fails must close it again. Otherwise every later start reports
  // "already locked" until someone removes the lock by hand.
  let handle: ServerHandle;
  try {
    handle = startServer({
      provider,
      auth,
      port: config.port,
      host: config.host,
      mode: config.mode,
      providerName: loaded.name,
    });
  } catch (err) {
    // listen() refuses a port out of range synchronously.
    await provider.close().catch(() => undefined);
    throw err;
  }

  // Mount MCP-over-HTTP on /mcp, authenticating every request through the same
  // identity provider the REST API uses. Anything else would make /mcp a way
  // around the auth mode, reaching the same PRIVATE documents.
  const mcpHandler = createHttpHandler({
    provider,
    getViewer: async (req: IncomingMessage) => {
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
      }
      const id = await identity.identify(headers);
      return id.user;
    },
  });

  // We need to intercept requests before Hono to serve static files
  // and the MCP endpoint. Wrap the underlying HTTP server.
  const webDistDir = findWebDist();
  const hasWebDist = existsSync(join(webDistDir, 'index.html'));

  if (!hasWebDist) {
    console.warn('Web UI not found at packages/web/dist/ — only API routes will be available.');
  }

  // The server from @hono/node-server already has its own request listener.
  // We'll replace it to add static file serving and MCP.
  const originalListeners = handle.server.listeners('request');
  handle.server.removeAllListeners('request');

  handle.server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0] ?? '/';

    // MCP handler — /mcp path
    if (pathname === '/mcp') {
      mcpHandler(req, res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
      return;
    }

    // Static file serving — only for GET on root-level paths
    if (hasWebDist && req.method === 'GET') {
      // Serve known static files
      const fileName = pathname === '/' ? 'index.html' : pathname.slice(1);
      // Prevent directory traversal
      if (!fileName.includes('..') && !fileName.includes('\0')) {
        const filePath = join(webDistDir, fileName);
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const content = readFileSync(filePath);
          res.writeHead(200, { 'Content-Type': mimeFor(filePath), ...STATIC_HEADERS });
          res.end(content);
          return;
        }
      }

      // SPA fallback: serve index.html for unknown GET paths that don't
      // start with /api/, /raw/, /healthz, /mcp
      if (
        !pathname.startsWith('/api/') &&
        !pathname.startsWith('/raw/') &&
        pathname !== '/healthz'
      ) {
        const indexPath = join(webDistDir, 'index.html');
        if (existsSync(indexPath)) {
          const content = readFileSync(indexPath);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...STATIC_HEADERS });
          res.end(content);
          return;
        }
      }
    }

    // Fall through to the Hono app for /api/*, /raw/*, /healthz.
    for (const listener of originalListeners) {
      (listener as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
    }
  });

  try {
    await whenListening(handle.server, config.host, config.port);
  } catch (err) {
    // handle.close() also stops the expiry sweep and closes the provider.
    await handle.close().catch(() => undefined);
    throw err;
  }

  console.log(describeMode(config, loaded.name));
  console.log(`AgentDocStore ready at http://${config.host}:${config.port}`);

  // Graceful shutdown.
  //
  // `process.on` ignores a listener's returned promise, so an async listener
  // that rejects becomes an unhandled rejection and the process can be left
  // half-closed. The async work therefore lives in a function that cannot
  // reject — every failure path still reaches `process.exit` — and the listener
  // itself is synchronous.
  const shutdown = async (signal: string): Promise<never> => {
    console.log(`\nShutting down (${signal})...`);
    try {
      await handle.close();
    } catch (err) {
      console.error('Error closing server:', err);
    }
    try {
      await provider.close();
    } catch (err) {
      console.error('Error closing provider:', err);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  return handle;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve once `server` is listening; reject with a plain message when it
 * cannot bind. listen() reports a busy or forbidden port as an 'error' event,
 * and with no listener for it the process crashed with a stack trace, after
 * already saying it was ready.
 */
function whenListening(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server.listening) {
      resolve();
      return;
    }
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    const onError = (err: NodeJS.ErrnoException): void => {
      server.off('listening', onListening);
      reject(new Error(`Cannot listen on ${host}:${port}: ${listenFailure(err)}`));
    };
    server.once('listening', onListening);
    server.once('error', onError);
  });
}

function listenFailure(err: NodeJS.ErrnoException): string {
  switch (err.code) {
    case 'EADDRINUSE':
      return 'the port is already in use (EADDRINUSE). Stop the other process, or choose another port with --port.';
    case 'EACCES':
      return 'permission denied (EACCES). Ports below 1024 usually need extra privileges; choose another port with --port.';
    case 'EADDRNOTAVAIL':
      return 'that address does not belong to this machine (EADDRNOTAVAIL). Check --host.';
    default:
      return err.message;
  }
}

/**
 * One line the operator can read to know exactly what they are running. Worth
 * the space: "offline" is a security property, and a silent mode is one nobody
 * verifies.
 */
export function describeMode(config: ResolvedConfig, providerName: string): string {
  const parts = [
    `mode=${config.mode}`,
    `provider=${providerName}`,
    `auth=${config.auth}`,
    config.mode === 'offline' ? 'egress=fused' : 'egress=allowed',
    config.expose ? 'inbound=exposed' : 'inbound=loopback',
  ];
  return `▸ ${parts.join(' · ')}`;
}

/**
 * Translate CLI config into the server's auth mode.
 *
 * `token` mode loads its map here and fails loudly when it cannot: an empty
 * token map rejects every caller, which looks like a broken server rather than
 * a misconfigured one.
 */
export function buildAuthMode(config: ResolvedConfig): ServerAuthMode {
  switch (config.auth) {
    case 'trusted-header':
      return { mode: 'trusted-header', header: config.trustedHeader };
    case 'token': {
      if (config.tokensFile === undefined) {
        throw new Error(
          'auth=token requires a tokens file: pass --tokens <file> (a JSON map of ' +
            'token -> username), or use --auth single-user for a personal instance.',
        );
      }
      return { mode: 'token', tokens: loadTokensFile(config.tokensFile) };
    }
    default:
      return config.user !== undefined
        ? { mode: 'single-user', user: config.user }
        : { mode: 'single-user' };
  }
}
