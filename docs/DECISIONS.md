# Decisions

Non-trivial choices made while building AgentDocStore, grouped by area. Append
to this file — do not rewrite history — when you make a choice a future
contributor would question.

## Toolchain

- **Node >= 20 required; `.nvmrc` recommends 24.** Strict ESM and `NodeNext`
  resolution need it. CI tests 20, 22 and 24.
- **`packages/core/tsconfig.json` extends `tsconfig.base.json`** rather than inlining its
  compiler options. The inlined version omitted `composite: true`, which TypeScript
  requires of any project referenced by another (`error TS6306`), so `tsc -b` could not
  build the graph. Now consistent with every other package.
- **Root `tsconfig.json` is a solution file** (`files: []` + `references`) so `tsc -b`
  builds all 8 packages in dependency order.

## Dependencies

- **`diff` for the diff engine, `hono` + `@hono/node-server` for HTTP, `marked` +
  `dompurify` + `jsdom` for markdown rendering/sanitization, `minisearch` for the core
  search fallback, `nanoid` for ids** — all small, widely used, and on the public npm registry.

## Repository hygiene

- **Default branch is `main`.**
- **`runs.json` and `.kiro/` are ignored.** Both are autonomous-agent runner artifacts,
  not project source.
- **No nested per-package lockfiles.** An npm workspaces monorepo has exactly one
  lockfile, at the root; a stray `packages/core/package-lock.json` was removed.

- **All advisories resolved; the audit is clean.** `npm audit` reports **0
  vulnerabilities**. Getting there took correcting a misdiagnosis worth recording:
  four earlier attempts to bump `vitest` failed with `ERESOLVE`, and the cause was
  read as the installed `vitest@2.1.9` blocking `vite`'s peer range. It was not.
  With `node_modules` and the lockfile both removed the real conflict was plain:
  `vitest@5` peer-requires `@types/node@22`, while the root pinned `^20.14.0`. The
  `vite` line in the earlier output was a downstream symptom. Bumping
  `@types/node` to `^22.0.0` resolved it immediately.
  Three dependency changes, each a major, each verified against the full suite:
  - `vitest` `^2.1.0` → `^5.0.0` — clears the `@vitest/mocker` path traversal, the
    `vite` path traversal, and the critical arbitrary-file-read-and-execute.
  - `diff` `^7.0.0` → `^9.0.0` — clears the jsdiff `parsePatch`/`applyPatch` DoS.
    This one mattered most: `diff` is a **runtime** dependency of `core` and ships
    in the artifact. Our diff engine only calls `createTwoFilesPatch`, so the
    vulnerable functions were never reachable, but a shipped dependency with a
    known advisory is not worth carrying. `diff@9` bundles its own type
    declarations, so the separate `@types/diff` devDependency was removed.
  - `esbuild` → `^0.28.0` — clears the dev-server request-read advisory. Only used
    for bundling; its dev server is never run.
    389 tests across 11 files still pass and `tsc -b` is clean on all three.

- **`@agentdocstore/core` and `@agentdocstore/provider-tests` are publishable; the
  other six stay private.** `docs/PROVIDERS.md` tells a fork to depend on
  `@agentdocstore/provider-tests` to validate its own provider against the
  conformance suite, which a private package cannot satisfy — the documented
  workflow and the packaging contradicted each other. Both packages now carry a
  `files` allowlist (`dist`, excluding sourcemaps), `publishConfig.access:
public`, a description, license, keywords and an `engines.node` floor.
  `provider-tests` additionally excludes `dist/self-check.*`, so consumers get the
  suite without the throwaway reference provider that exists only to prove the
  suite passes against a correct implementation.
  **`vitest` is a `peerDependency` of `provider-tests`, not a dependency.** This is
  a correctness requirement, not packaging preference: `conformance.ts` imports
  `describe`/`it`/`expect` from `vitest` at runtime, and those must resolve to the
  same vitest instance that is executing the consumer's test run. Declared as a
  regular dependency, a published copy could resolve its own duplicate and
  register cases into a runner that never runs them — the suite would silently
  pass by doing nothing.
  Constraint C8 (never publish from this build) is unchanged: these packages are
  now _publishable_, and nothing has been published.

## Documentation & Verification

- **S1 reports the run summary, not the last per-file line.** The original
  extraction (`grep -oP '\d+ tests?' | tail -1`) matched the final `(57 tests)`
  file heading and under-reported a 389-test run by roughly six times. It now
  reads the `Tests N passed` / `Test Files N passed` summary lines.
- **S6 checks dependency provenance; the term audit is opt-in.** Every
  lockfile entry must resolve from `registry.npmjs.org`. A fork that also wants
  to assert certain strings never appear in the tree supplies its own regex via
  `AGENTDOCSTORE_FORBIDDEN_TERMS` or a git-ignored `.forbidden-terms` file, so the
  public repository does not carry anyone's private term list. The audit reads
  tracked and not-yet-committed files through `git grep`, so ignored local files
  cannot fail it.
