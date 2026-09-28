/**
 * Framework-agnostic HTTP handler for the AgentDocStore MCP server.
 *
 * Exports a factory that the `server` package can wire to its `/mcp` route
 * WITHOUT this package importing `server` (which would create a dependency
 * cycle). The handler uses the SDK's {@link StreamableHTTPServerTransport}
 * under the hood.
 *
 * Identity is the security-critical part. `/mcp` reaches exactly the same
 * provider as the REST API, so it must resolve the caller the same way:
 *
 *  - `getViewer` is called on EVERY request, not once per session, so a
 *    credential that stops being valid stops working.
 *  - A request that resolves to no identity is refused with 401. There is no
 *    synthetic fallback user: attributing an unauthenticated caller to some
 *    placeholder would hand them another user's PRIVATE documents.
 *  - The identity that opened a session is bound to it. A later request
 *    carrying that session id but a different identity is refused with 403,
 *    so a leaked `mcp-session-id` is not a login.
 *
 * Usage (from a host process):
 *
 * ```ts
 * import { createHttpHandler } from '@agentdocstore/mcp';
 * const handler = createHttpHandler({ provider, getViewer: (req) => identify(req.headers) });
 * app.all('/mcp', (req, res) => handler(req, res));
 * ```
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Provider } from '@agentdocstore/core';
import { LIMITS } from '@agentdocstore/core';
import { createMcpServer } from './register.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HttpHandlerOptions {
  /** The storage provider (shared with the rest of the server). */
  provider: Provider;
  /**
   * Resolve the viewer identity from a Node.js request, on every request.
   * Return `null` — or throw — for a caller that could not be authenticated;
   * both produce a 401. May be async (a token lookup, a directory call).
   */
  getViewer: (req: IncomingMessage) => string | null | Promise<string | null>;
  /** Whether to enable session management. Defaults to true. */
  stateful?: boolean | undefined;
  /**
   * Largest POST body read, in bytes; a larger one gets 413. Defaults to
   * `LIMITS.MAX_REQUEST_BYTES`, the REST API's cap.
   */
  maxBodyBytes?: number | undefined;
}

export type McpHttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

// ---------------------------------------------------------------------------
// JSON-RPC shaped errors
// ---------------------------------------------------------------------------

/**
 * MCP speaks JSON-RPC over HTTP, so an error carries both a meaningful HTTP
 * status (for proxies and curl) and a JSON-RPC error object (for clients).
 */
function sendError(res: ServerResponse, status: number, code: number, message: string): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code, message } }));
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/**
 * Read a request body of at most `limit` bytes. Resolves with the text, or with
 * `null` as soon as the body is known to be larger — from a declared
 * Content-Length before anything is read, or while counting a chunked body —
 * without reading the rest of it.
 */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const done = (): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) {
        done();
        // Let the rest arrive and fall away unkept. Closing instead would reset
        // a connection that still has unread data, and the client could lose
        // the 413 before reading it.
        req.resume();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      done();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onError = (err: Error): void => {
      done();
      reject(err);
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a request handler that bridges Node.js HTTP to the MCP streamable
 * HTTP transport. The returned function handles all methods (GET/POST/DELETE)
 * on the mounted path.
 */
export function createHttpHandler(opts: HttpHandlerOptions): McpHttpHandler {
  const { provider, getViewer, stateful = true, maxBodyBytes = LIMITS.MAX_REQUEST_BYTES } = opts;

  // Per-session transports (stateful) or a fresh transport per call (stateless).
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  // The identity that opened each session — a session is not transferable.
  const sessionViewers = new Map<string, string>();

  async function resolveViewer(req: IncomingMessage): Promise<string | null> {
    try {
      const viewer = await getViewer(req);
      return viewer !== null && viewer.trim().length > 0 ? viewer : null;
    } catch {
      // A thrown identity error (missing header, bad token) is an auth failure,
      // not a server fault.
      return null;
    }
  }

  function createSessionTransport(viewer: string): StreamableHTTPServerTransport {
    const transport = new StreamableHTTPServerTransport(
      stateful
        ? {
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string) => {
              sessions.set(id, transport);
              sessionViewers.set(id, viewer);
            },
          }
        : {},
    );

    transport.onclose = () => {
      if (transport.sessionId !== undefined) {
        sessions.delete(transport.sessionId);
        sessionViewers.delete(transport.sessionId);
      }
    };

    return transport;
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const viewer = await resolveViewer(req);
      if (viewer === null) {
        sendError(
          res,
          401,
          -32001,
          'Unauthenticated: MCP requests must carry the credentials this ' +
            "instance's auth mode requires.",
        );
        return;
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      // A POST body is read here, counted against the cap, rather than by the
      // transport, whose reader takes any size: one request could otherwise
      // fill the server's memory. Coming after the identity check, it is never
      // read for an unauthenticated caller.
      let body: unknown;
      if (req.method === 'POST') {
        const text = await readBody(req, maxBodyBytes);
        if (text === null) {
          sendError(res, 413, -32000, 'Request body too large');
          return;
        }
        try {
          body = JSON.parse(text);
        } catch {
          sendError(res, 400, -32700, 'Parse error: Invalid JSON');
          return;
        }
      }

      if (sessionId !== undefined && sessions.has(sessionId)) {
        const owner = sessionViewers.get(sessionId);
        if (owner !== undefined && owner !== viewer) {
          sendError(
            res,
            403,
            -32003,
            'Session belongs to a different identity. Open your own session ' +
              'instead of reusing another caller\u2019s mcp-session-id.',
          );
          return;
        }
        transport = sessions.get(sessionId)!;
      } else if (stateful && sessionId !== undefined) {
        // An id this server never issued or has already closed (a restart, a
        // DELETE). 404 is how the transport tells a client its session is gone
        // and it must initialize again; a fresh, uninitialized server would
        // answer 400 "Server not initialized" and leave the client stuck.
        sendError(res, 404, -32001, 'Session not found');
        return;
      } else {
        // A new session (or a stateless call): wire a fresh MCP server bound to
        // this caller. Tool handlers read the viewer through the closure, so
        // every tool call in this session is attributed to them.
        transport = createSessionTransport(viewer);
        const mcp = createMcpServer({ provider, getViewer: () => viewer });

        // McpServer.connect expects Transport; StreamableHTTPServerTransport
        // satisfies it structurally but TS complains about optional callback
        // types under exactOptionalPropertyTypes. A safe cast is warranted here.
        await mcp.connect(transport as Parameters<typeof mcp.connect>[0]);
      }

      await transport.handleRequest(req, res, body);
    } catch {
      sendError(res, 500, -32603, 'Internal server error');
    }
  };
}
