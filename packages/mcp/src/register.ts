/**
 * Register all 16 AgentDocStore tools on an MCP {@link McpServer} instance.
 *
 * Both transports (stdio and HTTP) call {@link createMcpServer} to get a
 * fully-wired server — tool logic lives in `tools.ts` and is never duplicated.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Provider } from '@agentdocstore/core';
import {
  NotFoundError,
  ValidationError,
  VersionConflictError,
  ContentTooLargeError,
} from '@agentdocstore/core';

import * as schemas from './schemas.js';
import * as tools from './tools.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpServerOptions {
  /** The storage provider. */
  provider: Provider;
  /**
   * Resolve the viewer identity for a tool call. For stdio this is the
   * configured local user; for HTTP it comes from the request context.
   * Return `null` for anonymous.
   */
  getViewer: () => string | null;
}

// ---------------------------------------------------------------------------
// Error → tool-error mapping
// ---------------------------------------------------------------------------

function handleError(err: unknown): CallToolResult {
  if (err instanceof NotFoundError) {
    return { content: [{ type: 'text', text: err.message }], isError: true };
  }
  if (err instanceof ValidationError) {
    return { content: [{ type: 'text', text: `Validation error: ${err.message}` }], isError: true };
  }
  if (err instanceof VersionConflictError) {
    return {
      content: [
        {
          type: 'text',
          text: `Version conflict: ${err.message} (expected ${err.expected}, actual ${err.actual})`,
        },
      ],
      isError: true,
    };
  }
  if (err instanceof ContentTooLargeError) {
    return {
      content: [{ type: 'text', text: `Content too large: ${err.message}` }],
      isError: true,
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `Internal error: ${msg}` }], isError: true };
}

function requireViewer(viewer: string | null): string {
  if (viewer === null || viewer.length === 0) {
    throw new ValidationError('Authentication required for this operation');
  }
  return viewer;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a fully-wired {@link McpServer} with all 16 AgentDocStore tools
 * registered.
 */
export function createMcpServer(opts: McpServerOptions): McpServer {
  const { provider, getViewer } = opts;

  const mcp = new McpServer(
    { name: 'agentdocstore', version: '0.3.0' },
    { capabilities: { tools: {} } },
  );

  // Helper: wrap a tool handler with error mapping.
  type Handler<A> = (args: A) => Promise<CallToolResult>;
  function wrap<A>(fn: Handler<A>): Handler<A> {
    return async (args: A) => {
      try {
        return await fn(args);
      } catch (err) {
        return handleError(err);
      }
    };
  }

  // ----- create_document -----
  mcp.tool(
    'create_document',
    'Create a new doc with content',
    schemas.CreateDocumentInput.shape,
    wrap(async (args) => {
      const viewer = requireViewer(getViewer());
      return tools.createDocument(provider, viewer, args);
    }),
  );

  // ----- read_document -----
  mcp.tool(
    'read_document',
    'Read a doc and its content (accepts id or URL)',
    schemas.ReadDocumentInput.shape,
    wrap(async (args) => {
      return tools.readDocument(provider, getViewer(), args);
    }),
  );

  // ----- update_document -----
  mcp.tool(
    'update_document',
    'Update doc content (new version) and/or metadata',
    schemas.UpdateDocumentInput.shape,
    wrap(async (args) => {
      const viewer = requireViewer(getViewer());
      return tools.updateDocument(provider, viewer, args);
    }),
  );

  // ----- delete_document -----
  mcp.tool(
    'delete_document',
    'Delete a doc (owner only)',
    schemas.DeleteDocumentInput.shape,
    wrap(async (args) => {
      const viewer = requireViewer(getViewer());
      return tools.deleteDocument(provider, viewer, args);
    }),
  );

  // ----- list_documents -----
  mcp.tool(
    'list_documents',
    'List documents by owner (defaults to current user), or search them with query',
    schemas.ListDocumentsInput.shape,
    wrap(async (args) => {
      const viewer = requireViewer(getViewer());
      return tools.listDocuments(provider, viewer, args);
    }),
  );

  // ----- get_versions -----
  mcp.tool(
    'get_versions',
    'List all versions of a doc',
    schemas.GetVersionsInput.shape,
    wrap(async (args) => {
      return tools.getVersions(provider, getViewer(), args);
    }),
  );

  // ----- diff_document -----
  mcp.tool(
    'diff_document',
    'Produce a unified diff between two versions of a doc',
    schemas.DiffDocumentInput.shape,
    wrap(async (args) => {
      return tools.diffDocument(provider, getViewer(), args);
    }),
  );

  // ----- get_raw_document -----
  mcp.tool(
    'get_raw_document',
    'Get the raw content of a doc version',
    schemas.GetRawDocumentInput.shape,
    wrap(async (args) => {
      return tools.getRawDocument(provider, getViewer(), args);
    }),
  );

  // ----- add_comment -----
  mcp.tool(
    'add_comment',
    'Add a comment to a doc',
    schemas.AddCommentInput.shape,
    wrap(async (args) => {
      const viewer = requireViewer(getViewer());
      return tools.addComment(provider, viewer, args);
    }),
  );

  // ----- get_comments -----
  mcp.tool(
    'get_comments',
    'List comments on a doc',
    schemas.GetCommentsInput.shape,
    wrap(async (args) => {
      return tools.getComments(provider, getViewer(), args);
    }),
  );

  // ----- resolve_comment -----
  mcp.tool(
    'resolve_comment',
    'Mark a comment as resolved',
    schemas.ResolveCommentInput.shape,
    wrap(async (args) => {
      const viewer = requireViewer(getViewer());
      return tools.resolveComment(provider, viewer, args);
    }),
  );

  // ----- unresolve_comment -----
  mcp.tool(
    'unresolve_comment',
    'Mark a comment as unresolved',
    schemas.UnresolveCommentInput.shape,
    wrap(async (args) => {
      const viewer = requireViewer(getViewer());
      return tools.unresolveComment(provider, viewer, args);
    }),
  );

  // ----- delete_comment -----
  mcp.tool(
    'delete_comment',
    'Delete a comment',
    schemas.DeleteCommentInput.shape,
    wrap(async (args) => {
      const viewer = requireViewer(getViewer());
      return tools.deleteComment(provider, viewer, args);
    }),
  );

  // ----- set_visibility -----
  mcp.tool(
    'set_visibility',
    'Change the visibility of a doc (PUBLIC/PRIVATE)',
    schemas.SetVisibilityInput.shape,
    wrap(async (args) => {
      const viewer = requireViewer(getViewer());
      return tools.setVisibility(provider, viewer, args);
    }),
  );

  // ----- scan_content -----
  mcp.tool(
    'scan_content',
    'Scan text for embedded credentials',
    schemas.ScanContentInput.shape,
    wrap(async (args) => {
      return tools.scanContent(provider, getViewer(), args);
    }),
  );

  // ----- get_help -----
  mcp.tool(
    'get_help',
    'Get usage documentation and examples',
    schemas.GetHelpInput.shape,
    wrap(async (args) => {
      return tools.getHelp(provider, getViewer(), args);
    }),
  );

  return mcp;
}
