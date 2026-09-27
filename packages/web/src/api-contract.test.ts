/**
 * Contract test: the real web API client against the real server app.
 *
 * The web client and the REST server are built separately, so a response-shape
 * mismatch between them compiles cleanly on both sides and only fails in the
 * browser. This routes the client's fetch() into the Hono app in-process (no
 * port, no network) so every client method is checked against what the server
 * actually returns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryProvider } from '@agentdocstore/provider-memory';
import { createServer } from '@agentdocstore/server';
import type { Provider } from '@agentdocstore/core';
import { api } from './api.js';

let provider: Provider;

beforeEach(() => {
  provider = createMemoryProvider();
  const app = createServer({ provider, auth: { mode: 'single-user', user: 'alice' } });
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
    app.request(new URL(input, 'http://agentdocstore.test').toString(), init),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await provider.close();
});

async function newDocument(): Promise<string> {
  const doc = await api.createDocument({
    title: 'Contract',
    content: 'v1',
    language: 'plaintext',
    visibility: 'PUBLIC',
  });
  return doc.id;
}

describe('web API client against the real server', () => {
  it('lists comments as an array, empty and after adding one', async () => {
    const id = await newDocument();
    expect(await api.getComments(id)).toEqual([]);

    const added = await api.addComment(id, 'Looks good');
    const comments = await api.getComments(id);
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.map((c) => c.id)).toEqual([added.id]);
    expect(comments[0]!.body).toBe('Looks good');
  });

  it('resolves and deletes a comment', async () => {
    const id = await newDocument();
    const added = await api.addComment(id, 'Fix typo');
    const resolved = await api.resolveComment(id, added.id, true);
    expect(resolved.resolved).toBe(true);
    await api.deleteComment(id, added.id);
    expect(await api.getComments(id)).toEqual([]);
  });

  it('lists versions as an array', async () => {
    const id = await newDocument();
    await api.updateDocument(id, { content: 'v2' });
    const versions = await api.getVersions(id);
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it('keeps the edit message sent with an update on that version', async () => {
    const id = await newDocument();
    await api.updateDocument(id, { content: 'v2', editMessage: 'Rewrite intro' });
    const versions = await api.getVersions(id);
    expect(versions.map((v) => v.message)).toEqual([undefined, 'Rewrite intro']);
  });
});

describe('web API client against the real server: documents', () => {
  it('whoami returns the caller', async () => {
    expect(await api.whoami()).toEqual({ user: 'alice' });
  });

  it('reads a document with its content, latest and pinned version', async () => {
    const id = await newDocument();
    await api.updateDocument(id, { content: 'v2' });
    const latest = await api.getDocument(id);
    expect(latest.content).toBe('v2');
    expect(latest.latestVersion).toBe(2);
    const first = await api.getDocument(id, 1);
    expect(first.content).toBe('v1');
    expect(first.version).toBe(1);
  });

  it('lists and searches documents as pages of items', async () => {
    const id = await newDocument();
    const list = await api.listDocuments();
    expect(list.items.map((d) => d.id)).toEqual([id]);
    const found = await api.listDocuments('Contract');
    expect(found.items.map((d) => d.id)).toEqual([id]);
  });

  it('returns a unified diff string between two versions', async () => {
    const id = await newDocument();
    await api.updateDocument(id, { content: 'v2' });
    const result = await api.getDiff(id, 1, 2);
    expect(typeof result.diff).toBe('string');
    expect(result.diff).toContain('-v1');
    expect(result.diff).toContain('+v2');
  });

  it('changes visibility and deletes a document', async () => {
    const id = await newDocument();
    expect((await api.setVisibility(id, 'PRIVATE')).visibility).toBe('PRIVATE');
    await api.deleteDocument(id);
    expect(await api.listDocuments()).toMatchObject({ items: [] });
  });

  it('scans content and reports the detected credential types', async () => {
    const result = await api.scanContent('password=SuperSecret123!Abc');
    expect(result.detected).toContain('generic-secret');
    expect(await api.scanContent('nothing secret here')).toEqual({ detected: [] });
  });
});

describe('web API client against the real server: errors', () => {
  it("reports the server's message for a missing document", async () => {
    await expect(api.getDocument('missing123')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'API error 404: Document not found',
    });
  });

  it("reports the server's reason for a rejected update", async () => {
    const id = await newDocument();
    await expect(api.updateDocument(id, { title: 'x'.repeat(301) })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      message: 'API error 400: Title exceeds maximum length',
    });
  });
});
