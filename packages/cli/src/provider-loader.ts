/**
 * Provider loading.
 *
 * Built-in shorthands (`fs`, `memory`) construct the bundled providers. Any
 * other value is treated as an npm module specifier implementing
 * {@link ProviderModule} and is resolved from the OPERATOR's working directory,
 * not from AgentDocStore's own `node_modules`. That is the whole point: adding a
 * storage backend is `npm install` plus one config key, never a fork of this
 * repository.
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import {
  assertOfflinePolicy,
  isProviderModule,
  describeProviderModuleDefect,
} from '@agentdocstore/core';
import type { Provider, ProviderModule, RuntimeMode } from '@agentdocstore/core';
import { createFsProvider } from '@agentdocstore/provider-fs';
import { createMemoryProvider } from '@agentdocstore/provider-memory';

import { isBuiltinProvider } from './config.js';
import type { ProviderSelection } from './config.js';

export interface LoadProviderInput {
  selection: ProviderSelection;
  /** Data directory handed to the `fs` provider. */
  dataDir: string;
  /** Runtime mode; an offline instance refuses a networked provider. */
  mode: RuntimeMode;
  /** Bind address to validate against the mode. Omit for stdio (no bind). */
  host?: string;
  /** Operator accepted inbound exposure on a non-loopback address. */
  expose?: boolean;
  /** Resolution root for third-party modules. Defaults to `process.cwd()`. */
  cwd?: string;
}

export interface LoadedProvider {
  provider: Provider;
  /** Display name: the built-in shorthand, or the module's `providerName`. */
  name: string;
  /** The module specifier that produced it, for diagnostics. */
  module: string;
}

/**
 * Construct the configured provider and validate it against the runtime mode.
 *
 * The mode check happens AFTER construction because `requiresNetwork` is a
 * property of the provider instance, and BEFORE the caller uses it — a
 * networked provider in an offline instance is closed again and the startup
 * aborted, rather than quietly serving.
 */
export async function loadProvider(input: LoadProviderInput): Promise<LoadedProvider> {
  const { selection, dataDir, mode, host, expose, cwd = process.cwd() } = input;

  // Fail on the mode/host combination first: no point constructing a Postgres
  // connection only to refuse the bind address.
  assertOfflinePolicy({
    mode,
    ...(host !== undefined ? { host } : {}),
    ...(expose !== undefined ? { expose } : {}),
  });

  const loaded = isBuiltinProvider(selection.module)
    ? await loadBuiltin(selection.module, dataDir)
    : await loadExternal(selection, cwd);

  try {
    assertOfflinePolicy({
      mode,
      capabilities: loaded.provider.capabilities,
      providerName: loaded.name,
    });
  } catch (err) {
    await loaded.provider.close().catch(() => undefined);
    throw err;
  }

  return loaded;
}

// ---------------------------------------------------------------------------
// Built-ins
// ---------------------------------------------------------------------------

async function loadBuiltin(module: 'fs' | 'memory', dataDir: string): Promise<LoadedProvider> {
  if (module === 'memory') {
    return { provider: createMemoryProvider(), name: 'memory', module };
  }
  return { provider: await createFsProvider({ dataDir }), name: 'fs', module };
}

// ---------------------------------------------------------------------------
// Third-party modules
// ---------------------------------------------------------------------------

async function loadExternal(selection: ProviderSelection, cwd: string): Promise<LoadedProvider> {
  const mod = await importFromCwd(selection.module, cwd);

  // Accept either a namespace export or a default export object, so both
  // `export const providerName` and `export default { ... }` styles work.
  const candidate = pickModuleShape(mod);

  if (!isProviderModule(candidate)) {
    throw new Error(
      `'${selection.module}' is not a valid AgentDocStore provider: ` +
        `${describeProviderModuleDefect(candidate)}. ` +
        'See docs/PROVIDERS.md for the required exports.',
    );
  }

  const options = validateOptions(candidate, selection.options, selection.module);

  let provider: Provider;
  try {
    provider = await candidate.createProvider(options);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Provider '${selection.module}' failed to initialise: ${detail}`, {
      cause: err,
    });
  }

  assertProviderShape(provider, selection.module);

  return { provider, name: candidate.providerName, module: selection.module };
}

function pickModuleShape(mod: unknown): unknown {
  if (isProviderModule(mod)) return mod;
  if (typeof mod === 'object' && mod !== null && 'default' in mod) {
    return (mod as { default: unknown }).default;
  }
  return mod;
}

function validateOptions(
  mod: ProviderModule,
  options: Record<string, unknown>,
  specifier: string,
): unknown {
  if (mod.optionsSchema === undefined) return options;
  try {
    return mod.optionsSchema.parse(options);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid options for provider '${specifier}': ${detail}`, { cause: err });
  }
}

/**
 * Resolve and import a module from the operator's directory.
 *
 * `createRequire` needs a file path to anchor resolution, so we anchor on the
 * CWD's `package.json` path — it does not need to exist for resolution to walk
 * `node_modules` upward from there.
 */
async function importFromCwd(specifier: string, cwd: string): Promise<unknown> {
  const requireFromCwd = createRequire(join(cwd, 'package.json'));
  let resolved: string;
  try {
    resolved = requireFromCwd.resolve(specifier);
  } catch {
    // Fall back to plain import: covers a bare builtin-style specifier, a file
    // URL, and the monorepo's own workspace links.
    try {
      return (await import(specifier)) as unknown;
    } catch {
      throw new Error(
        `Provider module '${specifier}' could not be resolved from ${cwd}. ` +
          `Install it there first: npm install ${specifier}`,
      );
    }
  }
  return (await import(pathToFileURL(resolved).href)) as unknown;
}

/**
 * Check the constructed object actually implements the SPI. A provider whose
 * `repository` is missing would otherwise fail much later, on a request, with a
 * bewildering TypeError.
 */
function assertProviderShape(provider: unknown, specifier: string): void {
  const required = ['repository', 'comments', 'search', 'capabilities', 'close'] as const;
  const p = provider as Record<string, unknown> | null;
  if (typeof p !== 'object' || p === null) {
    throw new Error(`Provider '${specifier}' createProvider() did not return an object.`);
  }
  const missing = required.filter((k) => p[k] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Provider '${specifier}' is missing SPI member(s): ${missing.join(', ')}. ` +
        'See docs/PROVIDERS.md.',
    );
  }
  const caps = p['capabilities'] as Record<string, unknown>;
  if (typeof caps['requiresNetwork'] !== 'boolean') {
    throw new Error(
      `Provider '${specifier}' does not declare capabilities.requiresNetwork. ` +
        'Offline mode cannot be enforced without it.',
    );
  }
}
