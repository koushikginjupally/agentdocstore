/**
 * `agentdocstore mcp` — run the MCP server in stdio mode, constructing
 * the provider in-process (no HTTP server needed).
 *
 * This is the "local hosting gives full MCP access" path: an AI client gets all
 * 16 tools with nothing listening on any port.
 */

import { userInfo } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '@agentdocstore/mcp';

import type { ResolvedConfig } from './config.js';
import { loadProvider } from './provider-loader.js';
import { installNetworkFuse } from './fuse.js';

export async function runMcp(config: ResolvedConfig): Promise<void> {
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

  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  // Graceful shutdown. Kept rejection-proof: `process.on` discards a
  // listener's promise, so a throw inside an async listener would become an
  // unhandled rejection instead of a clean exit.
  const shutdown = async (): Promise<never> => {
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
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
