/**
 * Hono HTTP server for AgentDocStore.
 *
 * Exports {@link createServer} (returns a configured Hono app) and
 * {@link startServer} (binds and listens). The app is fully self-contained
 * and usable in tests without listening on a port.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import {
  LIMITS,
  NotFoundError,
  ValidationError,
  ContentTooLargeError,
  VersionConflictError,
  isValidId,
  scan,
  redact,
  unifiedDiff,
  assertCanRead,
  assertCanReadRaw,
  assertCanWrite,
  assertCanDelete,
  assertCanComment,
  DEFAULT_VISIBILITY,
  LANGUAGES,
} from '@agentdocstore/core';
import type {
  Provider,
  IdentityProvider,
  Visibility,
  Language,
  Document,
  RuntimeMode,
} from '@agentdocstore/core';

import {
  CreateDocumentSchema,
  UpdateDocumentSchema,
  CreateCommentSchema,
  PatchCommentSchema,
  SetVisibilitySchema,
  ScanSchema,
} from './schemas.js';
import {
  createSingleUserIdentity,
  createTrustedHeaderIdentity,
  createTokenIdentity,
} from './identity.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Auth mode configuration. */
export type AuthMode =
  | { mode: 'single-user'; user?: string }
  | { mode: 'trusted-header'; header: string }
  | { mode: 'token'; tokens: Readonly<Record<string, string>> };

/** Options for {@link createServer}. */
export interface CreateServerOptions {
  provider: Provider;
  auth?: AuthMode;
  /** JSON body size limit in bytes. Default: 6 MB (slightly above MAX_CONTENT_BYTES). */
  bodyLimit?: number;
  /**
   * The runtime mode this instance was started in. Reported on `/healthz` so an
   * operator (or a probe) can tell an offline instance from a networked one
   * without reading the launch command. Defaults to `offline`.
   */
  mode?: RuntimeMode;
  /** Provider name for `/healthz`, e.g. `fs`, `memory`, `postgres`. */
  providerName?: string;
}

/** Options for {@link startServer}. */
export interface StartServerOptions extends CreateServerOptions {
  port?: number;
  host?: string;
}