- **S3 oversized-write test uses a temp file.** A 5 MB+ JSON payload exceeds
  bash's argument-length limit when passed as `curl -d "$VAR"`. The test writes
  the payload to a temp file via Python's `json.dumps` and uses `curl -d @file`.
- **S7 offline audit scopes to `src=`, `href=`, `url(` patterns only.** Bare
  URLs in comments and XML namespace declarations (e.g. `http://www.w3.org/2000/svg`)
  are not fetched at runtime and are excluded.
- **S8 asserts on the `HTML_IFRAME_SANDBOX` constant, not on markup.** The
  sandbox attribute is applied programmatically via `setAttribute` in `render.ts`,
  so grepping for `sandbox="..."` in HTML would miss it.

## Runtime modes, provider loading, and MCP identity

- **Offline is the default and you opt out; `offline` is enforced, not
  advisory.** A mode that only warns is a mode nobody verifies. A non-loopback
  bind and a provider declaring `requiresNetwork` are both hard startup
  failures, and `scripts/verify.sh` S11 asserts the refusal rather than trusting
  the documentation.
- **Inbound exposure and outbound egress are SEPARATE switches
  (`--expose` vs `--networked`).** The first implementation conflated them and
  broke the Docker image, which must bind `0.0.0.0` to be port-mapped: the
  container was refused at startup, and the S9 Docker health check caught it.
  Binding every interface inside a container's own network namespace is inbound
  exposure and says nothing about egress, so `--expose` waives only the host
  clause while the provider clause and the fuse stay in force. The shipped `CMD`
  therefore runs `--expose` and remains offline, which is a stronger posture than
  `--networked` would have been.
- **The network fuse patches `net.Socket.prototype.connect` rather than each
  client.** That is the single chokepoint http, https, undici and database
  drivers all pass through, and TLS sockets inherit it; `globalThis.fetch` is
  patched too, purely for a better error message. Unix sockets, `server.listen()`
  and loopback destinations are deliberately permitted — a unix socket cannot
  leave the machine, and serving the operator's own browser is the point of the
  program. Documented as a guard rail, not a sandbox: `child_process` and raw
  `dgram` remain reachable, so a hard guarantee is a container with no network
  interface.
- **`requiresNetwork` is a provider-declared capability, not inferred.** There is
  no way to detect a store's reachability from outside it, so the provider
  declares it and the loader refuses a provider that omits it — offline cannot be
  enforced against an undeclared value. A conformance case asserts the whole
  descriptor is typed.
- **Third-party providers resolve from the OPERATOR's CWD
  (`createRequire(join(cwd,'package.json'))`), not from AgentDocStore's
  `node_modules`.** This is what makes a store installable instead of
  fork-only: `npm install` next to the app, then name it in config. Plain
  `import()` is the fallback so workspace links and file URLs still work.
- **`doctor` implements its own runner-free smoke checks instead of executing the
  vitest suite.** Running the conformance suite programmatically would require vitest
  in every install and a generated temp test file. The smoke subset covers the
  clauses that corrupt data silently (CAS, immutability, pagination, PRIVATE
  search isolation, size limits, expiry, cascade), and the command prints how to
  run the authoritative suite. Documented explicitly as necessary-not-sufficient
  so nobody mistakes a green doctor for full conformance.
- **`/mcp` shares ONE `IdentityProvider` with the REST routes**
  (`resolveIdentityProvider` is now exported from the server package). The prior
  code hard-coded `getViewer: () => 'local-user'`, so every MCP caller was the
  same synthetic user and `/mcp` bypassed the auth mode entirely while reaching
  the same provider — the PRIVATE-document isolation that S5 proves for REST did not
  hold there. Identity is now resolved per REQUEST (not per session, so a revoked
  credential stops working), a session is bound to the identity that opened it
  (403 on reuse by another identity, because a leaked `mcp-session-id` is not a
  login), and an unauthenticated caller gets 401 with no fallback user. S13
  asserts all three end to end.
- **stdio MCP identity defaults to the OS login, not `local-user`.** The old
  default meant a document created through stdio MCP was owned by `local-user` while
  the web UI on the same data directory showed the OS user — the same store with
  two disjoint owners, and neither could see the other's documents. `--user` /
  `AGENTDOCSTORE_USER` still overrides.
- **`--auth token` now requires `--tokens <file>` and refuses an empty map.**
  `buildAuthMode` previously passed `tokens: {}`, so token mode rejected every
  caller: a misconfiguration that presented as a broken server. Startup fails with
  the path named.

## Lint and formatting

- **ESLint 10 flat config, correctness rules only; Prettier owns formatting.**
  `eslint-config-prettier` is applied last so the two tools can never disagree
  about a style question. ESLint 9 was installed first and npm reported it as
  no longer supported, so the dependency is on the 10.x line.
