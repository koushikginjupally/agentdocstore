/**
 * `agentdocstore doctor` — validate a configured provider before trusting it.
 *
 * Loading a third-party store should not be an act of faith. Doctor constructs
 * the provider exactly as `serve` would, reports what it declares, and then
 * exercises the contract clauses that silently corrupt data when they are wrong:
 * compare-and-set on version append, version immutability, pagination stability,
 * PRIVATE search isolation, size limits, expiry listing, and delete cascade.
 *
 * These checks are a SMOKE subset, deliberately runner-free so they work in any
 * install. The authoritative gate is the full 57-case suite in
 * `@agentdocstore/provider-tests`, which a provider author runs from their own
 * vitest — doctor prints how. A provider that fails doctor cannot pass that
 * suite; passing doctor is necessary, not sufficient.
 */

import { VersionConflictError, ContentTooLargeError, LIMITS, isValidId } from '@agentdocstore/core';
import type { Provider } from '@agentdocstore/core';

import type { ResolvedConfig } from './config.js';
import { loadProvider } from './provider-loader.js';
import { installNetworkFuse } from './fuse.js';

// ---------------------------------------------------------------------------
// Check harness
// ---------------------------------------------------------------------------

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

class Checks {
  readonly results: CheckResult[] = [];

  async run(name: string, body: () => Promise<void> | void): Promise<void> {
    try {
      await body();
      this.results.push({ name, ok: true });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.results.push({ name, ok: false, detail });
    }
  }

  get failed(): CheckResult[] {
    return this.results.filter((r) => !r.ok);
  }
}

function assert(condition: unknown, message: string): void {
  if (condition !== true) throw new Error(message);
}

