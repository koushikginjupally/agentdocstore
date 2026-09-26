#!/usr/bin/env node
/**
 * `agentdocstore` — CLI entry point.
 *
 * Subcommands:
 *   serve   Start the HTTP server with web UI + MCP
 *   mcp     Run the MCP server over stdio (no HTTP)
 *   export  Archive the data directory to a .tgz file
 *   import  Restore a data directory from a .tgz archive
 *
 * Config precedence: CLI flags > AGENTDOCSTORE_* env > config file > defaults.
 */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_DATA_DIR } from '@agentdocstore/provider-fs';
import { OfflineViolationError } from '@agentdocstore/core';

import { resolveConfig, parseProviderOptions } from './config.js';
import type { CliFlags } from './config.js';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

function getVersion(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const pkgPath = join(dirname(thisFile), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const MAIN_HELP = `
agentdocstore — offline-first, self-hostable document and artifact store

Usage: agentdocstore <command> [options]

Commands:
  serve           Start the HTTP server with web UI, REST API, and MCP endpoint
  mcp             Run the MCP server over stdio (no HTTP server)
  doctor          Validate the configured storage provider
  init-provider   Scaffold a new third-party storage provider package
  export          Archive the data directory to a .tgz file
  import          Restore a data directory from a .tgz archive

Global options:
  --help       Show help
  --version    Show version

Runtime mode:
  --offline    (default) Local providers only, outbound egress fused
  --expose     Accept inbound on a non-loopback address (still offline)
  --networked  Allow outbound egress and network-backed providers

Config precedence: CLI flags > AGENTDOCSTORE_* env vars > config file > defaults.

Environment variables:
  AGENTDOCSTORE_PORT              Server port (default: 8787)
  AGENTDOCSTORE_HOST              Bind address (default: 127.0.0.1)
  AGENTDOCSTORE_DATA_DIR          Data directory path
  AGENTDOCSTORE_AUTH              Auth mode: single-user | trusted-header | token
  AGENTDOCSTORE_EPHEMERAL         Use in-memory storage (1 or true)
  AGENTDOCSTORE_CONFIG            Path to config file
  AGENTDOCSTORE_MODE              offline | networked
  AGENTDOCSTORE_PROVIDER          fs | memory | <npm module specifier>
  AGENTDOCSTORE_PROVIDER_OPTIONS  JSON options object for the provider
  AGENTDOCSTORE_USER              User name for single-user auth
  AGENTDOCSTORE_TOKENS            Path to a token -> username JSON map
  AGENTDOCSTORE_TRUSTED_HEADER    Identity header for trusted-header auth
  AGENTDOCSTORE_EXPOSE            Accept non-loopback inbound (1 or true)
`.trim();

const SERVE_HELP = `
agentdocstore serve — start the HTTP server

Usage: agentdocstore serve [options]

Options:
  --port <number>       Port to listen on (default: 8787)
  --host <address>      Bind address (default: 127.0.0.1)
  --data <dir>          Data directory path (default: ~/.agentdocstore/data)
  --auth <mode>         Auth mode: single-user | trusted-header | token
  --user <name>         Identity for single-user auth (default: OS login)
  --tokens <file>       JSON map of token -> username (required for --auth token)
  --trusted-header <h>  Identity header name (default: x-forwarded-user)
  --provider <module>   fs | memory | an installed provider module
  --provider-options <json>  JSON options passed to the provider
  --ephemeral           Use in-memory storage (data lost on restart)
  --offline             Enforce offline mode (default)
  --expose              Accept inbound on a non-loopback address, still offline
  --networked           Allow egress and network-backed providers
  --config <file>       Path to agentdocstore.config.json
  --help                Show this help

Serves the web UI at /, the REST API at /api/*, and the MCP endpoint at /mcp.
Health check at /healthz reports the runtime mode and store health.
`.trim();

const MCP_HELP = `
agentdocstore mcp — run the MCP server over stdio

Usage: agentdocstore mcp [options]

Options:
  --data <dir>          Data directory path (default: ~/.agentdocstore/data)
  --provider <module>   fs | memory | an installed provider module
  --provider-options <json>  JSON options passed to the provider
  --user <name>         Identity for created documents (default: OS login)
  --ephemeral           Use in-memory storage
  --networked           Allow a network-backed provider
  --config <file>       Path to agentdocstore.config.json
  --help                Show this help

Constructs the provider in-process and speaks MCP over stdin/stdout.
No HTTP server is started.
`.trim();

const DOCTOR_HELP = `
agentdocstore doctor — validate the configured storage provider

Usage: agentdocstore doctor [options]

Options:
  --provider <module>   fs | memory | an installed provider module
  --provider-options <json>  JSON options passed to the provider
  --data <dir>          Data directory (for the fs provider)
  --networked           Allow a network-backed provider
  --config <file>       Path to agentdocstore.config.json
  --help                Show this help

Loads the provider, reports its declared capabilities and health, then runs
conformance smoke checks against it. Exits non-zero on any failure.
`.trim();

const INIT_PROVIDER_HELP = `
agentdocstore init-provider — scaffold a storage provider package

Usage: agentdocstore init-provider <name>

Creates ./agentdocstore-provider-<name>/ with the SPI skeleton, an options
schema, a health check, and the 57-case conformance suite wired in.

Example:
  agentdocstore init-provider postgres
`.trim();

const EXPORT_HELP = `
agentdocstore export — archive the data directory

Usage: agentdocstore export <file.tgz> [options]

Options:
  --data <dir>    Data directory to export (default: ~/.agentdocstore/data)
  --help          Show this help
`.trim();

const IMPORT_HELP = `
agentdocstore import — restore from an archive

Usage: agentdocstore import <file.tgz> [options]

Options:
  --data <dir>    Target data directory (default: ~/.agentdocstore/data)
  --force         Overwrite a non-empty data directory
  --help          Show this help
`.trim();

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  command: string;
  flags: CliFlags;
  positional: string[];
  help: boolean;
  version: boolean;
  force: boolean;
}

/**
 * Parse CLI arguments into a structured form. Pure function (no side effects)
 * for testability.
 */
export function parseCli(argv: string[]): ParsedArgs {
  // First positional is the subcommand.
  const subcommandIdx = argv.findIndex((a) => !a.startsWith('-'));
  const command = subcommandIdx >= 0 ? argv[subcommandIdx]! : '';
  const rest =
    subcommandIdx >= 0
      ? [...argv.slice(0, subcommandIdx), ...argv.slice(subcommandIdx + 1)]
      : [...argv];

  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string', short: 'H' },
      data: { type: 'string', short: 'd' },
      auth: { type: 'string', short: 'a' },
      ephemeral: { type: 'boolean', short: 'e' },
      config: { type: 'string', short: 'c' },
      force: { type: 'boolean', short: 'f' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      offline: { type: 'boolean' },
      networked: { type: 'boolean' },
      expose: { type: 'boolean' },
      provider: { type: 'string' },
      'provider-options': { type: 'string' },
      user: { type: 'string' },
      tokens: { type: 'string' },
      'trusted-header': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });

  const flags: CliFlags = {};
  if (values.port !== undefined) {
    const p = parseInt(values.port as string, 10);
    if (!Number.isNaN(p)) flags.port = p;
  }
  if (values.host !== undefined) flags.host = values.host as string;
  if (values.data !== undefined) flags.dataDir = values.data as string;
  if (values.auth !== undefined) {
    const a = values.auth as string;
    if (a === 'single-user' || a === 'trusted-header' || a === 'token') {
      flags.auth = a;
    }
  }
  if (values.ephemeral === true) flags.ephemeral = true;
  if (values.config !== undefined) flags.configFile = values.config as string;

  // Runtime mode. --offline is the default, so it only matters as an explicit
  // override of a config file that says networked. --networked wins if both are
  // passed: opting out of offline is deliberate, and a contradictory pair is
  // most likely a script appending a flag.
  if (values.networked === true) flags.mode = 'networked';
  else if (values.offline === true) flags.mode = 'offline';

  if (values.expose === true) flags.expose = true;
  if (values.provider !== undefined) flags.provider = values.provider as string;
  if (values['provider-options'] !== undefined) {
    flags.providerOptions = parseProviderOptions(
      values['provider-options'] as string,
      '--provider-options',
    );
  }
  if (values.user !== undefined) flags.user = values.user as string;
  if (values.tokens !== undefined) flags.tokensFile = values.tokens as string;
  if (values['trusted-header'] !== undefined) {
    flags.trustedHeader = values['trusted-header'] as string;
  }

  return {
    command,
    flags,
    positional: positionals as string[],
    help: values.help === true,
    version: values.version === true,
    force: values.force === true,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = parseCli(process.argv.slice(2));

  // --version at top level
  if (parsed.version) {
    console.log(getVersion());
    return;
  }

  // --help at top level (or no command)
  if (parsed.command === '' || (parsed.help && parsed.command === '')) {
    console.log(MAIN_HELP);
    return;
  }

  // Per-subcommand --help
  if (parsed.help) {
    switch (parsed.command) {
      case 'serve':
        console.log(SERVE_HELP);
        return;
      case 'mcp':
        console.log(MCP_HELP);
        return;
      case 'doctor':
        console.log(DOCTOR_HELP);
        return;
      case 'init-provider':
        console.log(INIT_PROVIDER_HELP);
        return;
      case 'export':
        console.log(EXPORT_HELP);
        return;
      case 'import':
        console.log(IMPORT_HELP);
        return;
      default:
        console.log(MAIN_HELP);
        return;
    }
  }

  // init-provider needs no config: it writes files and touches no store.
  if (parsed.command === 'init-provider') {
    const name = parsed.positional[0];
    if (name === undefined) {
      console.error('Usage: agentdocstore init-provider <name>');
      process.exit(1);
    }
    const { runInitProvider } = await import('./init-provider.js');
    const result = runInitProvider(name);
    console.log(`Created ${result.dir}`);
    for (const f of result.files) console.log(`  ${f}`);
    console.log(
      '\nNext: implement the TODOs in src/index.ts, then run `npm test` for the ' +
        'full conformance suite and `npm run doctor` for a live smoke check.',
    );
    return;
  }

  // Resolve config.
  const env = process.env as Record<string, string | undefined>;
  const config = resolveConfig(parsed.flags, env, DEFAULT_DATA_DIR);

  switch (parsed.command) {
    case 'serve': {
      const { runServe } = await import('./serve.js');
      await runServe(config);
      break;
    }
    case 'mcp': {
      const { runMcp } = await import('./mcp-cmd.js');
      await runMcp(config);
      break;
    }
    case 'doctor': {
      const { runDoctor } = await import('./doctor.js');
      const code = await runDoctor(config);
      process.exit(code);
      // `process.exit` does not return, but leaving the case open would fall
      // through into `export` the moment that call is ever changed.
      break;
    }
    case 'export': {
      const file = parsed.positional[0];
      if (file === undefined) {
        console.error('Usage: agentdocstore export <file.tgz>');
        process.exit(1);
      }
      const { runExport } = await import('./archive.js');
      runExport(file, config.dataDir);
      break;
    }
    case 'import': {
      const file = parsed.positional[0];
      if (file === undefined) {
        console.error('Usage: agentdocstore import <file.tgz>');
        process.exit(1);
      }
      const { runImport } = await import('./archive.js');
      runImport(file, config.dataDir, parsed.force);
      break;
    }
    default:
      console.error(`Unknown command: ${parsed.command}\n`);
      console.log(MAIN_HELP);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  // An OfflineViolationError carries the way forward — printing only the message
  // would tell the operator what was refused but not what to do about it.
  if (err instanceof OfflineViolationError && err.remedy !== undefined) {
    console.error(`       ${err.remedy}`);
  }
  process.exit(1);
});
