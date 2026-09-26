# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0, minor
versions may contain breaking changes; they will be called out under
**Changed**.

## [Unreleased]

## [0.1.0] - 2026-09-26

First public release.

### Added

- Versioned documents with immutable history and unified diffs between any two
  versions.
- 18 content languages, rendered in the web UI: sanitized Markdown, strict
  Mermaid, sandboxed HTML, JSON pretty-print, and syntax-highlighted code.
- Comment threads with resolve and unresolve.
- `PUBLIC` / `PRIVATE` visibility, enforced on every surface; a hidden document is
  indistinguishable from a missing one.
- Optional expiry with an automatic sweep.
- Credential scanner covering PEM/OpenSSH keys, AWS keys, JWTs, bearer tokens,
  GitHub, GitLab and Slack tokens, connection-string passwords and generic
  secret assignments, with a detect → redact-or-skip write handshake.
- REST API (16 routes plus `/raw/:id`) and a web UI with no external assets.
- MCP server with 16 tools over stdio and streamable HTTP.
- Authentication modes: `single-user`, `trusted-header`, `token`. Identity is
  resolved per request on REST and MCP, and MCP sessions are bound to the
  identity that opened them.
- Enforced offline mode: loopback-only by default, `--expose` for inbound,
  `--networked` for egress, and a network fuse on `net.Socket#connect` and
  `fetch`.
- Storage provider SPI, filesystem and in-memory providers, and
  `@agentdocstore/provider-tests`, a 59-case conformance suite.
- Installable providers resolved from the working directory, with
  `agentdocstore doctor` and `agentdocstore init-provider`.
- `agentdocstore export` / `import` for data-directory archives.
- Docker image (Alpine, non-root), Compose file and systemd recipe.
- `scripts/verify.sh` end-to-end harness and `scripts/airgap-test.sh`, which
  runs the application with no network interface.

### Known issues

- `PUT /api/documents/:id` applies title, language, expiry and visibility changes
  **before** it scans new content, so a request rejected with `409` for
  credentials may still have changed metadata.
- `editMessage` is accepted on update but not stored.
- `capabilities.atomicVersioning: false` is reported but does not yet make core
  serialize writes; providers must implement compare-and-set themselves (the
  conformance suite requires it).
- `agentdocstore doctor` runs a smoke subset of the conformance suite; run the
  full suite from your provider's test script.
- The network fuse does not cover `child_process` or raw `dgram`; use a
  container without a network for a hard guarantee.
- `trusted-header` mode is tested with synthetic headers, not against a real
  reverse proxy.

[Unreleased]: https://github.com/koushikginjupally/agentdocstore/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/koushikginjupally/agentdocstore/releases/tag/v0.1.0
