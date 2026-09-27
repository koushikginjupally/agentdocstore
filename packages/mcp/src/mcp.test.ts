/**
 * Tests for the @agentdocstore/mcp package.
 *
 * Tests the tool layer directly (via createMcpServer + InMemoryTransport)
 * against createMemoryProvider().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMemoryProvider } from '@agentdocstore/provider-memory';
import type { Provider } from '@agentdocstore/core';
import { createMcpServer } from './register.js';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let provider: Provider;
let mcp: McpServer;
let client: Client;
let clientTransport: InMemoryTransport;
let serverTransport: InMemoryTransport;

/** Current viewer for the MCP server. */
let currentViewer: string | null = 'alice';

beforeEach(async () => {
  provider = createMemoryProvider();
  currentViewer = 'alice';

  mcp = createMcpServer({
    provider,
    getViewer: () => currentViewer,
  });

  [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  await mcp.close();
  await provider.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<{
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}> {
  const result = await client.callTool({ name, arguments: args });
  return result as { content: Array<{ type: string; text?: string }>; isError?: boolean };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

function jsonOf(result: { content: Array<{ type: string; text?: string }> }): unknown {
  return JSON.parse(textOf(result));
}

// ---------------------------------------------------------------------------
// Contract: tools/list returns EXACTLY 16 tools
// ---------------------------------------------------------------------------

describe('tools/list contract', () => {
  const EXPECTED_TOOLS = [
    'add_comment',
    'create_document',
    'delete_comment',
    'delete_document',
    'diff_document',
    'get_comments',
    'get_help',
    'get_raw_document',
    'get_versions',
    'list_documents',
    'read_document',
    'resolve_comment',
    'scan_content',
    'set_visibility',
    'unresolve_comment',
    'update_document',
  ];

  it('returns exactly the 16 expected tool names', async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
  });
});

// ---------------------------------------------------------------------------
// create_document -> read_document round-trip
// ---------------------------------------------------------------------------

describe('create_document -> read_document round-trip', () => {
  it('creates and reads back a doc through the tool layer', async () => {
    const createResult = callTool('create_document', {
      title: 'Hello World',
      content: 'console.log("hello");',
      language: 'javascript',
    });
    const created = jsonOf(await createResult) as { doc: { id: string }; message: string };
    expect(created.doc.id).toBeDefined();
    expect(created.message).toContain('Created');

    const readResult = await callTool('read_document', { id: created.doc.id });
    const read = jsonOf(readResult) as {
      doc: { id: string; title: string };
      version: { content: string; version: number };
    };
    expect(read.doc.id).toBe(created.doc.id);
    expect(read.doc.title).toBe('Hello World');
    expect(read.version.content).toBe('console.log("hello");');
    expect(read.version.version).toBe(1);
  });

  it('read_document accepts a URL containing the id', async () => {
    const created = jsonOf(
      await callTool('create_document', { title: 'URL test', content: 'body' }),
    ) as { doc: { id: string } };

    const readResult = await callTool('read_document', {
      id: `https://example.com/documents/${created.doc.id}/view`,
    });
    const read = jsonOf(readResult) as { doc: { id: string } };
    expect(read.doc.id).toBe(created.doc.id);
  });
});

// ---------------------------------------------------------------------------
// scan_content detects a synthetic credential
// ---------------------------------------------------------------------------

describe('scan_content', () => {
  it('detects a synthetic AWS access key', async () => {
    const result = await callTool('scan_content', {
      content: 'aws_key = AKIAIOSFODNN7EXAMPLE',
    });
    const data = jsonOf(result) as { findings: Array<{ type: string }>; total: number };
    expect(data.total).toBeGreaterThan(0);
    expect(data.findings.some((f) => f.type.includes('aws') || f.type.includes('generic'))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Credential flow: returns options and persists nothing without a policy
// ---------------------------------------------------------------------------

describe('credential detection flow', () => {
  it('returns options without persisting when credentials detected and no policy', async () => {
    const content = 'password = "s3cretV4lue!@#$"';

    const result = await callTool('create_document', {
      title: 'Secret doc',
      content,
    });

    const data = jsonOf(result) as {
      action: string;
      findings: Array<{ type: string }>;
      options: string[];
    };
    expect(data.action).toBe('credentials_detected');
    expect(data.findings.length).toBeGreaterThan(0);
    expect(data.options).toContain('redact');
    expect(data.options).toContain('skip');

    // Verify nothing was persisted.
    const listResult = await callTool('list_documents', {});
    const list = jsonOf(listResult) as { items: unknown[] };
    expect(list.items).toHaveLength(0);
  });

  it('persists with redaction when redactionPolicy is "redact"', async () => {
    const content = 'password = "s3cretV4lue!@#$"';

    const result = await callTool('create_document', {
      title: 'Redacted doc',
      content,
      redactionPolicy: 'redact',
    });

    const data = jsonOf(result) as { doc: { id: string } };
    expect(data.doc.id).toBeDefined();

    // Read back and verify content was redacted.
    const readResult = await callTool('get_raw_document', { id: data.doc.id });
    const raw = textOf(readResult);
    expect(raw).toContain('[REDACTED:');
    expect(raw).not.toContain('s3cretV4lue');
  });

  it('persists as-is when redactionPolicy is "skip"', async () => {
    const content = 'password = "s3cretV4lue!@#$"';

    const result = await callTool('create_document', {
      title: 'Unredacted doc',
      content,
      redactionPolicy: 'skip',
    });

    const data = jsonOf(result) as { doc: { id: string } };
    const readResult = await callTool('get_raw_document', { id: data.doc.id });
    const raw = textOf(readResult);
    expect(raw).toContain('s3cretV4lue');
  });
});

// ---------------------------------------------------------------------------
// PRIVATE isolation: different viewer cannot read/raw another owner's doc
// ---------------------------------------------------------------------------

describe('PRIVATE doc isolation', () => {
  it('a different viewer cannot read_document a PRIVATE doc', async () => {
    // Alice creates a private doc.
    currentViewer = 'alice';
    const created = jsonOf(
      await callTool('create_document', {
        title: 'Private notes',
        content: 'secret stuff',
        visibility: 'PRIVATE',
      }),
    ) as { doc: { id: string } };
    const documentId = created.doc.id;

    // Alice can read it.
    const aliceRead = await callTool('read_document', { id: documentId });
    expect(aliceRead.isError).toBeUndefined();

    // Now switch viewer to bob — reconnect with bob's identity.
    // We close and rebuild to change the viewer identity.
    await client.close();
    await mcp.close();

    currentViewer = 'bob';
    mcp = createMcpServer({ provider, getViewer: () => currentViewer });
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverTransport);
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    // Bob tries to read — should get an error (NotFound, not Forbidden).
    const bobRead = await callTool('read_document', { id: documentId });
    expect(bobRead.isError).toBe(true);
    expect(textOf(bobRead)).toContain('not found');
  });

  it('a different viewer cannot get_raw_document a PRIVATE doc', async () => {
    currentViewer = 'alice';
    const created = jsonOf(
      await callTool('create_document', {
        title: 'Private raw',
        content: 'raw secret',
        visibility: 'PRIVATE',
      }),
    ) as { doc: { id: string } };

    // Switch to bob.
    await client.close();
    await mcp.close();

    currentViewer = 'bob';
    mcp = createMcpServer({ provider, getViewer: () => currentViewer });
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverTransport);
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    const bobRaw = await callTool('get_raw_document', { id: created.doc.id });
    expect(bobRaw.isError).toBe(true);
    expect(textOf(bobRaw)).toContain('not found');
  });

  it("list_documents by owner hides another user's PRIVATE documents", async () => {
    currentViewer = 'alice';
    await callTool('create_document', {
      title: 'Alice private plan',
      content: 'private',
      visibility: 'PRIVATE',
    });
    await callTool('create_document', { title: 'Alice public note', content: 'public' });

    // The owner still sees both.
    const own = jsonOf(await callTool('list_documents', {})) as {
      items: Array<{ title: string }>;
    };
    expect(own.items.map((d) => d.title).sort()).toEqual([
      'Alice private plan',
      'Alice public note',
    ]);

    // Viewer is read per call, so switching it is enough.
    currentViewer = 'bob';
    const asBob = jsonOf(await callTool('list_documents', { owner: 'alice' })) as {
      items: Array<{ title: string; visibility: string }>;
    };
    expect(asBob.items.map((d) => d.title)).toEqual(['Alice public note']);
    expect(asBob.items.every((d) => d.visibility === 'PUBLIC')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Additional coverage for robustness
// ---------------------------------------------------------------------------

describe('get_help', () => {
  it('returns overview documentation', async () => {
    const result = await callTool('get_help', {});
    const helpText = textOf(result);
    expect(helpText).toContain('AgentDocStore MCP Tools');
    expect(helpText).toContain('create_document');
    expect(helpText).toContain('Limits');
  });
});

describe('diff_document', () => {
  it('produces a unified diff between two versions', async () => {
    const created = jsonOf(
      await callTool('create_document', { title: 'Diff test', content: 'line1\nline2\n' }),
    ) as { doc: { id: string; latestVersion: number } };

    await callTool('update_document', {
      id: created.doc.id,
      content: 'line1\nmodified\n',
      latestVersion: created.doc.latestVersion,
    });

    const diffResult = await callTool('diff_document', {
      id: created.doc.id,
      fromVersion: 1,
      toVersion: 2,
    });
    const diffText = textOf(diffResult);
    expect(diffText).toContain('-line2');
    expect(diffText).toContain('+modified');
  });
});

describe('extractId from URL in diff_document', () => {
  it('diff_document accepts a URL containing the id', async () => {
    const created = jsonOf(
      await callTool('create_document', { title: 'URL diff', content: 'v1' }),
    ) as {
      doc: { id: string; latestVersion: number };
    };

    await callTool('update_document', {
      id: created.doc.id,
      content: 'v2',
      latestVersion: created.doc.latestVersion,
    });

    const diffResult = await callTool('diff_document', {
      id: `https://example.com/${created.doc.id}`,
      fromVersion: 1,
      toVersion: 2,
    });
    expect(diffResult.isError).toBeUndefined();
    expect(textOf(diffResult)).toContain('v1');
  });
});

describe('expired documents', () => {
  it('are not found and not listed, but can still be deleted', async () => {
    const created = jsonOf(
      await callTool('create_document', { title: 'Ephemeral', content: 'short-lived' }),
    ) as { doc: { id: string } };
    const id = created.doc.id;
    // The stdio MCP server runs no sweep, so the record stays in the store.
    await provider.repository.updateMeta(id, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    for (const [tool, args] of [
      ['read_document', { id }],
      ['get_raw_document', { id }],
      ['get_versions', { id }],
      ['get_comments', { id }],
      ['add_comment', { id, body: 'late' }],
      ['update_document', { id, title: 'revived' }],
      ['set_visibility', { id, visibility: 'PRIVATE' }],
    ] as const) {
      const result = await callTool(tool, args);
      expect(result.isError, tool).toBe(true);
      expect(textOf(result), tool).toMatch(/not found/i);
    }

    const list = jsonOf(await callTool('list_documents', {})) as { items: Array<{ id: string }> };
    expect(list.items.map((d) => d.id)).not.toContain(id);

    const deleted = await callTool('delete_document', { id });
    expect(deleted.isError).toBeFalsy();
    expect(await provider.repository.get(id)).toBeNull();
  });
});
