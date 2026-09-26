/**
 * @agentdocstore/mcp — MCP server exposing 16 tools over stdio and HTTP.
 */

// Shared tool logic (usable for direct invocation in tests).
export * as tools from './tools.js';
export * as schemas from './schemas.js';
export { extractId } from './tools.js';

// MCP server factory.
export { createMcpServer } from './register.js';
export type { McpServerOptions } from './register.js';

// HTTP transport handler (for the server package to mount).
export { createHttpHandler } from './handler.js';
export type { HttpHandlerOptions, McpHttpHandler } from './handler.js';