- **Type-aware linting is opt-in per rule, NOT the `recommendedTypeChecked`
  preset.** That preset's `no-unsafe-*` family fires constantly here by design:
  provider options, JSON request bodies and MCP tool arguments all arrive as
  `unknown` and are narrowed by validators, so "unsafe" is the correct reading
  and silencing it would need suppressions everywhere. The four rules enabled
  instead (`no-floating-promises`, `no-misused-promises`, `await-thenable`,
  `return-await`) find real defects, and did: every `process.on('SIG*', async
…)` handler and the expiry-sweep `setInterval(async …)` discarded a promise,
  so a throw during shutdown or a sweep became an unhandled rejection rather
  than a clean exit.
- **`tsconfig.lint.json` exists solely to give the linter a type graph.** The
  package tsconfigs `exclude` `**/*.test.ts` (a build must not emit tests), and
  a type-aware rule cannot lint a file that belongs to no project. The lint
  config is a deliberate union — DOM + ES2022 libs, node types, workspace
  `paths` pointing at source — because `tsc -b` remains the authority on types:
  `web` still compiles with `types: []`, so a stray `process` reference in
  frontend code is still caught by the build.
- **Async DOM handlers go through `runGuarded` / `onClick` (`web/src/dom.ts`).**
  `addEventListener` discards the promise an `async` listener returns, so a
  rejection inside a click handler became an unhandled rejection and the user
  saw a button that did nothing. The helper reports via toast plus
  `console.error`; four tests in `web.test.ts` pin it, and they fail if the
  guard's `catch` is removed.
- **Prettier does not format code blocks inside markdown**
  (`embeddedLanguageFormatting: "off"`). The default reformatted the docs'
  hand-aligned SPI samples and rewrapped signatures, which made them harder to
  read, not easier. Markdown prose, lists and tables are still normalized.
- **`VERIFICATION.md` is prettier-ignored.** `scripts/verify.sh` regenerates it
  on every run, so a formatter fighting a generator would make `npm run lint`
  fail for a change nobody made.
- **Formatting adoption was committed separately from the tooling.** Prettier
  reformatted 56 existing files; keeping that churn out of the commit that adds
  the configs and fixes the 38 lint findings keeps both reviewable.

## Air-gap verification

- **The offline claim is tested behaviourally, in a container with no network
  interface** (`scripts/airgap-test.sh` -> `docker run --network none`, S15).
  S7 greps the built bundle for external references, which cannot catch a
  dependency that opens a socket at runtime. `unshare -rn` was the first choice
  and is unavailable in a sandboxed session (`Operation not permitted`), so a
  container namespace is the portable way to create an air gap on demand.
- **The probe discriminates on WHICH error arrives, not on failure.** In an
  air-gapped container every outbound attempt fails, so asserting "the request
  failed" would pass with the fuse deleted. So the probe requires an
  `OfflineViolationError` while the fuse is armed, releases the fuse, and
  requires the SAME call to then fail with a transport error (`EAI_AGAIN`). The
  first shows the fuse intercepting; the second shows the air gap is real. A
  successful fetch after release would mean the container is not isolated and is
  reported as such rather than silently passing.
- **Three egress paths are probed separately** — `fetch()`, `net.connect()`, and
  `http.get()` — because they reach the socket by different routes and a patch
  on `fetch` alone covers almost nothing real.
- **The fuse had a real hole, and this test is what found it.** `net.connect()`
  (used by `http`, `https`, undici and every database driver) does not forward
  its arguments: it normalizes them and calls
  `Socket.prototype.connect([options, cb])`, passing the ARRAY as a single
  argument. `connectTargetHost` read `.host` off the array, found nothing,
  concluded "localhost" and ALLOWED the connection. Only the hand-written
  `new Socket().connect(port, host)` form was ever fused — which is the one form
  the unit tests used, so the suite stayed green while egress from any real
  library went straight through. Fixed by unwrapping the normalized array
  (depth-capped, so a self-referential array cannot loop), with unit tests for
  every call shape; five of them fail on the pre-fix code.
- **S15 reuses S9's Docker image instead of building its own.** S9 no longer
  deletes the image; S15 runs it `--network none` and removes it afterwards. A
  second build would mean a second `npm ci` inside Docker for no benefit.

## Reproducible generated output

- **The root build always cleans every package output directory before `tsc -b`.**
  TypeScript incremental builds do not reliably remove JavaScript emitted for a
  source file that was later renamed; without the clean step, stale modules can
  leak into Docker images and npm tarballs even when source tests pass.
- **The normal web build is production output.** It minifies the bundle and emits
  no source maps. `build:dev` is the explicit unminified, source-mapped variant.
  Docker and CI both invoke the root build, so they cannot accidentally package
  an old frontend bundle.
