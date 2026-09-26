/**
 * Zod schemas for every MCP tool input. Shared by both transports.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared refinements
// ---------------------------------------------------------------------------

/** Accepts either a bare id or a URL whose path contains one. */
const idOrUrl = z.string().describe('Document id or a URL containing one');

const visibilityEnum = z.enum(['PUBLIC', 'PRIVATE']);

const languageEnum = z.enum([
  'markdown',
  'mermaid',
  'plaintext',
  'text',
  'javascript',
  'typescript',
  'python',
  'java',
  'go',
  'rust',
  'json',
  'yaml',
  'xml',
  'html',
  'css',
  'sql',
  'bash',
  'dockerfile',
]);

const redactionPolicyEnum = z.enum(['redact', 'skip']);

// ---------------------------------------------------------------------------
// Per-tool schemas
// ---------------------------------------------------------------------------

export const CreateDocumentInput = z.object({
  title: z.string().describe('Human-readable title'),
  content: z.string().describe('Initial content'),
  language: languageEnum.optional().default('plaintext').describe('Content language'),
  visibility: visibilityEnum.optional().default('PUBLIC').describe('Access visibility'),
  expiresAt: z.string().optional().describe('ISO-8601 expiry timestamp'),
  redactionPolicy: redactionPolicyEnum
    .optional()
    .describe(
      'What to do when credentials are detected: "redact" to store with redactions, "skip" to store as-is. Omit to trigger detection-only flow.',
    ),
});

export const ReadDocumentInput = z.object({
  id: idOrUrl.describe('Document id or URL'),
  version: z.number().int().positive().optional().describe('Specific version number'),
});

export const UpdateDocumentInput = z.object({
  id: idOrUrl.describe('Document id or URL'),
  content: z.string().optional().describe('New content (creates a new version)'),
  title: z.string().optional().describe('New title'),
  language: languageEnum.optional().describe('New language'),
  expiresAt: z.union([z.string(), z.null()]).optional().describe('New expiry (null to clear)'),
  latestVersion: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Expected latest version for CAS (required when content is provided)'),
  redactionPolicy: redactionPolicyEnum
    .optional()
    .describe('What to do when credentials are detected in new content'),
});

export const DeleteDocumentInput = z.object({
  id: idOrUrl.describe('Document id or URL'),
});

export const ListDocumentsInput = z.object({
  owner: z.string().optional().describe('Filter by owner (defaults to viewer)'),
  limit: z.number().int().positive().max(100).optional().describe('Page size'),
  cursor: z.string().optional().describe('Pagination cursor'),
});

export const GetVersionsInput = z.object({
  id: idOrUrl.describe('Document id or URL'),
});

export const DiffDocumentInput = z.object({
  id: idOrUrl.describe('Document id or URL'),
  fromVersion: z.number().int().positive().describe('Older version number'),
  toVersion: z.number().int().positive().describe('Newer version number'),
  context: z.number().int().min(0).optional().describe('Context lines around hunks'),
});

export const GetRawDocumentInput = z.object({
  id: idOrUrl.describe('Document id or URL'),
  version: z.number().int().positive().optional().describe('Specific version number'),
});

export const AddCommentInput = z.object({
  id: idOrUrl.describe('Document id or URL'),
  body: z.string().describe('Comment body'),
});

export const GetCommentsInput = z.object({
  id: idOrUrl.describe('Document id or URL'),
});

export const ResolveCommentInput = z.object({
  id: idOrUrl.describe('Document id or URL'),
  commentId: z.string().describe('Comment id to resolve'),
});

export const UnresolveCommentInput = z.object({
  id: idOrUrl.describe('Document id or URL'),
  commentId: z.string().describe('Comment id to unresolve'),
});

export const DeleteCommentInput = z.object({
  id: idOrUrl.describe('Document id or URL'),
  commentId: z.string().describe('Comment id to delete'),
});

export const SetVisibilityInput = z.object({
  id: idOrUrl.describe('Document id or URL'),
  visibility: visibilityEnum.describe('New visibility'),
});

export const ScanContentInput = z.object({
  content: z.string().describe('Content to scan for credentials'),
});

export const GetHelpInput = z.object({
  topic: z.string().optional().describe('Optional topic to get help on'),
});
