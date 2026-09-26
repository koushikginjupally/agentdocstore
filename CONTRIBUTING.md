# Contributing to AgentDocStore

## Prerequisites

- **Node.js >= 20** (`.nvmrc` recommends 24; any 20 or newer works).
- npm (ships with Node).
- Optional: `docker` for container builds; `jq` for richer verify output.

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md),
not through an issue or pull request.

## Development workflow

1. Fork the repository and create a focused branch from `main`.
2. Install with `npm ci`; do not create per-package lockfiles.
3. Make the smallest coherent change and add tests that would fail without it.
4. Run `npm run build`, `npm test`, and `npm run lint`.
5. For cross-surface, provider, auth, storage, or offline changes, also run
   `npm run verify` (Docker-dependent checks may skip when Docker is absent).
6. Update user-facing docs and `CHANGELOG.md` when behavior changes.
7. Open a pull request using the template. Explain compatibility, migrations,
   security impact, and which checks actually ran.

Draft pull requests are welcome. Keep unrelated refactors out of a functional
change so reviewers can see the behavior clearly.

## Repository structure

This is an **npm workspaces monorepo**. The root `package.json` declares
`"workspaces": ["packages/*"]`. There is exactly one lockfile, at the root.
Do not create per-package lockfiles.

```
packages/
  core/             # Domain model, SPI interfaces, scanner, diff, id gen
  provider-fs/      # Filesystem storage backend
  provider-memory/  # In-memory backend (tests + --ephemeral mode)
  provider-tests/   # 59-case conformance suite (exported for fork use)
  server/           # Hono HTTP server: REST + static UI + MCP-over-HTTP
  mcp/              # MCP tool implementations + stdio entry point
  web/              # Frontend (vanilla TS, esbuild bundle, zero frameworks)
  cli/              # `agentdocstore` CLI: serve | mcp | export | import
```

### Dependency graph

```
core  ←  provider-memory
      ←  provider-fs
      ←  provider-tests  ←  (both providers' test files)
      ←  server
      ←  mcp  ←  cli
web   (standalone esbuild bundle, no server-side import)
```

## Build

```bash
npm ci                # install (use ci for reproducible builds)
npm run build         # clean output, type-check/compile packages, bundle the web UI
```

TypeScript is configured as a **solution file** (`tsconfig.json` at root with
`files: []` + `references`), so `tsc -b` compiles the package graph in dependency
order. The root build first runs `scripts/clean.mjs`; this prevents renamed or
deleted source files from surviving as stale publishable output.

The `web` package has its own esbuild step (`node packages/web/build.mjs`) that
bundles the frontend into `packages/web/dist/`. Its normal build is minified and
omits source maps; use `npm run build:dev --workspace @agentdocstore/web` for an
unminified bundle with source maps.

## Test

```bash
npm test              # vitest run (all packages)
```

Tests live next to the source files (`*.test.ts`). The conformance suite in
`provider-tests` is imported by both `provider-fs` and `provider-memory` — if
you add a new contract clause, both providers are tested automatically.

### Running a subset

```bash
npx vitest run packages/core          # just core
npx vitest run packages/server        # just server
npx vitest run -t "credential"        # by test name
```

## Lint

```bash
npm run lint           # eslint . && prettier --check .
npm run lint:fix       # eslint . --fix && prettier --write .
```

ESLint is configured in `eslint.config.js` (flat config) and handles
**correctness only**; Prettier owns formatting, and `eslint-config-prettier` is
applied last so the two can never disagree about a style question.

Type-aware rules (`no-floating-promises`, `no-misused-promises`,
`await-thenable`, `return-await`) are enabled, but the `no-unsafe-*` family from
`recommendedTypeChecked` is deliberately **not**: provider options, JSON request
bodies and MCP tool arguments all legitimately arrive as `unknown` and are
narrowed by validators.

Type information comes from `tsconfig.lint.json`, not the package tsconfigs —
those `exclude` `*.test.ts` so the build never emits tests, and a type-aware
rule cannot lint a file belonging to no project. `tsc -b` remains the authority
on types; that config exists only to give the linter a type graph.

Prettier does not reformat code blocks inside markdown
(`embeddedLanguageFormatting: "off"`), because the docs use hand-aligned
samples. `VERIFICATION.md` is prettier-ignored since `scripts/verify.sh`
regenerates it.

## Verify (the full success-criteria suite)

```bash
npm run verify        # or: bash scripts/verify.sh
```

This runs all 15 success criteria (S1–S15) and writes `VERIFICATION.md` at the
repo root. Some criteria exercise the CLI and Docker — if those aren't built
yet, the relevant checks SKIP gracefully. Set `AGENTDOCSTORE_SKIP_DOCKER=1` to
run every non-container criterion without rebuilding Docker images or cache.

### Air-gap test

```bash
scripts/airgap-test.sh              # build the image, then run it air-gapped
scripts/airgap-test.sh --no-build   # reuse an existing image
```

Runs the container under `docker run --network none` and executes
`scripts/airgap-probe.mjs` inside it — 25 checks covering the REST surface, web
UI, stdio MCP and the network fuse. It is also criterion S15.

Read the probe's header comment before changing it: in an air-gapped container
every outbound attempt fails anyway, so the probe proves the fuse by requiring
an `OfflineViolationError` while armed and a _transport_ error for the same call
after `release()`. Asserting only "the request failed" would pass with the fuse
deleted. SKIPs (exit 2) when docker is unavailable.

## Code style

- **ESM only.** All relative imports end in `.js` even though sources are `.ts`.
- **TypeScript strict mode.** No `any` without a comment explaining why.
- **Typed errors.** Throw `VersionConflictError`, `NotFoundError`,
  `ValidationError`, or `ContentTooLargeError` from `@agentdocstore/core` — never
  bare `Error`.
- **Authorization lives in core.** Call `assertCanRead`, `assertCanWrite`, etc.
  from `@agentdocstore/core` rather than reimplementing visibility checks.
- **IDs validated before use.** Every user-supplied id must pass `isValidId()`
  before it reaches a filesystem path or store key. This is the primary
  path-traversal defence.

## Adding a provider

1. Create `packages/provider-<name>/`.
2. Implement the `Provider` interface from `@agentdocstore/core`.
3. Add a conformance test:
   ```ts
   import { runProviderConformance } from '@agentdocstore/provider-tests';
   runProviderConformance('your-provider', async () => {
     const provider = await createYourProvider(/* test opts */);
     return { provider, cleanup: () => provider.close() };
   });
   ```
4. All 59 cases must pass. The conformance suite is the contract.

## Decisions

Non-trivial choices are recorded in [docs/DECISIONS.md](docs/DECISIONS.md). Append to
it (never rewrite) when making a choice that a future contributor would
question.

## Commit conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(core): add expiry sweep for non-TTL providers
fix(server): handle malformed JSON body gracefully
docs: add reverse-proxy recipe to HOSTING.md
```

## What NOT to do

- Do not add a dependency that is not on the public npm registry.
- Do not add runtime network egress (telemetry, CDN, external fonts). The
  network fuse and the air-gap test exist to keep this true.
- Do not create per-package lockfiles.
- Do not modify root config files unless the change is needed for all packages.
