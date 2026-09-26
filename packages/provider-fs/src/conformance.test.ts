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
import { afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
