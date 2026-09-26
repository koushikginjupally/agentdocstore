#!/usr/bin/env node
/**
 * AgentDocStore MCP server — stdio transport.
 *
 * Constructs a {@link Provider} (in-memory by default) and an MCP server
 * IN-PROCESS, then connects via the SDK's stdio transport. No HTTP server
 * required — this is the "local hosting gives full MCP access" entry point.
 *
 * Usage:
 *   node dist/stdio.js                  # ephemeral in-memory provider
 *   node dist/stdio.js --user alice     # set local user identity
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { userInfo } from 'node:os';
import { createMemoryProvider } from '@agentdocstore/provider-memory';
import { createMcpServer } from './register.js';

// ---------------------------------------------------------------------------
// CLI args (minimal; no arg-parsing library needed)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { user: string } {
  // Default to the OS login, matching the server's single-user auth mode, so a
  // doc created here is owned by the same user the web UI shows.
  let user = userInfo().username;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--user' && i + 1 < argv.length) {
      user = argv[i + 1]!;
    }
  }
  return { user };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const provider = createMemoryProvider();

  const mcp = createMcpServer({
    provider,
    getViewer: () => args.user,
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

main().catch((err) => {
  process.stderr.write(`Fatal: ${String(err)}\n`);
  process.exit(1);
});
