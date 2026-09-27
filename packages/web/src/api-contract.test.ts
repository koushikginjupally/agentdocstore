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
});