/** Handle returned by {@link startServer}. */
export interface ServerHandle {
  /** The underlying HTTP server. */
  server: Server;
  /** The Hono app. */
  app: Hono;
  /** Stop the expiry sweep and close the HTTP server. */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 6 * 1024 * 1024;

/**
 * Build the {@link IdentityProvider} for an auth mode.
 *
 * Exported because `/mcp` must authenticate callers exactly as the REST API
 * does — a host process wires this same resolver into the MCP HTTP handler
 * rather than inventing a second, weaker identity path.
 */
export function resolveIdentityProvider(auth?: AuthMode): IdentityProvider {
  if (auth === undefined || auth.mode === 'single-user') {
    return createSingleUserIdentity(
      auth !== undefined && auth.mode === 'single-user' ? auth.user : undefined,
    );
  }
  if (auth.mode === 'trusted-header') return createTrustedHeaderIdentity(auth.header);
  return createTokenIdentity(auth.tokens);
}

function expiresAtFromDays(days: number | undefined | null): string | undefined {
  if (days === undefined || days === null) return undefined;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function validateId(id: string): void {
  if (!isValidId(id)) throw new NotFoundError('Document not found');
}

function validateLanguage(lang: string): asserts lang is Language {
  if (!(LANGUAGES as readonly string[]).includes(lang)) {
    throw new ValidationError(`Invalid language '${lang}'`);
  }
}

function validateTitleSize(title: string): void {
  if (Buffer.byteLength(title, 'utf8') > LIMITS.MAX_TITLE_BYTES) {
    throw new ValidationError('Title exceeds maximum length');
  }
}

function validateContentSize(content: string): void {
  const size = Buffer.byteLength(content, 'utf8');
  if (size > LIMITS.MAX_CONTENT_BYTES) {
    throw new ContentTooLargeError('Content exceeds size cap', LIMITS.MAX_CONTENT_BYTES, size);
  }
}

function validateCommentSize(body: string): void {
  if (Buffer.byteLength(body, 'utf8') > LIMITS.MAX_COMMENT_BYTES) {
    throw new ValidationError('Comment exceeds maximum length');
  }
}

// ---------------------------------------------------------------------------
// createServer
// ---------------------------------------------------------------------------

/**
 * Build and return a fully-configured Hono application.
 *
 * The app is usable in tests via `app.request(...)` without binding a port.
 */
export function createServer(opts: CreateServerOptions): Hono {
  const { provider } = opts;
  const identity = resolveIdentityProvider(opts.auth);
  const bodyLimit = opts.bodyLimit ?? MAX_BODY_BYTES;

  const app = new Hono();

  // ------ Security headers (all responses) ------
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self'; object-src 'none'",
    );
  });

  // ------ Body size guard ------
  app.use('*', async (c, next) => {
    const cl = c.req.header('content-length');
    if (cl !== undefined) {
      const len = parseInt(cl, 10);
      if (!Number.isNaN(len) && len > bodyLimit) {
        return c.json({ error: 'Request body too large' }, 413);
      }
    }
    await next();
  });

  // ------ Central error handler ------
  app.onError((err, c) => {
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof ContentTooLargeError) return c.json({ error: err.message }, 413);
    if (err instanceof VersionConflictError) return c.json({ error: err.message }, 409);
    // Auth errors from identity providers
    if (
      err instanceof Error &&
      (err.message.includes('Missing or empty identity header') ||
        err.message.includes('Missing or invalid Authorization') ||
        err.message.includes('Invalid token'))
    ) {
      return c.json({ error: err.message }, 401);
    }
    // Unknown errors — never leak stack traces
    console.error('[server] Unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  // ------ Helper: resolve caller identity ------
  async function resolveUser(c: { req: { raw: Request } }): Promise<string> {
    const raw = c.req.raw.headers;
    const headers: Record<string, string | undefined> = {};
    raw.forEach((v, k) => {
      headers[k] = v;
    });
    const id = await identity.identify(headers);
    return id.user;
  }

  // ------ Helper: parse JSON body with size check ------
  async function parseBody<T>(
    c: { req: { text: () => Promise<string> } },
    schema: { parse: (v: unknown) => T },
  ): Promise<T> {
    const text = await c.req.text();
    if (Buffer.byteLength(text, 'utf8') > bodyLimit) {
      throw new ContentTooLargeError('Request body too large');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ValidationError('Invalid JSON body');
    }
    try {
      return schema.parse(parsed);
    } catch {
      throw new ValidationError('Invalid request body');
    }
  }

  // ====================================================================
  // GET /healthz
  // ====================================================================
  // Reports the runtime mode and the store's own liveness. Kept cheap: the
  // provider's healthCheck is optional, and a provider that throws is reported
  // as unhealthy rather than propagating a 500.
  app.get('/healthz', async (c) => {
    const caps = opts.provider.capabilities;
    const base = {
      status: 'ok',
      mode: opts.mode ?? 'offline',
      provider: {
        name: opts.providerName ?? 'unknown',
        search: caps.search,
        nativeTtl: caps.nativeTtl,
        requiresNetwork: caps.requiresNetwork,
      },
    };

    if (opts.provider.healthCheck === undefined) {
      return c.json(base);
    }

    try {
      const health = await opts.provider.healthCheck();
      if (health.healthy) {
        return c.json({ ...base, store: health });
      }
      return c.json({ ...base, status: 'degraded', store: health }, 503);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return c.json({ ...base, status: 'degraded', store: { healthy: false, detail } }, 503);
    }
  });

  // ====================================================================
  // GET /api/whoami
  // ====================================================================
  app.get('/api/whoami', async (c) => {
    const user = await resolveUser(c);
    return c.json({ user });
  });

  // ====================================================================
  // POST /api/scan
  // ====================================================================
  app.post('/api/scan', async (c) => {
    const body = await parseBody(c, ScanSchema);
    const findings = scan(body.content);
    return c.json({ findings });
  });

  // ====================================================================
  // POST /api/documents — Create
  // ====================================================================
  app.post('/api/documents', async (c) => {
    const user = await resolveUser(c);
    const body = await parseBody(c, CreateDocumentSchema);

    const visibility: Visibility = body.visibility ?? DEFAULT_VISIBILITY;
    const language: Language = body.language as Language;
    validateLanguage(language);
    validateTitleSize(body.title);
    validateContentSize(body.content);

    let content = body.content;

    // Credential-scan flow: if no redactionPolicy, scan first
    if (body.redactionPolicy === undefined) {
      const findings = scan(content);
      if (findings.length > 0) {
        const types = [...new Set(findings.map((f) => f.type))];
        return c.json({ detected: types, options: ['redact', 'skip'] }, 409);
      }
    } else if (body.redactionPolicy === 'redact') {
      const findings = scan(content);
      if (findings.length > 0) {
        content = redact(content, findings);
      }
    }
    // 'skip' — store as-is

    const createInput: {
      title: string;
      language: Language;
      visibility: Visibility;
      content: string;
      createdBy: string;
      expiresAt?: string;
    } = {
      title: body.title,
      language,
      visibility,
      content,
      createdBy: user,
    };
    const ea = expiresAtFromDays(body.expiresInDays);
    if (ea !== undefined) createInput.expiresAt = ea;

    const doc = await provider.repository.create(createInput);

    // Index for search
    provider.search.update({
      documentId: doc.id,
      owner: user,
      visibility: doc.visibility,
      title: doc.title,
      content,
    });

    return c.json(doc, 201);
  });

  // ====================================================================
  // GET /api/documents — List own / search
  // ====================================================================
  app.get('/api/documents', async (c) => {
    const user = await resolveUser(c);
    const query = c.req.query('query');
    const cursor = c.req.query('cursor');
    const limitStr = c.req.query('limit');
    const limit = limitStr !== undefined ? parseInt(limitStr, 10) : undefined;

    if (query !== undefined && query.trim().length > 0) {
      // Search: own + PUBLIC
      const results = provider.search.query(query, user, { limit: limit ?? 50 });
      // Fetch full doc metadata for each hit
      const documents: Document[] = [];
      for (const hit of results.hits) {
        const doc = await provider.repository.get(hit.documentId);
        if (doc !== null) documents.push(doc);
      }
      return c.json({ items: documents, total: results.total });
    }

    // List own documents
    const listQuery: { limit?: number; cursor?: string } = {
      limit: limit ?? 50,
    };
    if (cursor !== undefined) listQuery.cursor = cursor;
    const page = await provider.repository.listByOwner(user, listQuery);
    return c.json(page);
  });

  // ====================================================================
  // GET /api/documents/:id
  // ====================================================================
  app.get('/api/documents/:id', async (c) => {
    const user = await resolveUser(c);
    const id = c.req.param('id');
    validateId(id);

    const doc = await provider.repository.get(id);
    if (doc === null) throw new NotFoundError('Document not found');
    assertCanRead(doc, user);

    const versionParam = c.req.query('version');
    if (versionParam !== undefined) {
      const v = parseInt(versionParam, 10);
      if (Number.isNaN(v) || v < 1) throw new ValidationError('Invalid version number');
      const version = await provider.repository.getVersion(id, v);
      if (version === null) throw new NotFoundError('Version not found');
      return c.json({ ...doc, content: version.content, version: version.version });
    }

    // Return latest version content
    const latest = await provider.repository.getVersion(id, doc.latestVersion);
    return c.json({ ...doc, content: latest?.content ?? '' });
  });

  // ====================================================================
  // PUT /api/documents/:id — Update
  // ====================================================================
  app.put('/api/documents/:id', async (c) => {
    const user = await resolveUser(c);
    const id = c.req.param('id');
    validateId(id);

    const doc = await provider.repository.get(id);
    if (doc === null) throw new NotFoundError('Document not found');
    assertCanWrite(doc, user);

    const body = await parseBody(c, UpdateDocumentSchema);
    let updated = doc;

    // Meta updates (title, language, expiresInDays)
    const metaChanges: { title?: string; language?: Language; expiresAt?: string | null } = {};
    let hasMetaChanges = false;
    if (body.title !== undefined) {
      validateTitleSize(body.title);
      metaChanges.title = body.title;
      hasMetaChanges = true;
    }
    if (body.language !== undefined) {
      validateLanguage(body.language);
      metaChanges.language = body.language as Language;
      hasMetaChanges = true;
    }
    if (body.expiresInDays !== undefined) {
      if (body.expiresInDays === null) {
        metaChanges.expiresAt = null;
      } else {
        metaChanges.expiresAt = expiresAtFromDays(body.expiresInDays)!;
      }
      hasMetaChanges = true;
    }

    if (hasMetaChanges) {
      updated = await provider.repository.updateMeta(id, metaChanges);
    }

    // Visibility change
    if (body.visibility !== undefined) {
      updated = await provider.repository.setVisibility(id, body.visibility);
    }

    // Content update — append a new version
    if (body.content !== undefined) {
      validateContentSize(body.content);
      let content = body.content;

      // Credential-scan flow
      if (body.redactionPolicy === undefined) {
        const findings = scan(content);
        if (findings.length > 0) {
          const types = [...new Set(findings.map((f) => f.type))];
          return c.json({ detected: types, options: ['redact', 'skip'] }, 409);
        }
      } else if (body.redactionPolicy === 'redact') {
        const findings = scan(content);
        if (findings.length > 0) {
          content = redact(content, findings);
        }
      }

      updated = await provider.repository.appendVersion(id, {
        content,
        editedBy: user,
        expect: { latestVersion: updated.latestVersion },
      });

      // Update search index
      provider.search.update({
        documentId: id,
        owner: updated.createdBy,
        visibility: updated.visibility,
        title: updated.title,
        content,
      });
    }

    return c.json(updated);
  });

  // ====================================================================
  // DELETE /api/documents/:id
  // ====================================================================
  app.delete('/api/documents/:id', async (c) => {
    const user = await resolveUser(c);
    const id = c.req.param('id');
    validateId(id);

    const doc = await provider.repository.get(id);
    if (doc === null) throw new NotFoundError('Document not found');
    assertCanDelete(doc, user);

    await provider.repository.delete(id);
    provider.search.remove(id);
    return c.json({ deleted: true });
  });

  // ====================================================================
  // GET /api/documents/:id/versions
  // ====================================================================
  app.get('/api/documents/:id/versions', async (c) => {
    const user = await resolveUser(c);
    const id = c.req.param('id');
    validateId(id);

    const doc = await provider.repository.get(id);
    if (doc === null) throw new NotFoundError('Document not found');
    assertCanRead(doc, user);

    const versions = await provider.repository.listVersions(id);
    return c.json({ versions });
  });

  // ====================================================================
  // GET /api/documents/:id/diff?from=N&to=M
  // ====================================================================
  app.get('/api/documents/:id/diff', async (c) => {
    const user = await resolveUser(c);
    const id = c.req.param('id');
    validateId(id);

    const doc = await provider.repository.get(id);
    if (doc === null) throw new NotFoundError('Document not found');
    assertCanRead(doc, user);

    const fromStr = c.req.query('from');
    const toStr = c.req.query('to');
    if (fromStr === undefined || toStr === undefined) {
      throw new ValidationError("'from' and 'to' query parameters are required");
    }
    const from = parseInt(fromStr, 10);
    const to = parseInt(toStr, 10);
    if (Number.isNaN(from) || Number.isNaN(to) || from < 1 || to < 1) {
      throw new ValidationError('Invalid version numbers');
    }

    const [vFrom, vTo] = await Promise.all([
      provider.repository.getVersion(id, from),
      provider.repository.getVersion(id, to),
    ]);
    if (vFrom === null) throw new NotFoundError(`Version ${from} not found`);
    if (vTo === null) throw new NotFoundError(`Version ${to} not found`);

    const diff = unifiedDiff(vFrom.content, vTo.content, {
      oldLabel: `v${from}`,
      newLabel: `v${to}`,
    });
    return c.json({ diff });
  });

  // ====================================================================
  // GET /raw/:id[?version=N]
  // ====================================================================
  app.get('/raw/:id', async (c) => {
    const user = await resolveUser(c);
    const id = c.req.param('id');
    validateId(id);

    const doc = await provider.repository.get(id);
    if (doc === null) throw new NotFoundError('Document not found');
    assertCanReadRaw(doc, user);

    const versionParam = c.req.query('version');
    let version = doc.latestVersion;
    if (versionParam !== undefined) {
      const v = parseInt(versionParam, 10);
      if (Number.isNaN(v) || v < 1) throw new ValidationError('Invalid version number');
      version = v;
    }

    const versionData = await provider.repository.getVersion(id, version);
    if (versionData === null) throw new NotFoundError('Version not found');

    return c.text(versionData.content);
  });

  // ====================================================================
  // POST /api/documents/:id/comments
  // ====================================================================
  app.post('/api/documents/:id/comments', async (c) => {
    const user = await resolveUser(c);
    const id = c.req.param('id');
    validateId(id);

    const doc = await provider.repository.get(id);
    if (doc === null) throw new NotFoundError('Document not found');
    assertCanComment(doc, user);

    const body = await parseBody(c, CreateCommentSchema);
    validateCommentSize(body.body);

    const comment = await provider.comments.add(id, { author: user, body: body.body });
    return c.json(comment, 201);
  });

  // ====================================================================
  // GET /api/documents/:id/comments
  // ====================================================================
  app.get('/api/documents/:id/comments', async (c) => {
    const user = await resolveUser(c);
    const id = c.req.param('id');
    validateId(id);

    const doc = await provider.repository.get(id);
    if (doc === null) throw new NotFoundError('Document not found');
    assertCanComment(doc, user);

    const comments = await provider.comments.list(id);
    return c.json({ comments });
  });

  // ====================================================================
  // PATCH /api/documents/:id/comments/:cid
  // ====================================================================
  app.patch('/api/documents/:id/comments/:cid', async (c) => {
    const user = await resolveUser(c);
    const id = c.req.param('id');
    validateId(id);

    const doc = await provider.repository.get(id);
    if (doc === null) throw new NotFoundError('Document not found');
    assertCanComment(doc, user);

    const cid = c.req.param('cid');
    const body = await parseBody(c, PatchCommentSchema);
    const comment = await provider.comments.setResolved(id, cid, body.resolved);
    return c.json(comment);
  });

  // ====================================================================
  // DELETE /api/documents/:id/comments/:cid
  // ====================================================================
  app.delete('/api/documents/:id/comments/:cid', async (c) => {
    const user = await resolveUser(c);
    const id = c.req.param('id');
    validateId(id);

    const doc = await provider.repository.get(id);
    if (doc === null) throw new NotFoundError('Document not found');
    assertCanComment(doc, user);

    const cid = c.req.param('cid');
    await provider.comments.delete(id, cid);
    return c.json({ deleted: true });
  });

  // ====================================================================
  // POST /api/documents/:id/visibility
  // ====================================================================
  app.post('/api/documents/:id/visibility', async (c) => {
    const user = await resolveUser(c);
    const id = c.req.param('id');
    validateId(id);

    const doc = await provider.repository.get(id);
    if (doc === null) throw new NotFoundError('Document not found');
    assertCanWrite(doc, user);

    const body = await parseBody(c, SetVisibilitySchema);
    const updated = await provider.repository.setVisibility(id, body.visibility);

    // Update search index
    const latest = await provider.repository.getVersion(id, updated.latestVersion);
    provider.search.update({
      documentId: id,
      owner: updated.createdBy,
      visibility: updated.visibility,
      title: updated.title,
      content: latest?.content ?? '',
    });

    return c.json(updated);
  });

  return app;
}

// ---------------------------------------------------------------------------
// startServer
// ---------------------------------------------------------------------------

/**
 * Create the Hono app, bind to a port, and optionally start the expiry sweep.
 */
export function startServer(opts: StartServerOptions): ServerHandle {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 3000;
  const app = createServer(opts);

  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.warn(
      `⚠️  Security warning: server is binding to '${host}'. ` +
        'Ensure this host is not publicly accessible.',
    );
  }

  if (opts.auth?.mode === 'trusted-header') {
    console.warn(
      `⚠️  Trusted-header auth: the reverse proxy MUST strip the ` +
        `'${opts.auth.header}' header from client traffic to prevent impersonation.`,
    );
  }

  const httpServer = serve({ fetch: app.fetch, port, hostname: host }, (info: AddressInfo) => {
    console.log(`AgentDocStore server listening on http://${info.address}:${info.port}`);
  }) as unknown as Server;

  // Expiry sweep: when the provider lacks native TTL, periodically delete
  // expired documents. The timer is stoppable so tests don't hang.
  let sweepTimer: ReturnType<typeof setInterval> | undefined;
  if (!opts.provider.capabilities.nativeTtl) {
    const SWEEP_INTERVAL_MS = 60_000; // 1 minute
    // The callback is synchronous on purpose: `setInterval` discards a returned
    // promise, so an async callback that rejected would surface as an unhandled
    // rejection on a background timer. `sweepOnce` swallows its own failures
    // (a sweep is best-effort) and the `void` marks the discard as deliberate.
    const sweepOnce = async (): Promise<void> => {
      try {
        const expired = await opts.provider.repository.listExpired(new Date().toISOString(), 100);
        for (const id of expired) {
          try {
            await opts.provider.repository.delete(id);
            opts.provider.search.remove(id);
          } catch {
            // Document may have been deleted concurrently — safe to ignore.
          }
        }
      } catch {
        // Sweep errors are non-fatal.
      }
    };
    sweepTimer = setInterval(() => void sweepOnce(), SWEEP_INTERVAL_MS);
    // Unref so the timer doesn't keep the process alive on its own.
    if (typeof sweepTimer === 'object' && 'unref' in sweepTimer) {
      sweepTimer.unref();
    }
  }

  return {
    server: httpServer,
    app,
    async close() {
      if (sweepTimer !== undefined) clearInterval(sweepTimer);
      httpServer.close();
      await opts.provider.close();
    },
  };
}
