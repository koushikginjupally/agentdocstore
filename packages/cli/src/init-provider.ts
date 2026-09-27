/**
 * `agentdocstore init-provider <name>` — scaffold a third-party provider package.
 *
 * The SPI is small but there are a few clauses that are easy to get wrong and
 * expensive to discover later (CAS on append, visibility in search, honest
 * capabilities). Rather than asking an author to transcribe them from the docs,
 * this emits a package that already has the right shape, the conformance suite
 * wired in, and TODOs exactly where store-specific work belongs.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface InitProviderResult {
  dir: string;
  files: string[];
}

/** Slug-check the name: it becomes a directory and an npm package name. */
function validateName(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `Invalid provider name '${name}'. Use lowercase letters, digits and hyphens, ` +
        'e.g. postgres, dynamodb, my-store.',
    );
  }
}

export function runInitProvider(name: string, cwd = process.cwd()): InitProviderResult {
  validateName(name);

  const dirName = `agentdocstore-provider-${name}`;
  const dir = join(cwd, dirName);
  if (existsSync(dir)) {
    throw new Error(`Refusing to overwrite an existing directory: ${dir}`);
  }

  mkdirSync(join(dir, 'src'), { recursive: true });

  const files: Array<[string, string]> = [
    ['package.json', packageJson(dirName)],
    ['tsconfig.json', tsconfig()],
    ['src/index.ts', indexTs(name)],
    ['src/conformance.test.ts', conformanceTest(name)],
    ['README.md', readme(name, dirName)],
  ];

  for (const [rel, content] of files) {
    writeFileSync(join(dir, rel), content, 'utf8');
  }

  return { dir, files: files.map(([rel]) => rel) };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function packageJson(pkgName: string): string {
  return `${JSON.stringify(
    {
      name: pkgName,
      version: '0.1.0',
      type: 'module',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
      files: ['dist'],
      scripts: {
        build: 'tsc -b',
        test: 'vitest run',
        doctor: 'agentdocstore doctor --provider ./dist/index.js',
      },
      peerDependencies: { '@agentdocstore/core': '>=0.1.0' },
      devDependencies: {
        '@agentdocstore/core': 'latest',
        '@agentdocstore/provider-tests': 'latest',
        typescript: '^5.6.0',
        vitest: '^3.0.0',
      },
    },
    null,
    2,
  )}\n`;
}

function tsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        declaration: true,
        outDir: 'dist',
        rootDir: 'src',
      },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
    null,
    2,
  )}\n`;
}

function indexTs(name: string): string {
  return `/**
 * AgentDocStore storage provider: ${name}
 *
 * Implements the Provider SPI from @agentdocstore/core. Every TODO below is
 * store-specific work; the shape around them is what the loader and the
 * conformance suite expect.
 */

import type {
  Provider,
  ProviderModule,
  ProviderHealth,
  Capabilities,
  DocumentRepository,
  CommentStore,
  SearchIndex,
} from '@agentdocstore/core';
import {
  CoreSearchIndex,
  NotFoundError,
  VersionConflictError,
  ContentTooLargeError,
} from '@agentdocstore/core';

export interface ${pascal(name)}Options {
  /** TODO: your connection settings, e.g. a URL or a table name. */
  url?: string;
}

/**
 * Optional but recommended: validate options so a typo fails at boot with a
 * readable message instead of a 500 on the first write. Any object with a
 * parse() method works — a zod schema satisfies this directly.
 */
export const optionsSchema = {
  parse(input: unknown): ${pascal(name)}Options {
    if (typeof input !== 'object' || input === null) {
      throw new Error('options must be an object');
    }
    // TODO: assert the fields your store actually needs.
    return input as ${pascal(name)}Options;
  },
};

export const providerName = '${name}';

