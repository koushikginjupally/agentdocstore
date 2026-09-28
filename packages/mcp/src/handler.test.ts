import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, request } from 'node:http';
import type { Server, IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { createMemoryProvider } from '@agentdocstore/provider-memory';
import type { Provider } from '@agentdocstore/core';

import { createHttpHandler } from './handler.js';

/**
 * `/mcp` reaches the same provider as the REST API, so its identity handling is
 * a security boundary, not a convenience. These tests pin the three properties
 * that matter: no identity means no access, identity is re-resolved per request,
 * and a session id is not a credential.
 */

let provider: Provider;
let server: Server;
let base: string;

/** Mount the handler with the given viewer resolution and return its base URL. */
async function mount(
  getViewer: (req: IncomingMessage) => string | null | Promise<string | null>,
  options: { maxBodyBytes?: number } = {},
): Promise<void> {
  const handler = createHttpHandler({ provider, getViewer, ...options });
  server = createServer((req, res) => {
    // How much of the request the server had read when it answered.
    res.on('finish', () => (lastBytesRead = req.socket.bytesRead));
    handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
}

let lastBytesRead = 0;

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
};

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(base, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  provider = createMemoryProvider();
});

afterEach(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await provider.close();
});

describe('MCP over HTTP — authentication', () => {
  it('refuses a request with no resolvable identity (401), not a synthetic user', async () => {
    await mount(() => null);
    const res = await post(INITIALIZE);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32001);
    expect(body.error.message).toMatch(/Unauthenticated/);
  });

  it('treats a thrown identity error as 401, not 500', async () => {
    await mount(() => {
      throw new Error('Missing or empty identity header');
    });
    const res = await post(INITIALIZE);
    expect(res.status).toBe(401);
  });

  it('refuses a blank identity', async () => {
    await mount(() => '   ');
    expect((await post(INITIALIZE)).status).toBe(401);
  });

  it('accepts a resolved identity and completes the handshake', async () => {
    await mount((req) => (req.headers['x-user'] as string | undefined) ?? null);
    const res = await post(INITIALIZE, { 'x-user': 'alice' });
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });

  it('re-resolves identity on EVERY request, so a revoked credential stops working', async () => {
    let allow = true;
    await mount(() => (allow ? 'alice' : null));

    const first = await post(INITIALIZE, {});
    expect(first.status).toBe(200);
    const sessionId = first.headers.get('mcp-session-id')!;

    // Credential revoked between calls; the established session must not carry
    // the caller through on the strength of the earlier check.
    allow = false;
    const second = await post(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { 'mcp-session-id': sessionId },
    );
    expect(second.status).toBe(401);
  });

  it('refuses a session id presented by a DIFFERENT identity (403)', async () => {
    await mount((req) => (req.headers['x-user'] as string | undefined) ?? null);

    const opened = await post(INITIALIZE, { 'x-user': 'alice' });
    expect(opened.status).toBe(200);
    const sessionId = opened.headers.get('mcp-session-id')!;

    // Bob leaks/guesses Alice's session id. Without the binding he would act as
    // Alice and reach her PRIVATE documents.
    const hijack = await post(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { 'x-user': 'bob', 'mcp-session-id': sessionId },
    );
    expect(hijack.status).toBe(403);
    const body = (await hijack.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32003);
    expect(body.error.message).toMatch(/different identity/);

    // Alice's own session still works.
    const ok = await post(
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      { 'x-user': 'alice', 'mcp-session-id': sessionId },
    );
    expect(ok.status).toBe(200);
  });
});

describe('MCP over HTTP — sessions it does not know', () => {
  // A 404 tells a client its session is gone and it must initialize again
  // (MCP streamable HTTP transport); anything else leaves it stuck.
  const expectSessionNotFound = async (res: Response): Promise<void> => {
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32001);
    expect(body.error.message).toMatch(/Session not found/);
  };

  it('answers 404 for a session id it never issued, for example after a restart', async () => {
    await mount(() => 'alice');
    await expectSessionNotFound(
      await post(
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { 'mcp-session-id': 'issued-by-an-earlier-run' },
      ),
    );
  });

  it('answers 404 once the session has been closed', async () => {
    await mount(() => 'alice');
    const opened = await post(INITIALIZE);
    const sessionId = opened.headers.get('mcp-session-id')!;
    const closed = await fetch(base, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId },
    });
    expect(closed.status).toBe(200);
    await expectSessionNotFound(
      await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-session-id': sessionId }),
    );
  });

  it('still lets the client start again with a new session', async () => {
    await mount(() => 'alice');
    const res = await post(INITIALIZE);
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });
});

// The SDK transport reads a POST body with no size limit, so one request could
// fill the server's memory: a 200 MB initialize was accepted (RSS 117 → 934 MB).
describe('MCP over HTTP — request size', () => {
  const LIMIT = 256 * 1024;
  const CHUNK = 64 * 1024;
  const HEAD =
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05",' +
    '"capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"},"padding":"';
  const TAIL = '"}}';

  /**
   * POST an initialize padded to about `bytes`, chunked (no Content-Length)
   * unless `declareLength`. Resolves on the response, even if the server
   * answers before the upload is finished.
   */
  function send(bytes: number, declareLength = false): Promise<{ status: number; body: string }> {
    const url = new URL(base);
    const padding = Math.max(0, bytes - HEAD.length - TAIL.length);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: url.hostname,
          port: url.port,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(declareLength ? { 'content-length': HEAD.length + padding + TAIL.length } : {}),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (d: Buffer) => (body += d.toString()));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      req.write(HEAD);
      let left = padding;
      const pump = (): void => {
        while (left > 0) {
          const n = Math.min(CHUNK, left);
          left -= n;
          if (!req.write('x'.repeat(n))) return void req.once('drain', pump);
        }
        req.end(TAIL);
      };
      pump();
    });
  }

  it('refuses a chunked body (413) as soon as it passes the limit', async () => {
    await mount(() => 'alice', { maxBodyBytes: LIMIT });
    const res = await send(40 * LIMIT);
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'Request body too large' },
    });
    expect(lastBytesRead).toBeLessThan(4 * LIMIT);
  });

  it('refuses a declared Content-Length over the limit before reading the body', async () => {
    await mount(() => 'alice', { maxBodyBytes: LIMIT });
    const res = await send(4 * LIMIT, true);
    expect(res.status).toBe(413);
    expect(lastBytesRead).toBeLessThan(LIMIT);
  });

  it('accepts a chunked body under the limit', async () => {
    await mount(() => 'alice', { maxBodyBytes: LIMIT });
    const res = await send(LIMIT / 2);
    expect(res.status).toBe(200);
    expect(res.body).toContain('"protocolVersion"');
  });

  it('still answers invalid JSON with a JSON-RPC parse error', async () => {
    await mount(() => 'alice', { maxBodyBytes: LIMIT });
    const res = await fetch(base, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: '{"jsonrpc":',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32700);
  });
});
