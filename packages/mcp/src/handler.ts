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
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a request handler that bridges Node.js HTTP to the MCP streamable
 * HTTP transport. The returned function handles all methods (GET/POST/DELETE)
 * on the mounted path.
 */
export function createHttpHandler(opts: HttpHandlerOptions): McpHttpHandler {
  const { provider, getViewer, stateful = true } = opts;

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

      await transport.handleRequest(req, res);
    } catch {
      sendError(res, 500, -32603, 'Internal server error');
    }
  };
}
