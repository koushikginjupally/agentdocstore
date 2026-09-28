/**
 * Integration tests for @agentdocstore/server.
 *
 * Uses vitest and drives the real Hono app over its `.request()` interface
 * (no actual port binding) backed by `createMemoryProvider()`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryProvider } from '@agentdocstore/provider-memory';
import type { Provider } from '@agentdocstore/core';
import { LIMITS, VersionConflictError } from '@agentdocstore/core';
import { createServer } from './server.js';
import type { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let provider: Provider;
let app: Hono;

/** Build request helper with default single-user auth for "alice". */
function buildApp(authMode?: Parameters<typeof createServer>[0]['auth']): Hono {
  provider = createMemoryProvider();
  return createServer({
    provider,
    auth: authMode ?? { mode: 'single-user', user: 'alice' },
  });
}

/** Convenience: JSON POST/PUT/PATCH/DELETE */
async function post(path: string, body: unknown, headers?: Record<string, string>) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
async function put(path: string, body: unknown, headers?: Record<string, string>) {
  return app.request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
async function patch(path: string, body: unknown, headers?: Record<string, string>) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
async function del(path: string, headers?: Record<string, string>) {
  return app.request(path, { method: 'DELETE', headers });
}
async function get(path: string, headers?: Record<string, string>) {
  return app.request(path, { method: 'GET', headers });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('server', () => {
  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    await provider.close();
  });

  // ========================================================================
  // Healthz + Whoami
  // ========================================================================
  describe('GET /healthz', () => {
    it('returns ok', async () => {
      const res = await get('/healthz');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /api/whoami', () => {
    it('returns the current user', async () => {
      const res = await get('/api/whoami');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: string };
      expect(body.user).toBe('alice');
    });
  });

  // ========================================================================
  // Security headers
  // ========================================================================
  describe('security headers', () => {
    it('sets CSP and nosniff on every response', async () => {
      const res = await get('/healthz');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    });
  });

  // ========================================================================
  // Full CRUD round-trip
  // ========================================================================
  describe('create -> read -> update -> versions -> diff -> raw', () => {
    it('round-trip works end-to-end', async () => {
      // Create
      const createRes = await post('/api/documents', {
        title: 'Test Document',
        content: 'Hello World v1',
        language: 'plaintext',
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as {
        id: string;
        title: string;
        latestVersion: number;
      };
      expect(created.title).toBe('Test Document');
      expect(created.latestVersion).toBe(1);
      const id = created.id;

      // Read
      const readRes = await get(`/api/documents/${id}`);
      expect(readRes.status).toBe(200);
      const readBody = (await readRes.json()) as {
        id: string;
        content: string;
        latestVersion: number;
      };
      expect(readBody.content).toBe('Hello World v1');

      // Read specific version
      const v1Res = await get(`/api/documents/${id}?version=1`);
      expect(v1Res.status).toBe(200);
      const v1Body = (await v1Res.json()) as { content: string; version: number };
      expect(v1Body.content).toBe('Hello World v1');
      expect(v1Body.version).toBe(1);

      // Update (append new version + title change)
      const updateRes = await put(`/api/documents/${id}`, {
        content: 'Hello World v2',
        title: 'Updated Document',
      });
      expect(updateRes.status).toBe(200);
      const updated = (await updateRes.json()) as { latestVersion: number; title: string };
      expect(updated.latestVersion).toBe(2);
      expect(updated.title).toBe('Updated Document');

      // Versions list
      const versionsRes = await get(`/api/documents/${id}/versions`);
      expect(versionsRes.status).toBe(200);
      const versionsBody = (await versionsRes.json()) as { versions: unknown[] };
      expect(versionsBody.versions).toHaveLength(2);

      // Diff
      const diffRes = await get(`/api/documents/${id}/diff?from=1&to=2`);
      expect(diffRes.status).toBe(200);
      const diffBody = (await diffRes.json()) as { diff: string };
      expect(diffBody.diff).toContain('-Hello World v1');
      expect(diffBody.diff).toContain('+Hello World v2');

      // Raw
      const rawRes = await get(`/raw/${id}`);
      expect(rawRes.status).toBe(200);
      const rawText = await rawRes.text();
      expect(rawText).toBe('Hello World v2');

      // Raw specific version
      const rawV1Res = await get(`/raw/${id}?version=1`);
      expect(rawV1Res.status).toBe(200);
      expect(await rawV1Res.text()).toBe('Hello World v1');
    });
  });

  // ========================================================================
  // Credential scan flow (409 -> redact)
  // ========================================================================
  describe('credential scan flow', () => {
    const secretContent = 'my password=SuperSecret123!Abc';

    it('returns 409 with detected types when credentials found (no policy)', async () => {
      const res = await post('/api/documents', {
        title: 'Secret Document',
        content: secretContent,
        language: 'plaintext',
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { detected: string[]; options: string[] };
      expect(body.detected).toContain('generic-secret');
      expect(body.options).toEqual(['redact', 'skip']);
    });

    it('redacts content when redactionPolicy is "redact"', async () => {
      const res = await post('/api/documents', {
        title: 'Redacted Document',
        content: secretContent,
        language: 'plaintext',
        redactionPolicy: 'redact',
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: string };

      // Verify content is redacted
      const readRes = await get(`/api/documents/${created.id}`);
      const readBody = (await readRes.json()) as { content: string };
      expect(readBody.content).toContain('[REDACTED:');
      expect(readBody.content).not.toContain('SuperSecret123');
    });

    it('stores as-is when redactionPolicy is "skip"', async () => {
      const res = await post('/api/documents', {
        title: 'Skipped Document',
        content: secretContent,
        language: 'plaintext',
        redactionPolicy: 'skip',
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: string };

      const readRes = await get(`/api/documents/${created.id}`);
      const readBody = (await readRes.json()) as { content: string };
      expect(readBody.content).toContain('SuperSecret123');
    });

    it('returns 409 on update when credentials found (no policy)', async () => {
      // First create a clean doc
      const createRes = await post('/api/documents', {
        title: 'Clean',
        content: 'clean content',
        language: 'plaintext',
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { id: string };

      // Update with secret content without policy
      const updateRes = await put(`/api/documents/${created.id}`, {
        content: secretContent,
      });
      expect(updateRes.status).toBe(409);
      const body = (await updateRes.json()) as { detected: string[] };
      expect(body.detected).toContain('generic-secret');
    });

    it('applies no part of an update rejected for credentials', async () => {
      const createRes = await post('/api/documents', {
        title: 'Original',
        content: 'clean content',
        language: 'plaintext',
        visibility: 'PRIVATE',
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { id: string };

      const updateRes = await put(`/api/documents/${created.id}`, {
        title: 'Renamed',
        language: 'markdown',
        visibility: 'PUBLIC',
        expiresInDays: 7,
        content: secretContent,
      });
      expect(updateRes.status).toBe(409);

      const readRes = await get(`/api/documents/${created.id}`);
      const doc = (await readRes.json()) as {
        title: string;
        language: string;
        visibility: string;
        latestVersion: number;
        expiresAt?: string;
        content: string;
      };
      expect(doc.title).toBe('Original');
      expect(doc.language).toBe('plaintext');
      expect(doc.visibility).toBe('PRIVATE');
      expect(doc.expiresAt).toBeUndefined();
      expect(doc.latestVersion).toBe(1);
      expect(doc.content).toBe('clean content');
    });
  });

  // ========================================================================
  // POST /api/scan
  // ========================================================================
  describe('POST /api/scan', () => {
    it('scans content without persisting', async () => {
      const res = await post('/api/scan', { content: 'password=hunter2' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { findings: Array<{ type: string }> };
      expect(body.findings.length).toBeGreaterThan(0);
      expect(body.findings[0]!.type).toBe('generic-secret');
    });

    it('returns empty findings for clean content', async () => {
      const res = await post('/api/scan', { content: 'just some text' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { findings: unknown[] };
      expect(body.findings).toHaveLength(0);
    });
  });

  // ========================================================================
  // Content too large -> 413
  // ========================================================================
  describe('oversized content -> 413', () => {
    it('rejects content exceeding MAX_CONTENT_BYTES', async () => {
      const bigContent = 'x'.repeat(LIMITS.MAX_CONTENT_BYTES + 1);
      const res = await post('/api/documents', {
        title: 'Big Document',
        content: bigContent,
        language: 'plaintext',
        redactionPolicy: 'skip',
      });
      expect(res.status).toBe(413);
    });

    it('applies no part of an update rejected as oversized', async () => {
      const createRes = await post('/api/documents', {
        title: 'Original',
        content: 'small',
        language: 'plaintext',
      });
      const created = (await createRes.json()) as { id: string };

      const res = await put(`/api/documents/${created.id}`, {
        title: 'Renamed',
        content: 'x'.repeat(LIMITS.MAX_CONTENT_BYTES + 1),
        redactionPolicy: 'skip',
      });
      expect(res.status).toBe(413);

      const doc = (await (await get(`/api/documents/${created.id}`)).json()) as {
        title: string;
        latestVersion: number;
      };
      expect(doc.title).toBe('Original');
      expect(doc.latestVersion).toBe(1);
    });
  });

  // ========================================================================
  // Size errors say how much is too much
  // ========================================================================
  describe('size errors name the limit', () => {
    it('for content', async () => {
      const res = await post('/api/documents', {
        title: 'Big Document',
        content: 'x'.repeat(LIMITS.MAX_CONTENT_BYTES + 1),
        language: 'plaintext',
        redactionPolicy: 'skip',
      });
      expect(res.status).toBe(413);
      expect(((await res.json()) as { error: string }).error).toBe(
        `Content exceeds size cap (${LIMITS.MAX_CONTENT_BYTES + 1} bytes; the limit is ${LIMITS.MAX_CONTENT_BYTES} bytes)`,
      );
    });

    it('for a comment', async () => {
      const created = (await (
        await post('/api/documents', { title: 'Doc', content: 'a', language: 'plaintext' })
      ).json()) as { id: string };
      const res = await post(`/api/documents/${created.id}/comments`, {
        body: 'x'.repeat(LIMITS.MAX_COMMENT_BYTES + 1),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(
        `Comment exceeds maximum length (${LIMITS.MAX_COMMENT_BYTES + 1} bytes; the limit is ${LIMITS.MAX_COMMENT_BYTES} bytes)`,
      );
    });

    it('for a title', async () => {
      const res = await post('/api/documents', {
        title: 'x'.repeat(LIMITS.MAX_TITLE_BYTES + 1),
        content: 'a',
        language: 'plaintext',
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe(
        `Title exceeds maximum length (${LIMITS.MAX_TITLE_BYTES + 1} bytes; the limit is ${LIMITS.MAX_TITLE_BYTES} bytes)`,
      );
    });
  });

  // ========================================================================
  // Validation errors -> 400
  // ========================================================================
  describe('validation errors -> 400', () => {
    it('rejects empty title', async () => {
      const res = await post('/api/documents', {
        title: '',
        content: 'body',
        language: 'plaintext',
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid JSON', async () => {
      const res = await app.request('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not valid json',
      });
      expect(res.status).toBe(400);
    });

    it('names the field and its allowed values', async () => {
      const created = (await (
        await post('/api/documents', { title: 'T', content: 'v1' })
      ).json()) as {
        id: string;
      };
      const res = await put(`/api/documents/${created.id}`, { visibility: 'public' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Invalid request body: visibility: must be one of PUBLIC, PRIVATE',
      });
    });

    it('names the field for a wrong type or out-of-range value', async () => {
      const res = await post('/api/documents', { title: 7, content: 'x' });
      expect(await res.json()).toEqual({
        error: 'Invalid request body: title: Expected string, received number',
      });
      const created = (await (
        await post('/api/documents', { title: 'T', content: 'v1' })
      ).json()) as {
        id: string;
      };
      const res2 = await put(`/api/documents/${created.id}`, { expiresInDays: -1 });
      expect(await res2.json()).toEqual({
        error: 'Invalid request body: expiresInDays: Number must be greater than 0',
      });
    });

    it('does not repeat the rejected value back', async () => {
      const res = await post('/api/documents', { content: 'x', visibility: 'hunter2-SECRET' });
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).not.toContain('hunter2');
    });

    it('explains a body that is not a JSON object', async () => {
      const res = await post('/api/documents', ['not', 'an', 'object']);
      expect(await res.json()).toEqual({
        error: 'Invalid request body: Expected object, received array',
      });
    });

    it('saves no part of an update whose title is blank', async () => {
      const created = (await (
        await post('/api/documents', { title: 'T', content: 'v1' })
      ).json()) as {
        id: string;
      };
      const res = await put(`/api/documents/${created.id}`, { title: '   ', content: 'v2' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Title must not be empty' });
      const doc = (await (await get(`/api/documents/${created.id}`)).json()) as {
        title: string;
        latestVersion: number;
        content: string;
      };
      expect(doc).toMatchObject({ title: 'T', latestVersion: 1, content: 'v1' });
    });
  });

  // ========================================================================
  // Error mapping: NotFoundError -> 404
  // ========================================================================
  describe('not-found -> 404', () => {
    it('returns 404 for non-existent doc', async () => {
      const res = await get('/api/documents/AAAAAAAAAA');
      expect(res.status).toBe(404);
    });

    it('returns 404 for malformed id', async () => {
      const res = await get('/api/documents/../etc/passwd');
      expect(res.status).toBe(404);
    });
  });

  // ========================================================================
  // PRIVATE doc isolation
  // ========================================================================
  describe('PRIVATE visibility isolation', () => {
    let privateDocumentId: string;

    beforeEach(async () => {
      // Alice creates a PRIVATE doc
      const res = await post('/api/documents', {
        title: 'Private Document',
        content: 'secret stuff',
        language: 'plaintext',
        visibility: 'PRIVATE',
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      privateDocumentId = body.id;
    });

    it('owner can read their own PRIVATE doc', async () => {
      const res = await get(`/api/documents/${privateDocumentId}`);
      expect(res.status).toBe(200);
    });

    it('other user gets 404 on read', async () => {
      // Build a separate app with bob as user using trusted-header auth
      const bobApp = createServer({
        provider,
        auth: { mode: 'trusted-header', header: 'x-user' },
      });
      const res = await bobApp.request(`/api/documents/${privateDocumentId}`, {
        headers: { 'x-user': 'bob' },
      });
      expect(res.status).toBe(404);
    });

    it('other user gets 404 on raw', async () => {
      const bobApp = createServer({
        provider,
        auth: { mode: 'trusted-header', header: 'x-user' },
      });
      const res = await bobApp.request(`/raw/${privateDocumentId}`, {
        headers: { 'x-user': 'bob' },
      });
      expect(res.status).toBe(404);
    });

    it('other user gets 404 on comments (read)', async () => {
      const bobApp = createServer({
        provider,
        auth: { mode: 'trusted-header', header: 'x-user' },
      });
      const res = await bobApp.request(`/api/documents/${privateDocumentId}/comments`, {
        headers: { 'x-user': 'bob' },
      });
      expect(res.status).toBe(404);
    });

    it('other user gets 404 on comments (post)', async () => {
      const bobApp = createServer({
        provider,
        auth: { mode: 'trusted-header', header: 'x-user' },
      });
      const res = await bobApp.request(`/api/documents/${privateDocumentId}/comments`, {
        method: 'POST',
        headers: { 'x-user': 'bob', 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'hey' }),
      });
      expect(res.status).toBe(404);
    });

    it('PRIVATE doc does not appear in other user list', async () => {
      const bobApp = createServer({
        provider,
        auth: { mode: 'trusted-header', header: 'x-user' },
      });
      const res = await bobApp.request('/api/documents', {
        headers: { 'x-user': 'bob' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }> };
      const ids = body.items.map((b) => b.id);
      expect(ids).not.toContain(privateDocumentId);
    });

    it('PRIVATE doc does not appear in other user search', async () => {
      const bobApp = createServer({
        provider,
        auth: { mode: 'trusted-header', header: 'x-user' },
      });
      const res = await bobApp.request('/api/documents?query=Private', {
        headers: { 'x-user': 'bob' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }> };
      const ids = body.items.map((b) => b.id);
      expect(ids).not.toContain(privateDocumentId);
    });
  });

  // ========================================================================
  // Comments CRUD
  // ========================================================================
  describe('comments', () => {
    let documentId: string;

    beforeEach(async () => {
      const res = await post('/api/documents', {
        title: 'Commentable',
        content: 'body',
        language: 'plaintext',
      });
      const body = (await res.json()) as { id: string };
      documentId = body.id;
    });

    it('add, list, resolve, delete', async () => {
      // Add
      const addRes = await post(`/api/documents/${documentId}/comments`, { body: 'Nice!' });
      expect(addRes.status).toBe(201);
      const comment = (await addRes.json()) as { id: string; body: string; resolved: boolean };
      expect(comment.body).toBe('Nice!');
      expect(comment.resolved).toBe(false);

      // List
      const listRes = await get(`/api/documents/${documentId}/comments`);
      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as { comments: Array<{ id: string }> };
      expect(listBody.comments).toHaveLength(1);

      // Resolve
      const resolveRes = await patch(`/api/documents/${documentId}/comments/${comment.id}`, {
        resolved: true,
      });
      expect(resolveRes.status).toBe(200);
      const resolved = (await resolveRes.json()) as { resolved: boolean };
      expect(resolved.resolved).toBe(true);

      // Delete
      const delRes = await del(`/api/documents/${documentId}/comments/${comment.id}`);
      expect(delRes.status).toBe(200);

      // Verify empty
      const listRes2 = await get(`/api/documents/${documentId}/comments`);
      const listBody2 = (await listRes2.json()) as { comments: unknown[] };
      expect(listBody2.comments).toHaveLength(0);
    });
  });

  // ========================================================================
  // DELETE /api/documents/:id
  // ========================================================================
  describe('DELETE /api/documents/:id', () => {
    it('deletes a doc and returns 404 on re-read', async () => {
      const res = await post('/api/documents', {
        title: 'To Delete',
        content: 'bye',
        language: 'plaintext',
      });
      const created = (await res.json()) as { id: string };

      const delRes = await del(`/api/documents/${created.id}`);
      expect(delRes.status).toBe(200);

      const readRes = await get(`/api/documents/${created.id}`);
      expect(readRes.status).toBe(404);
    });

    it('non-owner cannot delete', async () => {
      // Alice creates
      const res = await post('/api/documents', {
        title: 'Alice Only',
        content: 'mine',
        language: 'plaintext',
      });
      const created = (await res.json()) as { id: string };

      // Bob tries to delete
      const bobApp = createServer({
        provider,
        auth: { mode: 'trusted-header', header: 'x-user' },
      });
      const delRes = await bobApp.request(`/api/documents/${created.id}`, {
        method: 'DELETE',
        headers: { 'x-user': 'bob' },
      });
      // PUBLIC doc: non-owner gets NotFoundError (authz denies as 404)
      expect(delRes.status).toBe(404);
    });
  });

  describe('DELETE /api/documents/:id/comments/:cid — who may delete', () => {
    it('lets the comment author and the document owner delete, nobody else', async () => {
      const multi = createServer({ provider, auth: { mode: 'trusted-header', header: 'x-user' } });
      const as = (user: string, path: string, init: RequestInit = {}) =>
        multi.request(path, {
          ...init,
          headers: { 'content-type': 'application/json', 'x-user': user },
        });
      const doc = (await (
        await as('alice', '/api/documents', {
          method: 'POST',
          body: JSON.stringify({ title: 'Shared', content: 'x' }),
        })
      ).json()) as { id: string };
      const addComment = async (user: string) =>
        (
          (await (
            await as(user, `/api/documents/${doc.id}/comments`, {
              method: 'POST',
              body: JSON.stringify({ body: `from ${user}` }),
            })
          ).json()) as { id: string }
        ).id;

      const bobs = await addComment('bob');
      // A third user cannot delete bob's comment...
      const byCarol = await as('carol', `/api/documents/${doc.id}/comments/${bobs}`, {
        method: 'DELETE',
      });
      expect(byCarol.status).toBe(404);
      const still = (await (await as('alice', `/api/documents/${doc.id}/comments`)).json()) as {
        comments: Array<{ id: string }>;
      };
      expect(still.comments.map((c) => c.id)).toContain(bobs);
      // ...but bob can, and so can the document owner.
      expect(
        (await as('bob', `/api/documents/${doc.id}/comments/${bobs}`, { method: 'DELETE' })).status,
      ).toBe(200);
      const carols = await addComment('carol');
      expect(
        (await as('alice', `/api/documents/${doc.id}/comments/${carols}`, { method: 'DELETE' }))
          .status,
      ).toBe(200);
    });
  });

  // ========================================================================
  // POST /api/documents/:id/visibility
  // ========================================================================
  describe('POST /api/documents/:id/visibility', () => {
    it('changes visibility', async () => {
      const res = await post('/api/documents', {
        title: 'Vis Test',
        content: 'body',
        language: 'plaintext',
      });
      const created = (await res.json()) as { id: string; visibility: string };
      expect(created.visibility).toBe('PUBLIC');

      const visRes = await post(`/api/documents/${created.id}/visibility`, {
        visibility: 'PRIVATE',
      });
      expect(visRes.status).toBe(200);
      const updated = (await visRes.json()) as { visibility: string };
      expect(updated.visibility).toBe('PRIVATE');
    });
  });

  // ========================================================================
  // GET /api/documents list + search
  // ========================================================================
  describe('GET /api/documents (list + search)', () => {
    it('lists own documents', async () => {
      await post('/api/documents', { title: 'Document A', content: 'a', language: 'plaintext' });
      await post('/api/documents', { title: 'Document B', content: 'b', language: 'plaintext' });

      const res = await get('/api/documents');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(body.items).toHaveLength(2);
    });

    it('search returns PUBLIC documents by query', async () => {
      await post('/api/documents', {
        title: 'Unique Findable Title',
        content: 'irrelevant',
        language: 'plaintext',
      });

      const res = await get('/api/documents?query=Unique+Findable');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ title: string }> };
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0]!.title).toBe('Unique Findable Title');
    });

    it.each(['abc', '-1', '0', '1.5', '101', ''])(
      'rejects limit=%j with 400 for list and search',
      async (limit) => {
        await post('/api/documents', { title: 'Doc', content: 'hello', language: 'plaintext' });
        const list = await get(`/api/documents?limit=${limit}`);
        expect(list.status).toBe(400);
        const search = await get(`/api/documents?query=hello&limit=${limit}`);
        expect(search.status).toBe(400);
      },
    );

    it('honours a valid limit and pages with nextCursor', async () => {
      for (const t of ['A', 'B', 'C']) {
        await post('/api/documents', { title: t, content: t, language: 'plaintext' });
      }
      const first = (await (await get('/api/documents?limit=2')).json()) as {
        items: Array<{ id: string }>;
        nextCursor?: string;
      };
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBeDefined();
      const rest = (await (
        await get(`/api/documents?limit=100&cursor=${first.nextCursor}`)
      ).json()) as { items: unknown[]; nextCursor?: string };
      expect(rest.items).toHaveLength(1);
      expect(rest.nextCursor).toBeUndefined();
    });

    it('pages search results with nextCursor until every match is seen', async () => {
      for (const t of ['A', 'B', 'C', 'D', 'E']) {
        await post('/api/documents', { title: t, content: 'zebra', language: 'plaintext' });
      }
      const seen: string[] = [];
      const pageSizes: number[] = [];
      let cursor: string | undefined;
      do {
        const res = await get(
          `/api/documents?query=zebra&limit=2${cursor === undefined ? '' : `&cursor=${cursor}`}`,
        );
        expect(res.status).toBe(200);
        const page = (await res.json()) as {
          items: Array<{ id: string }>;
          total: number;
          nextCursor?: string;
        };
        expect(page.total).toBe(5);
        pageSizes.push(page.items.length);
        seen.push(...page.items.map((d) => d.id));
        cursor = page.nextCursor;
      } while (cursor !== undefined && pageSizes.length < 10);
      expect(pageSizes).toEqual([2, 2, 1]);
      expect(new Set(seen).size).toBe(5);
    });

    it('returns an empty last page for a search cursor past the last match', async () => {
      await post('/api/documents', { title: 'Doc', content: 'zebra', language: 'plaintext' });
      const res = await get('/api/documents?query=zebra&cursor=50');
      expect(res.status).toBe(200);
      const page = (await res.json()) as { items: unknown[]; total: number; nextCursor?: string };
      expect(page.items).toEqual([]);
      expect(page.total).toBe(1);
      expect(page.nextCursor).toBeUndefined();
    });

    it.each(['abc', '-1', '1.5', ''])('rejects search cursor=%j with 400', async (cursor) => {
      await post('/api/documents', { title: 'Doc', content: 'zebra', language: 'plaintext' });
      const res = await get(`/api/documents?query=zebra&cursor=${cursor}`);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("'cursor'");
    });
  });

  // ========================================================================
  // Auth modes
  // ========================================================================
  describe('auth modes', () => {
    it('trusted-header identifies by header', async () => {
      const a = createServer({
        provider,
        auth: { mode: 'trusted-header', header: 'x-remote-user' },
      });
      const res = await a.request('/api/whoami', {
        headers: { 'x-remote-user': 'carol' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: string };
      expect(body.user).toBe('carol');
    });

    it('trusted-header returns 401 without the header', async () => {
      const a = createServer({
        provider,
        auth: { mode: 'trusted-header', header: 'x-remote-user' },
      });
      const res = await a.request('/api/whoami');
      expect(res.status).toBe(401);
    });

    it('token auth works with valid token', async () => {
      const a = createServer({
        provider,
        auth: { mode: 'token', tokens: { 'secret-abc': 'dave' } },
      });
      const res = await a.request('/api/whoami', {
        headers: { authorization: 'Bearer secret-abc' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { user: string };
      expect(body.user).toBe('dave');
    });

    it('token auth returns 401 with invalid token', async () => {
      const a = createServer({
        provider,
        auth: { mode: 'token', tokens: { 'secret-abc': 'dave' } },
      });
      const res = await a.request('/api/whoami', {
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(res.status).toBe(401);
    });
  });

  // ========================================================================
  // Diff validation errors
  // ========================================================================
  describe('diff edge cases', () => {
    it('returns 400 when from/to missing', async () => {
      const createRes = await post('/api/documents', {
        title: 'Diff',
        content: 'v1',
        language: 'plaintext',
      });
      const created = (await createRes.json()) as { id: string };

      const res = await get(`/api/documents/${created.id}/diff`);
      expect(res.status).toBe(400);
    });
  });

  // ========================================================================
  // Edit messages are stored with each version
  // ========================================================================
  describe('edit messages', () => {
    it('stores editMessage on the new version and lists it', async () => {
      const created = (await (
        await post('/api/documents', { title: 'Msg', content: 'v1' })
      ).json()) as { id: string };
      expect(
        (await put(`/api/documents/${created.id}`, { content: 'v2', editMessage: '  Fix typo  ' }))
          .status,
      ).toBe(200);
      await put(`/api/documents/${created.id}`, { content: 'v3', editMessage: '   ' });
      const { versions } = (await (await get(`/api/documents/${created.id}/versions`)).json()) as {
        versions: Array<{ version: number; message?: string }>;
      };
      // Trimmed; a blank message is dropped rather than stored.
      expect(versions.map((v) => v.message)).toEqual([undefined, 'Fix typo', undefined]);
    });

    it('rejects an edit message longer than 500 characters', async () => {
      const created = (await (
        await post('/api/documents', { title: 'Msg', content: 'v1' })
      ).json()) as { id: string };
      const res = await put(`/api/documents/${created.id}`, {
        content: 'v2',
        editMessage: 'x'.repeat(501),
      });
      expect(res.status).toBe(400);
      const doc = (await (await get(`/api/documents/${created.id}`)).json()) as {
        latestVersion: number;
      };
      expect(doc.latestVersion).toBe(1);
    });
  });

  // ========================================================================
  // VersionConflictError -> 409
  // ========================================================================
  describe('version conflict -> 409', () => {
    it('returns 409 and applies no part of an update that conflicts', async () => {
      const created = (await (
        await post('/api/documents', {
          title: 'Conflict Test',
          content: 'v1',
          language: 'plaintext',
          visibility: 'PRIVATE',
        })
      ).json()) as { id: string };

      // Another save lands between this request's read and its append.
      vi.spyOn(provider.repository, 'appendVersion').mockRejectedValueOnce(
        new VersionConflictError('Version conflict: expected 1, found 2', 1, 2),
      );
      const res = await put(`/api/documents/${created.id}`, {
        title: 'Renamed',
        language: 'markdown',
        visibility: 'PUBLIC',
        content: 'v2',
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Version conflict: expected 1, found 2' });

      // "Nothing saved" must be true: not renamed, not made PUBLIC.
      const doc = (await (await get(`/api/documents/${created.id}`)).json()) as {
        title: string;
        language: string;
        visibility: string;
        latestVersion: number;
      };
      expect(doc).toMatchObject({
        title: 'Conflict Test',
        language: 'plaintext',
        visibility: 'PRIVATE',
        latestVersion: 1,
      });
    });

    it('refuses a save made from an older version (latestVersion), saving nothing', async () => {
      const created = (await (
        await post('/api/documents', { title: 'Plan', content: 'step 1', language: 'plaintext' })
      ).json()) as { id: string };
      // Someone else saves version 2 after this editor loaded version 1.
      expect(
        (await put(`/api/documents/${created.id}`, { content: 'step 1\nstep 2' })).status,
      ).toBe(200);

      const stale = await put(`/api/documents/${created.id}`, {
        content: 'step 1 (edited)',
        title: 'Renamed',
        latestVersion: 1,
      });
      expect(stale.status).toBe(409);
      expect(((await stale.json()) as { error: string }).error).toMatch(/version 2/);

      const doc = (await (await get(`/api/documents/${created.id}`)).json()) as {
        title: string;
        latestVersion: number;
        content: string;
      };
      expect(doc).toMatchObject({ title: 'Plan', latestVersion: 2, content: 'step 1\nstep 2' });
    });

    it('refuses a metadata-only change made from an older version too', async () => {
      const created = (await (
        await post('/api/documents', { title: 'Plan', content: 'v1', language: 'plaintext' })
      ).json()) as { id: string };
      await put(`/api/documents/${created.id}`, { content: 'v2' });
      const stale = await put(`/api/documents/${created.id}`, {
        visibility: 'PRIVATE',
        latestVersion: 1,
      });
      expect(stale.status).toBe(409);
      const doc = (await (await get(`/api/documents/${created.id}`)).json()) as {
        visibility: string;
      };
      expect(doc.visibility).toBe('PUBLIC');
    });

    it('saves when latestVersion is the current version, and rejects a bad one', async () => {
      const created = (await (
        await post('/api/documents', { title: 'Plan', content: 'v1', language: 'plaintext' })
      ).json()) as { id: string };
      const ok = await put(`/api/documents/${created.id}`, { content: 'v2', latestVersion: 1 });
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { latestVersion: number }).latestVersion).toBe(2);
      const bad = await put(`/api/documents/${created.id}`, { content: 'v3', latestVersion: 0 });
      expect(bad.status).toBe(400);
    });

    it('applies sequential updates without a conflict', async () => {
      const createRes = await post('/api/documents', {
        title: 'Conflict Test',
        content: 'v1',
        language: 'plaintext',
      });
      const created = (await createRes.json()) as { id: string };

      const up1 = await put(`/api/documents/${created.id}`, { content: 'v2' });
      expect(up1.status).toBe(200);
      const up2 = await put(`/api/documents/${created.id}`, { content: 'v3' });
      expect(up2.status).toBe(200);
    });

    it('applies content, metadata and visibility together and returns the result', async () => {
      const created = (await (
        await post('/api/documents', {
          title: 'Combined',
          content: 'v1',
          language: 'plaintext',
          visibility: 'PRIVATE',
        })
      ).json()) as { id: string };

      const res = await put(`/api/documents/${created.id}`, {
        title: 'Renamed',
        language: 'markdown',
        visibility: 'PUBLIC',
        content: 'v2 zebra',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        title: 'Renamed',
        language: 'markdown',
        visibility: 'PUBLIC',
        latestVersion: 2,
      });
      const doc = (await (await get(`/api/documents/${created.id}`)).json()) as {
        content: string;
      };
      expect(doc.content).toBe('v2 zebra');
      const found = (await (await get('/api/documents?query=zebra')).json()) as {
        items: Array<{ title: string; visibility: string }>;
      };
      expect(found.items).toMatchObject([{ title: 'Renamed', visibility: 'PUBLIC' }]);
    });
  });

  // ========================================================================
  // Expiry is enforced at read time, not only by the background sweep
  // ========================================================================
  describe('expired documents', () => {
    async function createExpired(): Promise<string> {
      const res = await post('/api/documents', {
        title: 'Ephemeral zebra',
        content: 'zebra content',
        language: 'plaintext',
      });
      const { id } = (await res.json()) as { id: string };
      // The sweep has not run yet: the record still exists in the store.
      await provider.repository.updateMeta(id, {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      expect(await provider.repository.get(id)).not.toBeNull();
      return id;
    }

    it('are not found on every document route before the sweep runs', async () => {
      const id = await createExpired();
      const responses = await Promise.all([
        get(`/api/documents/${id}`),
        get(`/raw/${id}`),
        get(`/api/documents/${id}/versions`),
        get(`/api/documents/${id}/diff?from=1&to=1`),
        get(`/api/documents/${id}/comments`),
        post(`/api/documents/${id}/comments`, { body: 'late comment' }),
        put(`/api/documents/${id}`, { title: 'revived' }),
        post(`/api/documents/${id}/visibility`, { visibility: 'PRIVATE' }),
      ]);
      expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404]);
    });

    it('are excluded from list and search', async () => {
      const id = await createExpired();
      const list = (await (await get('/api/documents')).json()) as {
        items: Array<{ id: string }>;
      };
      expect(list.items.map((d) => d.id)).not.toContain(id);
      const search = (await (await get('/api/documents?query=zebra')).json()) as {
        items: Array<{ id: string }>;
        total: number;
      };
      expect(search.items.map((d) => d.id)).not.toContain(id);
      expect(search.total).toBe(search.items.length);
    });

    it('can still be deleted by the owner', async () => {
      const id = await createExpired();
      expect((await del(`/api/documents/${id}`)).status).toBe(200);
      expect(await provider.repository.get(id)).toBeNull();
    });

    it('stay readable until the moment they expire', async () => {
      const res = await post('/api/documents', {
        title: 'Still alive',
        content: 'alive',
        language: 'plaintext',
        expiresInDays: 1,
      });
      const { id } = (await res.json()) as { id: string };
      expect((await get(`/api/documents/${id}`)).status).toBe(200);
    });
  });
});