class ${pascal(name)}Provider implements Provider {
  readonly capabilities: Capabilities = {
    // 'core-fallback': this provider uses the in-memory CoreSearchIndex below.
    // Switch to 'native' only once your own index enforces visibility.
    search: 'core-fallback',
    // true only if the STORE expires rows itself (e.g. DynamoDB TTL).
    nativeTtl: false,
    // true only if appendVersion is genuinely compare-and-set.
    atomicVersioning: true,
    // MUST be honest: offline mode refuses a provider that declares true.
    requiresNetwork: true,
  };

  constructor(private readonly options: ${pascal(name)}Options) {}

  // TODO: implement against your store. Contract notes that bite:
  //  - appendVersion MUST throw VersionConflictError when expect.latestVersion
  //    is stale. Emulate with a conditional write / optimistic UPDATE.
  //  - Reads of an unknown or malformed id return null/empty, never throw.
  //  - Mutations of an unknown id throw NotFoundError.
  //  - Reject content over LIMITS.MAX_CONTENT_BYTES with ContentTooLargeError
  //    at WRITE time.
  //  - Keep \`search\` current: after every create, appendVersion, updateMeta
  //    and setVisibility call \`this.search.update({ documentId, owner,
  //    visibility, title, content, expiresAt })\` with the latest content, and
  //    \`this.search.remove(id)\` on delete. Pass expiresAt so expired documents
  //    drop out of search results. CoreSearchIndex is in-memory: rebuild it
  //    from your store when the provider starts.
  readonly repository = {} as DocumentRepository;
  readonly comments = {} as CommentStore;
  readonly search: SearchIndex = new CoreSearchIndex();

  /** Optional: surfaced on /healthz and by \`agentdocstore doctor\`. Never throws. */
  async healthCheck(): Promise<ProviderHealth> {
    try {
      // TODO: a cheap round-trip, e.g. SELECT 1.
      return { healthy: true };
    } catch (err) {
      return { healthy: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async close(): Promise<void> {
    // TODO: release pools, handles, timers.
  }
}

export async function createProvider(options: unknown): Promise<Provider> {
  const opts = optionsSchema.parse(options);
  const provider = new ${pascal(name)}Provider(opts);
  // TODO: connect / migrate here so a returned provider is ready to serve.
  return provider;
}

// The loader accepts either these named exports or a default export object.
const mod: ProviderModule = { providerName, optionsSchema, createProvider };
export default mod;

// Keep the imports honest for template users who delete a TODO branch.
void NotFoundError;
void VersionConflictError;
void ContentTooLargeError;
`;
}

function conformanceTest(name: string): string {
  return `import { runProviderConformance } from '@agentdocstore/provider-tests';
import { createProvider } from './index.js';

/**
 * The authoritative gate: every SPI contract case against a REAL instance of
 * this provider. Point it at a disposable store — the suite creates and deletes
 * documents freely.
 */
runProviderConformance('${name}', async () => {
  // TODO: point at a test instance, and make each run isolated (fresh schema,
  // table, or prefix) so cases cannot see each other's data.
  return createProvider({ url: process.env.${envVar(name)}_TEST_URL });
});
`;
}

function readme(name: string, pkgName: string): string {
  return `# ${pkgName}

An AgentDocStore storage provider for ${name}.

## Use it

\`\`\`bash
npm install ${pkgName}
\`\`\`

\`\`\`json
{
  "provider": {
    "module": "${pkgName}",
    "options": { "url": "..." }
  }
}
\`\`\`

\`\`\`bash
agentdocstore serve --config agentdocstore.config.json --networked
\`\`\`

A provider that declares \`requiresNetwork: true\` is refused in offline mode,
which is the default — \`--networked\` is how an operator accepts egress
deliberately.

## Prove it works

\`\`\`bash
npm run doctor   # fast smoke checks against the live store
npm test         # the full conformance suite
\`\`\`

Both must pass before this provider is safe to point at real data.
`;
}

function pascal(name: string): string {
  return name
    .split('-')
    .map((p) => (p.length > 0 ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join('');
}

function envVar(name: string): string {
  return name.toUpperCase().replace(/-/g, '_');
}
