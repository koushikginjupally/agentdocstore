/**
 * The loading contract for a third-party storage backend.
 *
 * A provider ships as an ordinary npm package that the operator installs next
 * to AgentDocStore and names in configuration:
 *
 * ```json
 * { "provider": { "module": "@acme/agentdocstore-provider-postgres",
 *                 "options": { "url": "postgres://localhost/agentdocstore" } } }
 * ```
 *
 * The package's entry point must satisfy {@link ProviderModule}. It is resolved
 * from the operator's working directory, NOT from AgentDocStore's own
 * `node_modules`, so no fork of this repository is required to add a store.
 */

import type { Provider } from './provider.js';

/**
 * The subset of a schema object the loader needs. Zod's `ZodType` satisfies
 * this structurally, so a provider may export a zod schema without core taking
 * a dependency on zod.
 */
export interface OptionsSchema {
  /** Return the validated options, or throw to reject them. */
  parse(input: unknown): unknown;
}

/** The shape a provider package's entry point must export. */
export interface ProviderModule {
  /**
   * Human-readable name, reported at boot and by `agentdocstore doctor`. Use the
   * store, not the package: `postgres`, `dynamodb`, `s3`.
   */
  readonly providerName: string;
  /**
   * Optional validator for this provider's `options` block. Supply one: it
   * turns a mistyped connection string into a readable boot failure instead of
   * a 500 on first write.
   */
  readonly optionsSchema?: OptionsSchema;
  /**
   * Construct the provider. Any connection, migration, or handshake work
   * belongs here — a returned provider is expected to be ready to serve.
   * Throwing aborts startup with the message shown to the operator.
   */
  createProvider(options: unknown): Promise<Provider>;
}

/**
 * Runtime shape check for a dynamically imported module. Kept in core so the
 * CLI, a fork's own host process, and the conformance kit all reject the same
 * malformed modules with the same message.
 */
export function isProviderModule(value: unknown): value is ProviderModule {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Partial<ProviderModule>;
  if (typeof m.providerName !== 'string' || m.providerName.length === 0) return false;
  if (typeof m.createProvider !== 'function') return false;
  if (
    m.optionsSchema !== undefined &&
    (typeof m.optionsSchema !== 'object' ||
      m.optionsSchema === null ||
      typeof (m.optionsSchema as OptionsSchema).parse !== 'function')
  ) {
    return false;
  }
  return true;
}

/** Explains precisely which clause of the contract a module failed. */
export function describeProviderModuleDefect(value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return 'module did not export an object';
  }
  const m = value as Partial<ProviderModule>;
  if (typeof m.providerName !== 'string' || m.providerName.length === 0) {
    return "missing a non-empty 'providerName' export";
  }
  if (typeof m.createProvider !== 'function') {
    return "missing a 'createProvider(options)' export";
  }
  if (m.optionsSchema !== undefined) {
    const s = m.optionsSchema as Partial<OptionsSchema> | null;
    if (typeof s !== 'object' || s === null || typeof s.parse !== 'function') {
      return "'optionsSchema' is present but has no parse() method";
    }
  }
  return 'unknown defect';
}
