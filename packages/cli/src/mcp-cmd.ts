/**
 * `agentdocstore mcp` — run the MCP server in stdio mode, constructing
 * the provider in-process (no HTTP server needed).
 *
 * This is the "local hosting gives full MCP access" path: an AI client gets all
 * 16 tools with nothing listening on any port.
 */

import { userInfo } from 'node:os';
import type { Readable, Writable } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '@agentdocstore/mcp';

import type { ResolvedConfig } from './config.js';
import { loadProvider } from './provider-loader.js';
import { installNetworkFuse } from './fuse.js';

/** Where the stdio server reads and writes, and how it ends. Tests swap these. */
export interface McpStdio {
  stdin: Readable;
  stdout: Writable;
  exit: (code: number) => void;
}

const processStdio: McpStdio = {
  stdin: process.stdin,
  stdout: process.stdout,
  exit: (code) => process.exit(code),
};

/** How long a shutdown started by stdin closing waits for requests already received. */
const DRAIN_TIMEOUT_MS = 5000;

/**
 * Track requests the transport has received but not yet answered, and return
 * a function that waits until none are left (or the timeout passes). Call it
 * before `connect`: the server chains its own onmessage after this one.
 */
function trackOpenRequests(transport: StdioServerTransport): (timeoutMs: number) => Promise<void> {
  const open = new Set<string | number>();
  let idle: (() => void) | undefined;
  transport.onmessage = (message: JSONRPCMessage) => {
    if ('method' in message && 'id' in message) open.add(message.id);
  };
  const send = transport.send.bind(transport);
  transport.send = async (message: JSONRPCMessage) => {
    try {
      await send(message);
    } finally {
      if (!('method' in message) && 'id' in message && message.id !== undefined) {
        open.delete(message.id);
        if (open.size === 0) idle?.();
      }
    }
  };
  return (timeoutMs) =>
    open.size === 0
      ? Promise.resolve()
      : new Promise((resolve) => {
          const timer = setTimeout(resolve, timeoutMs);
          idle = () => {
            clearTimeout(timer);
            resolve();
          };
        });
}

export async function runMcp(
  config: ResolvedConfig,
  stdio: McpStdio = processStdio,
): Promise<void> {
  if (config.mode === 'offline') {
    installNetworkFuse();
  }

  // No host: stdio binds nothing, so only the provider is policy-checked.
  const loaded = await loadProvider({
    selection: config.provider,
    dataDir: config.dataDir,
    mode: config.mode,
  });
  const provider = loaded.provider;

  // stdio has exactly one caller — the local process that spawned us — so the
  // identity is the configured user, defaulting to the OS login. This MUST match
  // what single-user REST resolves to, or documents created here would be invisible
  // in the web UI reading the same data directory.
  const viewer = config.user ?? userInfo().username;

  const mcp = createMcpServer({
    provider,
    getViewer: () => viewer,
  });

  const transport = new StdioServerTransport(stdio.stdin, stdio.stdout);
  const openRequestsDone = trackOpenRequests(transport);
  await mcp.connect(transport);

  // Graceful shutdown. Kept rejection-proof: `process.on` discards a
  // listener's promise, so a throw inside an async listener would become an
  // unhandled rejection instead of a clean exit. Runs once, whichever signal
  // arrives first.
  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    try {
      await mcp.close();
    } catch {
      // Transport already gone — nothing left to close cleanly.
    }
    try {
      await provider.close();
    } catch {
      // Best effort: the process is exiting either way.
    }
    stdio.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  // An MCP client stops a stdio server by closing its stdin, signalling only if
  // it does not exit. Without this the process just ran out of work and exited
  // without closing the provider, leaving the data-dir lock behind. Requests
  // that arrived before the close still finish, so a write sent just before
  // disconnecting is saved.
  let stdinClosed = false;
  const onStdinClosed = (): void => {
    if (stdinClosed) return;
    stdinClosed = true;
    void openRequestsDone(DRAIN_TIMEOUT_MS).then(shutdown);
  };
  stdio.stdin.once('end', onStdinClosed);
  stdio.stdin.once('close', onStdinClosed);
}
