/**
 * Configuration resolution for the AgentDocStore CLI.
 *
 * Precedence (highest to lowest):
 *   1. CLI flags
 *   2. AGENTDOCSTORE_* environment variables
 *   3. Config file (agentdocstore.config.json)
 *   4. Built-in defaults
 */

import { readFileSync } from 'node:fs';
import { isRuntimeMode } from '@agentdocstore/core';
import type { RuntimeMode } from '@agentdocstore/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthMode = 'single-user' | 'trusted-header' | 'token';

/** Built-in provider shorthands. Anything else is an npm module specifier. */
export const BUILTIN_PROVIDERS = ['fs', 'memory'] as const;
export type BuiltinProvider = (typeof BUILTIN_PROVIDERS)[number];

export function isBuiltinProvider(v: string): v is BuiltinProvider {
  return (BUILTIN_PROVIDERS as readonly string[]).includes(v);
}

/** Which storage backend to load, and what to hand its factory. */
export interface ProviderSelection {
  /** `fs`, `memory`, or an npm module specifier such as `@acme/ab-provider-pg`. */
  module: string;
  /** Provider-specific options, validated by the provider's own schema. */
  options: Record<string, unknown>;
}

export interface ResolvedConfig {
  port: number;
  host: string;
  dataDir: string;
  auth: AuthMode;
  ephemeral: boolean;
  configFile: string | undefined;
  /** `offline` (default) refuses remote binds and networked providers. */
  mode: RuntimeMode;
  /**
   * Accept inbound connections on a non-loopback address while staying offline.
   * Independent of `mode`: this governs who can reach us, not who we can reach.
   */
  expose: boolean;
  provider: ProviderSelection;
  /** Explicit user name for `single-user` auth. Defaults to the OS login. */
  user: string | undefined;
  /** Path to a `{ "<token>": "<username>" }` JSON map for `token` auth. */
  tokensFile: string | undefined;
  /** Header carrying the identity in `trusted-header` auth. */
  trustedHeader: string;
}

/** Raw values from CLI flags — every field optional (undefined = not supplied). */
export interface CliFlags {
  port?: number;
  host?: string;
  dataDir?: string;
  auth?: AuthMode;
  ephemeral?: boolean;
  configFile?: string;
  mode?: RuntimeMode;
  provider?: string;
  providerOptions?: Record<string, unknown>;
  user?: string;
  tokensFile?: string;
  trustedHeader?: string;
  expose?: boolean;
}

/** Values from environment variables. */
export interface EnvVars {
  AGENTDOCSTORE_PORT?: string;
  AGENTDOCSTORE_HOST?: string;
  AGENTDOCSTORE_DATA_DIR?: string;
  AGENTDOCSTORE_AUTH?: string;
  AGENTDOCSTORE_EPHEMERAL?: string;
  AGENTDOCSTORE_CONFIG?: string;
  AGENTDOCSTORE_MODE?: string;
  AGENTDOCSTORE_PROVIDER?: string;
  AGENTDOCSTORE_PROVIDER_OPTIONS?: string;
  AGENTDOCSTORE_USER?: string;
  AGENTDOCSTORE_TOKENS?: string;
  AGENTDOCSTORE_TRUSTED_HEADER?: string;
  AGENTDOCSTORE_EXPOSE?: string;
}

