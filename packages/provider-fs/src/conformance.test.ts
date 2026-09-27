/**
 * Runs the shared provider conformance suite against the filesystem provider.
 *
 * Each `factory()` call gets its own freshly-created temp data directory, so
 * cases cannot see one another's state and the boot lock never contends. The
 * directories live under the OS temp dir and are removed after the run.
 *
 * This is the first execution this provider has ever had against the contract,
 * so it is where its CAS, pagination ordering, and id-validation behaviour are
 * actually proven rather than assumed.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LIMITS } from '@agentdocstore/core';
import { runProviderConformance } from '@agentdocstore/provider-tests';
import { createFsProvider } from './index.js';

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

runProviderConformance('provider-fs', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agentdocstore-conformance-'));
  dirs.push(dataDir);
  return createFsProvider({ dataDir });
});

// The provider's own size checks are what MCP writes reach, so their messages
// must say how much is too much, as the REST server's do.
describe('provider-fs size errors name the limit', () => {
  async function provider() {
    const dataDir = await mkdtemp(join(tmpdir(), 'agentdocstore-limits-'));
    dirs.push(dataDir);
    return createFsProvider({ dataDir });
  }
  const doc = { language: 'plaintext', visibility: 'PRIVATE', createdBy: 'alice' } as const;

  it('for content', async () => {
    const p = await provider();
    await expect(
      p.repository.create({
        ...doc,
        title: 'Big',
        content: 'x'.repeat(LIMITS.MAX_CONTENT_BYTES + 1),
      }),
    ).rejects.toThrow(
      `Content exceeds size cap (${LIMITS.MAX_CONTENT_BYTES + 1} bytes; the limit is ${LIMITS.MAX_CONTENT_BYTES} bytes)`,
    );
    await p.close();
  });

  it('for a title', async () => {
    const p = await provider();
    await expect(
      p.repository.create({ ...doc, title: 'x'.repeat(LIMITS.MAX_TITLE_BYTES + 1), content: 'a' }),
    ).rejects.toThrow(
      `Title exceeds maximum length (${LIMITS.MAX_TITLE_BYTES + 1} bytes; the limit is ${LIMITS.MAX_TITLE_BYTES} bytes)`,
    );
    await p.close();
  });

  it('for a comment', async () => {
    const p = await provider();
    const created = await p.repository.create({ ...doc, title: 'Doc', content: 'a' });
    await expect(
      p.comments.add(created.id, {
        author: 'alice',
        body: 'x'.repeat(LIMITS.MAX_COMMENT_BYTES + 1),
      }),
    ).rejects.toThrow(
      `Comment exceeds maximum length (${LIMITS.MAX_COMMENT_BYTES + 1} bytes; the limit is ${LIMITS.MAX_COMMENT_BYTES} bytes)`,
    );
    await p.close();
  });
});
