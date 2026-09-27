import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInitProvider } from './init-provider.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scaffold(): { index: string; test: string; readme: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'ads-init-'));
  dirs.push(cwd);
  runInitProvider('teststore', cwd);
  const root = join(cwd, 'agentdocstore-provider-teststore');
  return {
    index: readFileSync(join(root, 'src/index.ts'), 'utf8'),
    test: readFileSync(join(root, 'src/conformance.test.ts'), 'utf8'),
    readme: readFileSync(join(root, 'README.md'), 'utf8'),
  };
}

describe('init-provider scaffold', () => {
  it('starts with a working CoreSearchIndex, not an empty stub', () => {
    const { index } = scaffold();
    expect(index).toMatch(/readonly search: SearchIndex = new CoreSearchIndex\(\)/);
    expect(index).not.toMatch(/search = \{\} as SearchIndex/);
    expect(index).toMatch(/import \{[^}]*CoreSearchIndex[^}]*\} from '@agentdocstore\/core'/);
  });

  it('tells the author the provider must keep the index current, with expiry', () => {
    const { index } = scaffold();
    expect(index).toContain('search.update');
    expect(index).toContain('expiresAt');
    expect(index).not.toContain('lets core wrap MiniSearch');
  });

  it('states the real number of conformance cases', () => {
    const { test, readme } = scaffold();
    expect(test).not.toMatch(/\b57\b/);
    expect(readme).not.toMatch(/\b57\b/);
  });
});
