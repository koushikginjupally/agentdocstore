/**
 * Shared tool implementations for all 16 MCP tools.
 *
 * Every tool is a plain async function over a {@link Provider} and a viewer
 * identity string. Both the stdio and HTTP transports delegate to this module
 * — tool logic is never duplicated across transports.
 */

import type { Provider, Document, Visibility, Language } from '@agentdocstore/core';
import {
  isValidId,
  assertCanRead,
  assertCanReadRaw,
  assertCanWrite,
  assertCanDelete,
  canRead,
  isExpired,
  assertCanComment,
  assertCanDeleteComment,
  normalizeEditMessage,
  validateTitle,
  NotFoundError,
  ValidationError,
  LIMITS,
  LANGUAGES,
  scan,
  redact,
  unifiedDiff,
} from '@agentdocstore/core';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a doc id from a bare id string or a URL whose path contains one. */
export function extractId(input: string): string {
  const trimmed = input.trim();

  // Bare id?
  if (isValidId(trimmed)) return trimmed;

  // Try parsing as URL and look for a valid id in the path segments.
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split('/').filter(Boolean);
    for (const seg of segments) {
      if (isValidId(seg)) return seg;
    }
  } catch {
    // Not a URL — fall through.
  }

  throw new ValidationError(`Cannot extract a valid doc id from: ${trimmed}`);
}

function text(t: string): CallToolResult {
  return { content: [{ type: 'text', text: t }] };
}