/** Values loaded from a config file. */
export interface FileConfig {
  port?: number;
  host?: string;
  dataDir?: string;
  auth?: string;
  ephemeral?: boolean;
  mode?: string;
  /** Either `"postgres"` or `{ "module": "...", "options": { ... } }`. */
  provider?: string | { module?: string; options?: Record<string, unknown> };
  user?: string;
  tokens?: string;
  trustedHeader?: string;
  expose?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_TRUSTED_HEADER = 'x-forwarded-user';

export const DEFAULTS: Readonly<ResolvedConfig> = {
  port: 8787,
  host: '127.0.0.1',
  dataDir: '', // filled at runtime from DEFAULT_DATA_DIR
  auth: 'single-user',
  ephemeral: false,
  configFile: undefined,
  mode: 'offline',
  expose: false,
  provider: { module: 'fs', options: {} },
  user: undefined,
  tokensFile: undefined,
  trustedHeader: DEFAULT_TRUSTED_HEADER,
};

// ---------------------------------------------------------------------------
// Config file loader
// ---------------------------------------------------------------------------

export function loadConfigFile(filePath: string): FileConfig {
  const raw = readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Config file must be a JSON object: ${filePath}`);
  }
  return parsed as FileConfig;
}

/**
 * Load a `{ token: username }` map. Kept here (not in the server) so a bad
 * tokens file fails at startup with the path in the message, rather than
 * silently yielding an empty map that rejects every caller.
 */
export function loadTokensFile(filePath: string): Record<string, string> {
  const raw = readFileSync(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Tokens file is not valid JSON: ${filePath}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Tokens file must be a JSON object of token -> username: ${filePath}`);
  }
  const out: Record<string, string> = {};
  for (const [token, user] of Object.entries(parsed)) {
    if (typeof user !== 'string' || user.trim().length === 0) {
      throw new Error(`Tokens file maps a token to a non-string username: ${filePath}`);
    }
    if (token.trim().length === 0) {
      throw new Error(`Tokens file contains an empty token: ${filePath}`);
    }
    out[token] = user;
  }
  if (Object.keys(out).length === 0) {
    throw new Error(`Tokens file is empty, so every caller would be rejected: ${filePath}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Environment variable extraction
// ---------------------------------------------------------------------------

export function extractEnvConfig(env: EnvVars): Partial<ResolvedConfig> {
  const result: Partial<ResolvedConfig> = {};

  if (env.AGENTDOCSTORE_PORT !== undefined) {
    const p = parseInt(env.AGENTDOCSTORE_PORT, 10);
    if (!Number.isNaN(p)) result.port = p;
  }
  if (env.AGENTDOCSTORE_HOST !== undefined) result.host = env.AGENTDOCSTORE_HOST;
  if (env.AGENTDOCSTORE_DATA_DIR !== undefined) result.dataDir = env.AGENTDOCSTORE_DATA_DIR;
  if (env.AGENTDOCSTORE_AUTH !== undefined) {
    if (isValidAuthMode(env.AGENTDOCSTORE_AUTH)) result.auth = env.AGENTDOCSTORE_AUTH;
  }
  if (env.AGENTDOCSTORE_EPHEMERAL !== undefined) {
    result.ephemeral =
      env.AGENTDOCSTORE_EPHEMERAL === '1' || env.AGENTDOCSTORE_EPHEMERAL === 'true';
  }
  if (env.AGENTDOCSTORE_CONFIG !== undefined) result.configFile = env.AGENTDOCSTORE_CONFIG;
  if (env.AGENTDOCSTORE_MODE !== undefined && isRuntimeMode(env.AGENTDOCSTORE_MODE)) {
    result.mode = env.AGENTDOCSTORE_MODE;
  }
  if (env.AGENTDOCSTORE_USER !== undefined) result.user = env.AGENTDOCSTORE_USER;
  if (env.AGENTDOCSTORE_TOKENS !== undefined) result.tokensFile = env.AGENTDOCSTORE_TOKENS;
  if (env.AGENTDOCSTORE_TRUSTED_HEADER !== undefined) {
    result.trustedHeader = env.AGENTDOCSTORE_TRUSTED_HEADER;
  }
  if (env.AGENTDOCSTORE_EXPOSE !== undefined) {
    result.expose = env.AGENTDOCSTORE_EXPOSE === '1' || env.AGENTDOCSTORE_EXPOSE === 'true';
  }

  // Provider: module and/or options may come from the environment independently.
  const envModule = env.AGENTDOCSTORE_PROVIDER;
  const envOptions = env.AGENTDOCSTORE_PROVIDER_OPTIONS;
  if (envModule !== undefined || envOptions !== undefined) {
    const selection: ProviderSelection = { module: envModule ?? '', options: {} };
    if (envOptions !== undefined) {
      selection.options = parseProviderOptions(envOptions, 'AGENTDOCSTORE_PROVIDER_OPTIONS');
    }
    result.provider = selection;
  }

  return result;
}

/** Parse a JSON options blob, naming its source in the error. */
export function parseProviderOptions(raw: string, source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${source} must be valid JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${source} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Full resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the final configuration by layering:
 * CLI flags > env vars > config file > defaults.
 *
 * @param flags - Parsed CLI flags
 * @param env - Environment variables (typically `process.env`)
 * @param defaultDataDir - The default data directory from provider-fs
 */
export function resolveConfig(
  flags: CliFlags,
  env: EnvVars,
  defaultDataDir: string,
): ResolvedConfig {
  const envCfg = extractEnvConfig(env);

  // Config file path: CLI flag > env > undefined.
  const configPath = flags.configFile ?? envCfg.configFile ?? undefined;
  let fileCfg: FileConfig = {};
  if (configPath !== undefined) {
    fileCfg = loadConfigFile(configPath);
  }

  // Layer: flags > env > file > defaults (with the real default data dir).
  const defaults: ResolvedConfig = { ...DEFAULTS, dataDir: defaultDataDir };

  const ephemeral = flags.ephemeral ?? envCfg.ephemeral ?? fileCfg.ephemeral ?? defaults.ephemeral;

  return {
    port: flags.port ?? envCfg.port ?? fileCfg.port ?? defaults.port,
    host: flags.host ?? envCfg.host ?? fileCfg.host ?? defaults.host,
    dataDir: flags.dataDir ?? envCfg.dataDir ?? fileCfg.dataDir ?? defaults.dataDir,
    auth:
      flags.auth ??
      envCfg.auth ??
      (isValidAuthMode(fileCfg.auth) ? fileCfg.auth : undefined) ??
      defaults.auth,
    ephemeral,
    configFile: configPath,
    mode:
      flags.mode ??
      envCfg.mode ??
      (isRuntimeMode(fileCfg.mode) ? fileCfg.mode : undefined) ??
      defaults.mode,
    expose: flags.expose ?? envCfg.expose ?? fileCfg.expose ?? defaults.expose,
    provider: resolveProvider(flags, envCfg, fileCfg, ephemeral),
    user: flags.user ?? envCfg.user ?? fileCfg.user ?? defaults.user,
    tokensFile: flags.tokensFile ?? envCfg.tokensFile ?? fileCfg.tokens ?? defaults.tokensFile,
    trustedHeader:
      flags.trustedHeader ??
      envCfg.trustedHeader ??
      fileCfg.trustedHeader ??
      defaults.trustedHeader,
  };
}

/**
 * Resolve which provider to load.
 *
 * `--ephemeral` is sugar for the memory provider and wins over everything: it
 * is the flag people reach for when they want a throwaway instance, and
 * silently honouring a configured Postgres instead would be a nasty surprise.
 * Module and options layer independently, so `--provider` on the command line
 * can be combined with options from a config file.
 */
function resolveProvider(
  flags: CliFlags,
  envCfg: Partial<ResolvedConfig>,
  fileCfg: FileConfig,
  ephemeral: boolean,
): ProviderSelection {
  if (ephemeral) return { module: 'memory', options: {} };

  const fileProvider = fileCfg.provider;
  const fileModule = typeof fileProvider === 'string' ? fileProvider : fileProvider?.module;
  const fileOptions = typeof fileProvider === 'string' ? undefined : fileProvider?.options;

  const envModule =
    envCfg.provider?.module !== undefined && envCfg.provider.module.length > 0
      ? envCfg.provider.module
      : undefined;
  const envOptions =
    envCfg.provider !== undefined && Object.keys(envCfg.provider.options).length > 0
      ? envCfg.provider.options
      : undefined;

  return {
    module: flags.provider ?? envModule ?? fileModule ?? 'fs',
    options: flags.providerOptions ?? envOptions ?? fileOptions ?? {},
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidAuthMode(v: string | undefined): v is AuthMode {
  return v === 'single-user' || v === 'trusted-header' || v === 'token';
}

/**
 * Returns true when the host is NOT localhost — callers should log a
 * security warning.
 */
export function isNonLocalhost(host: string): boolean {
  return host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
}