function input(
  overrides: Partial<{
    content: string;
    createdBy: string;
    visibility: 'PUBLIC' | 'PRIVATE';
    title: string;
    expiresAt: string;
  }> = {},
) {
  return {
    title: overrides.title ?? 'doctor probe',
    language: 'plaintext' as const,
    visibility: overrides.visibility ?? ('PUBLIC' as const),
    content: overrides.content ?? 'probe content',
    createdBy: overrides.createdBy ?? 'doctor-alice',
    ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// The smoke conformance checks
// ---------------------------------------------------------------------------

async function runSmokeConformance(provider: Provider): Promise<Checks> {
  const checks = new Checks();
  const created: string[] = [];

  const create = async (o: Parameters<typeof input>[0] = {}) => {
    const doc = await provider.repository.create(input(o));
    created.push(doc.id);
    return doc;
  };

  await checks.run('create returns a valid id and version 1', async () => {
    const doc = await create();
    assert(isValidId(doc.id), `id '${doc.id}' is not a valid AgentDocStore id`);
    assert(doc.latestVersion === 1, `latestVersion was ${doc.latestVersion}, expected 1`);
  });

  await checks.run('get round-trips content byte-exactly, including unicode', async () => {
    const content = '🎉 Ñoño 漢字 e\u0301';
    const doc = await create({ content });
    const v = await provider.repository.getVersion(doc.id, 1);
    assert(v !== null, 'version 1 was not found');
    assert(v!.content === content, 'content did not round-trip byte-exactly');
  });

  await checks.run('appendVersion advances the version pointer', async () => {
    const doc = await create();
    await provider.repository.appendVersion(doc.id, {
      content: 'second',
      editedBy: 'doctor-alice',
      expect: { latestVersion: 1 },
    });
    const after = await provider.repository.get(doc.id);
    assert(
      after?.latestVersion === 2,
      `latestVersion was ${String(after?.latestVersion)}, expected 2`,
    );
  });

  await checks.run('appendVersion REJECTS a stale expectation (CAS)', async () => {
    const doc = await create();
    await provider.repository.appendVersion(doc.id, {
      content: 'v2',
      editedBy: 'doctor-alice',
      expect: { latestVersion: 1 },
    });
    let threw = false;
    try {
      // Deliberately stale: pretend we still believe v1 is latest.
      await provider.repository.appendVersion(doc.id, {
        content: 'v2-conflict',
        editedBy: 'doctor-alice',
        expect: { latestVersion: 1 },
      });
    } catch (err) {
      threw = err instanceof VersionConflictError;
      if (!threw)
        throw new Error(`threw ${String(err)} instead of VersionConflictError`, { cause: err });
    }
    assert(threw, 'a stale append was ACCEPTED — concurrent edits will silently lose data');
  });

  await checks.run('earlier versions are immutable after an append', async () => {
    const doc = await create({ content: 'original' });
    await provider.repository.appendVersion(doc.id, {
      content: 'replacement',
      editedBy: 'doctor-alice',
      expect: { latestVersion: 1 },
    });
    const v1 = await provider.repository.getVersion(doc.id, 1);
    assert(v1?.content === 'original', 'version 1 changed when version 2 was written');
  });

  await checks.run('listByOwner is owner-scoped and paginates with an opaque cursor', async () => {
    for (let i = 0; i < 3; i++) await create({ createdBy: 'doctor-bob', title: `bob ${i}` });
    const page1 = await provider.repository.listByOwner('doctor-bob', { limit: 2 });
    assert(page1.items.length <= 2, 'limit was not honoured');
    assert(
      page1.items.every((b) => b.createdBy === 'doctor-bob'),
      "listByOwner returned another owner's documents",
    );
    if (page1.nextCursor !== undefined) {
      const page2 = await provider.repository.listByOwner('doctor-bob', {
        limit: 2,
        cursor: page1.nextCursor,
      });
      const overlap = page2.items.filter((b) => page1.items.some((a) => a.id === b.id));
      assert(overlap.length === 0, 'pagination returned duplicate items across pages');
    }
  });

  await checks.run('search hides PRIVATE documents from non-owners', async () => {
    const secret = await create({
      createdBy: 'doctor-alice',
      visibility: 'PRIVATE',
      content: 'zzzsecretprobetoken',
      title: 'zzzsecretprobetoken',
    });
    const asOwner = provider.search.query('zzzsecretprobetoken', 'doctor-alice');
    const asOther = provider.search.query('zzzsecretprobetoken', 'doctor-bob');
    assert(
      asOwner.hits.some((h) => h.documentId === secret.id),
      'the owner could not find their own PRIVATE doc',
    );
    assert(
      !asOther.hits.some((h) => h.documentId === secret.id),
      'a PRIVATE doc leaked to a non-owner through search',
    );
  });

  await checks.run('oversized content is rejected at write time', async () => {
    let threw = false;
    try {
      await provider.repository.create(
        input({ content: 'x'.repeat(LIMITS.MAX_CONTENT_BYTES + 1) }),
      );
    } catch (err) {
      threw = err instanceof ContentTooLargeError;
      if (!threw)
        throw new Error(`threw ${String(err)} instead of ContentTooLargeError`, { cause: err });
    }
    assert(threw, 'oversized content was STORED — reads will fail later instead');
  });

  await checks.run('listExpired reports a past expiry', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const doc = await create({ expiresAt: past });
    const expired = await provider.repository.listExpired(new Date().toISOString(), 100);
    assert(expired.includes(doc.id), 'an expired doc was not listed, so it would never be swept');
  });

  await checks.run('delete removes the doc and its comments', async () => {
    const doc = await create();
    await provider.comments.add(doc.id, { author: 'doctor-alice', body: 'probe' });
    await provider.repository.delete(doc.id);
    const after = await provider.repository.get(doc.id);
    assert(after === null, 'get still returned a deleted doc');
    const comments = await provider.comments.list(doc.id);
    assert(comments.length === 0, 'comments survived their doc — orphaned rows');
  });

  // Best-effort cleanup: a failing provider may not delete, which is not a
  // further failure to report.
  for (const id of created) {
    await provider.repository.delete(id).catch(() => undefined);
  }

  return checks;
}

// ---------------------------------------------------------------------------
// doctor command
// ---------------------------------------------------------------------------

export async function runDoctor(config: ResolvedConfig): Promise<number> {
  if (config.mode === 'offline') installNetworkFuse();

  console.log(`AgentDocStore doctor — mode=${config.mode} provider=${config.provider.module}\n`);

  let loaded;
  try {
    loaded = await loadProvider({
      selection: config.provider,
      dataDir: config.dataDir,
      mode: config.mode,
    });
  } catch (err) {
    console.error(`✗ Provider failed to load: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const { provider, name, module } = loaded;
  const caps = provider.capabilities;

  console.log(`Provider:          ${name} (${module})`);
  console.log(`Search:            ${caps.search}`);
  console.log(
    `Native TTL:        ${String(caps.nativeTtl)}${caps.nativeTtl ? '' : ' (server sweeps)'}`,
  );
  console.log(`Atomic versioning: ${String(caps.atomicVersioning)}`);
  console.log(`Requires network:  ${String(caps.requiresNetwork)}`);

  if (provider.healthCheck !== undefined) {
    try {
      const health = await provider.healthCheck();
      console.log(
        `Health:            ${health.healthy ? 'healthy' : 'UNHEALTHY'}` +
          (health.detail !== undefined ? ` — ${health.detail}` : ''),
      );
    } catch (err) {
      console.log(`Health:            threw — ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log('Health:            not implemented (optional)');
  }

  console.log('\nConformance smoke checks:');
  const checks = await runSmokeConformance(provider);
  for (const r of checks.results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `\n      ${r.detail ?? ''}`}`);
  }

  await provider.close().catch(() => undefined);

  const failed = checks.failed.length;
  const total = checks.results.length;
  console.log(`\n${total - failed}/${total} checks passed.`);

  if (failed > 0) {
    console.error(
      `\n✗ ${failed} check(s) failed. This provider is not safe to use yet — see docs/PROVIDERS.md.`,
    );
    return 1;
  }

  console.log(
    '\n✓ Smoke conformance passed. This is a necessary check, not a sufficient ' +
      'one — run the full 59-case suite from your own package before shipping:\n' +
      "\n    import { runProviderConformance } from '@agentdocstore/provider-tests';\n" +
      "    runProviderConformance('my-provider', async () => createProvider({ /* ... */ }));\n",
  );
  return 0;
}