function jsonResult(obj: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

async function requireDocument(
  provider: Provider,
  rawId: string,
  opts: { includeExpired?: boolean } = {},
): Promise<Document> {
  const id = extractId(rawId);
  const doc = await provider.repository.get(id);
  // An expired document is absent even before anything reclaims it: the stdio
  // server runs no expiry sweep at all.
  if (doc === null || (opts.includeExpired !== true && isExpired(doc))) {
    throw new NotFoundError(`Document '${id}' not found`);
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function createDocument(
  provider: Provider,
  viewer: string,
  args: {
    title: string;
    content: string;
    language?: string | undefined;
    visibility?: string | undefined;
    expiresAt?: string | undefined;
    redactionPolicy?: 'redact' | 'skip' | undefined;
  },
): Promise<CallToolResult> {
  const language = (args.language ?? 'plaintext') as Language;
  const visibility = (args.visibility ?? 'PUBLIC') as Visibility;

  // Credential detection flow: scan first.
  const findings = scan(args.content);
  if (findings.length > 0 && args.redactionPolicy === undefined) {
    // Return findings and options — do NOT persist.
    return jsonResult({
      action: 'credentials_detected',
      findings: findings.map((f) => ({
        type: f.type,
        line: f.line,
      })),
      options: ['redact', 'skip'],
      message:
        'Credentials detected in content. Re-call create_document with redactionPolicy set to "redact" (store with redactions) or "skip" (store as-is).',
    });
  }

  const content =
    findings.length > 0 && args.redactionPolicy === 'redact'
      ? redact(args.content, findings)
      : args.content;

  const doc = await provider.repository.create({
    title: args.title,
    content,
    language,
    visibility,
    createdBy: viewer,
    ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
  });

  return jsonResult({ doc, message: `Created doc ${doc.id}` });
}

export async function readDocument(
  provider: Provider,
  viewer: string | null,
  args: { id: string; version?: number | undefined },
): Promise<CallToolResult> {
  const doc = await requireDocument(provider, args.id);
  assertCanRead(doc, viewer);

  const ver = args.version ?? doc.latestVersion;
  const version = await provider.repository.getVersion(doc.id, ver);
  if (version === null) {
    throw new NotFoundError(`Version ${ver} of doc '${doc.id}' not found`);
  }

  return jsonResult({ doc, version });
}

export async function updateDocument(
  provider: Provider,
  viewer: string,
  args: {
    id: string;
    content?: string | undefined;
    title?: string | undefined;
    language?: string | undefined;
    expiresAt?: string | null | undefined;
    latestVersion?: number | undefined;
    editMessage?: string | undefined;
    redactionPolicy?: 'redact' | 'skip' | undefined;
  },
): Promise<CallToolResult> {
  const doc = await requireDocument(provider, args.id);
  assertCanWrite(doc, viewer);
  const editMessage = normalizeEditMessage(args.editMessage);
  // Before the version append: a bad title must fail the call with nothing
  // saved, not after the new version is already stored.
  if (args.title !== undefined) validateTitle(args.title);

  let updatedDocument = doc;

  // Content update (new version).
  if (args.content !== undefined) {
    if (args.latestVersion === undefined) {
      throw new ValidationError('latestVersion is required when updating content (CAS guard)');
    }

    // Credential detection flow.
    const findings = scan(args.content);
    if (findings.length > 0 && args.redactionPolicy === undefined) {
      return jsonResult({
        action: 'credentials_detected',
        findings: findings.map((f) => ({ type: f.type, line: f.line })),
        options: ['redact', 'skip'],
        message:
          'Credentials detected in new content. Re-call update_document with redactionPolicy set to "redact" or "skip".',
      });
    }

    const content =
      findings.length > 0 && args.redactionPolicy === 'redact'
        ? redact(args.content, findings)
        : args.content;

    updatedDocument = await provider.repository.appendVersion(doc.id, {
      content,
      editedBy: viewer,
      ...(editMessage !== undefined ? { message: editMessage } : {}),
      expect: { latestVersion: args.latestVersion },
    });
  }

  // Metadata update.
  const hasMeta =
    args.title !== undefined || args.language !== undefined || args.expiresAt !== undefined;

  if (hasMeta) {
    updatedDocument = await provider.repository.updateMeta(doc.id, {
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.language !== undefined ? { language: args.language as Language } : {}),
      ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
    });
  }

  return jsonResult({ doc: updatedDocument, message: `Updated doc ${doc.id}` });
}

export async function deleteDocument(
  provider: Provider,
  viewer: string,
  args: { id: string },
): Promise<CallToolResult> {
  // Expired documents stay deletable by their owner.
  const doc = await requireDocument(provider, args.id, { includeExpired: true });
  assertCanDelete(doc, viewer);
  await provider.repository.delete(doc.id);
  return text(`Deleted doc ${doc.id}`);
}

export async function listDocuments(
  provider: Provider,
  viewer: string,
  args: {
    owner?: string | undefined;
    query?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
  },
): Promise<CallToolResult> {
  if (args.query !== undefined && args.query.trim().length > 0) {
    return searchDocuments(provider, viewer, args.query, args);
  }
  const owner = args.owner ?? viewer;
  const query: { limit?: number; cursor?: string } = {};
  if (args.limit !== undefined) query.limit = args.limit;
  if (args.cursor !== undefined) query.cursor = args.cursor;
  const page = await provider.repository.listByOwner(owner, query);
  // `owner` may name someone else, so apply the same read rule as every other
  // tool: another user's PRIVATE documents must never be listed.
  const items = page.items.filter((d) => !isExpired(d) && canRead(d, viewer));
  return jsonResult({ ...page, items });
}

/**
 * list_documents with a query: the same search as REST's
 * `GET /api/documents?query=` — PUBLIC documents plus the viewer's own PRIVATE
 * ones. The cursor is the position of the next match and comes back as
 * nextCursor while more matches remain.
 */
async function searchDocuments(
  provider: Provider,
  viewer: string,
  query: string,
  args: { owner?: string | undefined; limit?: number | undefined; cursor?: string | undefined },
): Promise<CallToolResult> {
  // Search spans every owner, so an owner filter cannot be honoured without
  // breaking the page and total counts.
  if (args.owner !== undefined) {
    throw new ValidationError("'owner' cannot be combined with 'query'");
  }
  let offset = 0;
  if (args.cursor !== undefined) {
    offset = /^\d+$/.test(args.cursor) ? Number(args.cursor) : NaN;
    if (!Number.isSafeInteger(offset)) {
      throw new ValidationError("'cursor' must be a nextCursor returned by this search");
    }
  }
  const results = provider.search.query(query, viewer, { limit: args.limit ?? 50, offset });
  const items: Document[] = [];
  for (const hit of results.hits) {
    const doc = await provider.repository.get(hit.documentId);
    // The index already applies visibility; the read check keeps a faulty
    // provider from listing someone else's PRIVATE document.
    if (doc !== null && !isExpired(doc) && canRead(doc, viewer)) items.push(doc);
  }
  const next = offset + results.hits.length;
  return jsonResult({
    items,
    total: results.total,
    ...(next < results.total ? { nextCursor: String(next) } : {}),
  });
}

export async function getVersions(
  provider: Provider,
  viewer: string | null,
  args: { id: string },
): Promise<CallToolResult> {
  const doc = await requireDocument(provider, args.id);
  assertCanRead(doc, viewer);
  const versions = await provider.repository.listVersions(doc.id);
  return jsonResult({
    documentId: doc.id,
    versions: versions.map((v) => ({
      version: v.version,
      createdBy: v.createdBy,
      createdAt: v.createdAt,
      ...(v.message !== undefined ? { message: v.message } : {}),
    })),
  });
}

export async function diffDocument(
  provider: Provider,
  viewer: string | null,
  args: { id: string; fromVersion: number; toVersion: number; context?: number | undefined },
): Promise<CallToolResult> {
  const doc = await requireDocument(provider, args.id);
  assertCanRead(doc, viewer);

  const [from, to] = await Promise.all([
    provider.repository.getVersion(doc.id, args.fromVersion),
    provider.repository.getVersion(doc.id, args.toVersion),
  ]);

  if (from === null) {
    throw new NotFoundError(`Version ${args.fromVersion} of doc '${doc.id}' not found`);
  }
  if (to === null) {
    throw new NotFoundError(`Version ${args.toVersion} of doc '${doc.id}' not found`);
  }

  const diffOpts: { oldLabel: string; newLabel: string; context?: number } = {
    oldLabel: `v${args.fromVersion}`,
    newLabel: `v${args.toVersion}`,
  };
  if (args.context !== undefined) diffOpts.context = args.context;

  const diff = unifiedDiff(from.content, to.content, diffOpts);

  return text(diff || '(no differences)');
}

export async function getRawDocument(
  provider: Provider,
  viewer: string | null,
  args: { id: string; version?: number | undefined },
): Promise<CallToolResult> {
  const doc = await requireDocument(provider, args.id);
  assertCanReadRaw(doc, viewer);

  const ver = args.version ?? doc.latestVersion;
  const version = await provider.repository.getVersion(doc.id, ver);
  if (version === null) {
    throw new NotFoundError(`Version ${ver} of doc '${doc.id}' not found`);
  }

  return text(version.content);
}

export async function addComment(
  provider: Provider,
  viewer: string,
  args: { id: string; body: string },
): Promise<CallToolResult> {
  const doc = await requireDocument(provider, args.id);
  assertCanComment(doc, viewer);
  const comment = await provider.comments.add(doc.id, {
    author: viewer,
    body: args.body,
  });
  return jsonResult({ comment, message: `Comment ${comment.id} added` });
}

export async function getComments(
  provider: Provider,
  viewer: string | null,
  args: { id: string },
): Promise<CallToolResult> {
  const doc = await requireDocument(provider, args.id);
  assertCanRead(doc, viewer);
  const comments = await provider.comments.list(doc.id);
  return jsonResult({ documentId: doc.id, comments });
}

export async function resolveComment(
  provider: Provider,
  viewer: string,
  args: { id: string; commentId: string },
): Promise<CallToolResult> {
  const doc = await requireDocument(provider, args.id);
  assertCanComment(doc, viewer);
  const comment = await provider.comments.setResolved(doc.id, args.commentId, true);
  return jsonResult({ comment, message: 'Comment resolved' });
}

export async function unresolveComment(
  provider: Provider,
  viewer: string,
  args: { id: string; commentId: string },
): Promise<CallToolResult> {
  const doc = await requireDocument(provider, args.id);
  assertCanComment(doc, viewer);
  const comment = await provider.comments.setResolved(doc.id, args.commentId, false);
  return jsonResult({ comment, message: 'Comment unresolved' });
}

export async function deleteComment(
  provider: Provider,
  viewer: string,
  args: { id: string; commentId: string },
): Promise<CallToolResult> {
  const doc = await requireDocument(provider, args.id);
  assertCanComment(doc, viewer);
  const target = (await provider.comments.list(doc.id)).find((c) => c.id === args.commentId);
  if (!target) throw new NotFoundError('Comment not found');
  assertCanDeleteComment(doc, target, viewer);
  await provider.comments.delete(doc.id, args.commentId);
  return text(`Comment ${args.commentId} deleted`);
}

export async function setVisibility(
  provider: Provider,
  viewer: string,
  args: { id: string; visibility: string },
): Promise<CallToolResult> {
  const doc = await requireDocument(provider, args.id);
  assertCanWrite(doc, viewer);
  const updated = await provider.repository.setVisibility(doc.id, args.visibility as Visibility);
  return jsonResult({
    doc: updated,
    message: `Visibility set to ${args.visibility}`,
  });
}

export async function scanContent(
  _provider: Provider,
  _viewer: string | null,
  args: { content: string },
): Promise<CallToolResult> {
  const findings = scan(args.content);
  return jsonResult({
    findings: findings.map((f) => ({
      type: f.type,
      line: f.line,
      start: f.start,
      end: f.end,
    })),
    total: findings.length,
    message:
      findings.length === 0
        ? 'No credentials detected.'
        : `${findings.length} credential(s) detected.`,
  });
}

export async function getHelp(
  _provider: Provider,
  _viewer: string | null,
  args: { topic?: string | undefined },
): Promise<CallToolResult> {
  const sections: Record<string, string> = {
    overview: [
      '# AgentDocStore MCP Tools',
      '',
      'AgentDocStore is a self-hostable document and artifact store.',
      'This MCP server exposes 16 tools for full CRUD, versioning, diffing,',
      'commenting, visibility control, and credential scanning.',
      '',
      '## Available tools',
      '- create_document: Create a new doc with content',
      '- read_document: Read a doc and its content (by id or URL)',
      '- update_document: Update content (new version) and/or metadata',
      '- delete_document: Delete a doc (owner only)',
      '- list_documents: List documents by owner, or search them with query',
      '- get_versions: List all versions of a doc',
      '- diff_document: Unified diff between two versions',
      '- get_raw_document: Get raw content of a doc',
      '- add_comment: Add a comment to a doc',
      '- get_comments: List comments on a doc',
      '- resolve_comment: Mark a comment as resolved',
      '- unresolve_comment: Mark a comment as unresolved',
      '- delete_comment: Delete a comment',
      '- set_visibility: Change doc visibility (PUBLIC/PRIVATE)',
      '- scan_content: Scan text for credentials',
      '- get_help: This help text',
      '',
      '## Key concepts',
      '- Documents have immutable versions; every content update creates a new version.',
      '- Optimistic concurrency: provide latestVersion when updating content.',
      '- PRIVATE documents are owner-only; PUBLIC documents are readable by anyone.',
      '- Credential scanning runs automatically on create/update; detected',
      '  credentials return options (redact/skip) before persisting.',
      '',
      `## Limits`,
      `- Title: ${LIMITS.MAX_TITLE_BYTES} bytes`,
      `- Content: ${LIMITS.MAX_CONTENT_BYTES} bytes`,
      `- Diff input: ${LIMITS.MAX_DIFF_INPUT_BYTES} bytes per side`,
      `- Comment: ${LIMITS.MAX_COMMENT_BYTES} bytes`,
      `- Languages: ${LANGUAGES.join(', ')}`,
    ].join('\n'),

    create: [
      '# create_document',
      '',
      'Create a new doc.',
      '',
      '## Parameters',
      '- title (required): Human-readable title',
      '- content (required): Initial content',
      '- language: Content language (default: plaintext)',
      '- visibility: PUBLIC (default) or PRIVATE',
      '- expiresAt: Optional ISO-8601 expiry',
      '- redactionPolicy: "redact" or "skip" (only needed if credentials detected)',
      '',
      '## Example',
      '```json',
      '{ "title": "My snippet", "content": "console.log(42);", "language": "javascript" }',
      '```',
    ].join('\n'),

    diff: [
      '# diff_document',
      '',
      'Produce a unified diff between two versions of a doc.',
      '',
      '## Parameters',
      '- id (required): Document id or URL',
      '- fromVersion (required): Older version number',
      '- toVersion (required): Newer version number',
      '- context: Number of context lines (default: 3)',
    ].join('\n'),
  };

  const topic = args.topic?.toLowerCase();
  if (topic !== undefined && topic in sections) {
    return text(sections[topic]!);
  }

  return text(sections['overview']!);
}
