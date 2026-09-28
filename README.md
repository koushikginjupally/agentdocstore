<div align="center">

# AgentDocStore

**A self-hostable, offline-first document and artifact store — with a web UI, a REST
API, and a first-class MCP server for AI assistants.**

[![CI](https://github.com/koushikginjupally/agentdocstore/actions/workflows/ci.yml/badge.svg)](https://github.com/koushikginjupally/agentdocstore/actions/workflows/ci.yml)
[![Plugin scan](https://github.com/koushikginjupally/agentdocstore/actions/workflows/plugin-scan.yml/badge.svg)](https://github.com/koushikginjupally/agentdocstore/actions/workflows/plugin-scan.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&logoColor=white)](tsconfig.base.json)
[![MCP: 16 tools](https://img.shields.io/badge/MCP-16%20tools-7C5CFF.svg)](docs/MCP.md)
[![Egress: fused](https://img.shields.io/badge/egress-fused%20by%20default-success.svg)](docs/SECURITY.md#runtime-modes-offline-is-enforced-not-documented)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Quickstart](#quickstart) ·
[Features](#features) ·
[Architecture](#architecture) ·
[MCP](#use-it-from-an-ai-assistant-mcp) ·
[Bring your own store](#bring-your-own-data-store) ·
[Docs](#documentation) ·
[Contributing](#contributing)

</div>

---

AgentDocStore stores versioned text artifacts — **documents** — and renders them:
Markdown, Mermaid diagrams, syntax-highlighted code, sandboxed HTML. Every edit
is an immutable version you can diff. Secrets are caught before they are saved.
AI assistants get the whole feature set through 16 MCP tools, over stdio with no
server running at all.

It is built around one promise: **nothing leaves your machine unless you say
so.** Offline is the default, and it is _enforced_ — the process refuses to
open outbound sockets, not merely declines to.

```console
$ npx agentdocstore serve
▸ mode=offline · provider=fs · auth=single-user · egress=fused · inbound=loopback
AgentDocStore ready at http://127.0.0.1:8787
```

## Table of contents

- [Why AgentDocStore](#why-agentdocstore)
- [Features](#features)
- [Quickstart](#quickstart)
- [Use it from an AI assistant (MCP)](#use-it-from-an-ai-assistant-mcp)
- [Architecture](#architecture)
- [Runtime modes](#runtime-modes)
- [Authentication](#authentication)
- [Bring your own data store](#bring-your-own-data-store)
- [Configuration](#configuration)
- [CLI reference](#cli-reference)
- [REST API at a glance](#rest-api-at-a-glance)
- [Deployment](#deployment)
- [Security](#security)
- [Development](#development)
- [Project status and roadmap](#project-status-and-roadmap)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Why AgentDocStore

Document-sharing services are where design notes, diagrams, logs and snippets end up — and,
too often, API keys. Hosted services send all of it to someone else's server.
AI assistants make this worse: they produce artifacts constantly and have no
good place to put them.

AgentDocStore is the local alternative:

| You want                               | AgentDocStore gives you                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| A place for AI output that you control | 16 MCP tools; stdio mode needs no server, no port, no account            |
| Confidence nothing is sent anywhere    | Offline by default, with a runtime **network fuse** and an air-gap test  |
| No accidental secret leaks             | A credential scanner that blocks the write until you choose redact/skip  |
| History, not overwrites                | Immutable versions with unified diffs between any two                    |
| Your database, not ours                | A storage SPI + 60-case conformance kit; install a provider with `npm i` |
| Something a team can share             | Reverse-proxy SSO and bearer-token auth, PRIVATE/PUBLIC visibility       |

## Features

**Content**

- **18 languages** — Markdown (sanitized), Mermaid (`securityLevel: strict`),
  HTML (sandboxed iframe), JSON (pretty-print toggle), and syntax-highlighted
  JavaScript, TypeScript, Python, Java, Go, Rust, YAML, XML, CSS, SQL, Bash,
  Dockerfile, plain text.
- **Immutable versioning** — every update appends a version; compare any two as
  a unified diff.
- **Comments** — a thread per document, with resolve/unresolve.
- **Visibility** — documents default to `PUBLIC` (readable by any authenticated
  user); `PRIVATE` documents are owner-only on _every_ surface: read, raw,
  comments, list, search, and MCP. A denied read returns 404, so privacy does
  not leak existence.
- **Expiry** — optional per-document TTL, swept automatically.
- **Full-text search** — local, persisted index; no search service.

**Safety**

- **Credential scanner** — PEM/OpenSSH keys, AWS keys, JWTs, bearer tokens,
  GitHub/GitLab/Slack tokens, connection-string passwords and generic
  `password=` assignments. A write containing one is rejected with `409` and
  the detected types; you retry with `redact` or `skip`.
- **Enforced offline mode** — loopback-only bind, local-only providers, and a
  fuse on `net.Socket#connect` and `fetch` that refuses non-loopback egress.
- **Write-time size limits** — oversized content is rejected (`413`), never
  stored and failed later.
- **Hardened rendering** — DOMPurify-sanitized markdown, a locked-down HTML
  sandbox, `nosniff` on every response, a strict CSP on API and raw responses,
  path-traversal-proof ids. (The web UI page itself has no CSP yet; see
  [docs/SECURITY.md](docs/SECURITY.md).)

**Surfaces**

- **Web UI** — vanilla TypeScript, one bundle, zero external assets, dark and
  light themes.
- **REST API** — 15 JSON routes plus `/raw/:id` for plain text.
- **MCP server** — 16 tools over **stdio** and **streamable HTTP**, sharing one
  implementation.
- **CLI** — `serve`, `mcp`, `doctor`, `init-provider`, `export`, `import`.

**Extensibility**

- **Storage SPI** with filesystem and in-memory providers built in.
- **Installable providers** — resolved from _your_ working directory, validated
  with a schema at boot, checked by `agentdocstore doctor`.
- **Conformance kit** — `@agentdocstore/provider-tests`, 60 cases any store must
  pass.

## Quickstart

**Prerequisites:** Node.js 22 or newer. Docker is optional.

```bash
npx agentdocstore serve                 # persistent, stored in ~/.agentdocstore/data
npx agentdocstore serve --ephemeral     # in-memory, gone on exit
```

`npx` fetches the `agentdocstore` package from npm when it starts. On a machine
without network access, install it once with `npm install -g agentdocstore` and
run `agentdocstore serve`. To work on AgentDocStore itself, build it from a clone
(`.nvmrc` pins Node 24):

```bash
git clone https://github.com/koushikginjupally/agentdocstore.git
cd agentdocstore
npm ci
npm run build
npx agentdocstore serve                 # runs this clone's build
```

Open <http://127.0.0.1:8787>. Or use the API directly:

```bash
# Create a document
curl -s localhost:8787/api/documents -H 'content-type: application/json' \
  -d '{"title":"hello","language":"markdown","content":"# Hello, **world**"}'
# → {"id":"IUvM8uKYcE","visibility":"PUBLIC","latestVersion":1,...}

# Read it back as plain text
curl -s localhost:8787/raw/IUvM8uKYcE
```

What the credential scanner does with a secret:

```bash
curl -s localhost:8787/api/documents -H 'content-type: application/json' \
  -d '{"title":"cfg","language":"yaml","content":"password: hunter2hunter2"}'
# → 409 {"detected":["generic-secret"],"options":["redact","skip"]}   (nothing stored)

curl -s localhost:8787/api/documents -H 'content-type: application/json' \
  -d '{"title":"cfg","language":"yaml","content":"password: hunter2hunter2","redactionPolicy":"redact"}'
# → 201, stored as "[REDACTED:generic-secret]"
```

## Use it from an AI assistant (MCP)

The stdio transport embeds the whole application in the MCP process — no HTTP
server, no port, full access to the same data directory the web UI uses.

```json
{
  "mcpServers": {
    "agentdocstore": {
      "command": "npx",
      "args": ["-y", "agentdocstore", "mcp"]
    }
  }
}
```

With a global install (`npm install -g agentdocstore`), use
`"command": "agentdocstore"` and `"args": ["mcp"]` instead: it starts faster and
needs no network.

| Client         | Config file                                                       |
| -------------- | ----------------------------------------------------------------- |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor         | `.cursor/mcp.json`                                                |
| Kiro           | `.kiro/settings/mcp.json`                                         |

Codex can install the repo as a plugin: `.codex-plugin/plugin.json` points at
`.mcp.json`, which starts the release-pinned `npx -y agentdocstore@<version> mcp`.

A running server also exposes MCP at `/mcp` (streamable HTTP), authenticated
exactly like the REST API. The 16 tools:

| Area      | Tools                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------- |
| Documents | `create_document` `read_document` `update_document` `delete_document` `list_documents` `get_raw_document` |
| History   | `get_versions` `diff_document`                                                                            |
| Comments  | `add_comment` `get_comments` `resolve_comment` `unresolve_comment` `delete_comment`                       |
| Safety    | `scan_content` `set_visibility`                                                                           |
| Discovery | `get_help`                                                                                                |

Full input shapes: [docs/MCP.md](docs/MCP.md).

## Architecture

AgentDocStore is an npm-workspaces monorepo. All business rules —
authorization, scanning, versioning, search fallback — live in `core`. Every
transport is a thin adapter over it, and every store sits behind the SPI.

```mermaid
flowchart LR
  subgraph clients["Clients"]
    B["Browser"]
    R["curl / scripts"]
    A1["AI assistant<br/>(stdio)"]
    A2["AI assistant<br/>(HTTP)"]
  end

  subgraph proc["agentdocstore process"]
    CLI["CLI<br/>serve · mcp · doctor"]
    FUSE{{"Network fuse<br/>(offline mode)"}}
    subgraph server["server (Hono)"]
      UI["Static web UI"]
      REST["REST API"]
      MCPH["/mcp"]
      ID["Identity resolver"]
    end
    MCPS["MCP stdio"]
    TOOLS["MCP tool module"]
    subgraph core["core"]
      AZ["AuthZ"]
      SC["Credential scanner"]
      DF["Diff engine"]
      SF["Search fallback"]
      SPI[["Provider SPI"]]
    end
  end

  subgraph stores["Storage providers"]
    FS[("provider-fs")]
    MEM[("provider-memory")]
    YOURS[("your provider<br/>npm i …")]
  end

  B --> UI
  B --> REST
  R --> REST
  A2 --> MCPH
  A1 --> MCPS
  CLI --> server
  CLI --> MCPS
  CLI -. arms .-> FUSE
  REST --> ID
  MCPH --> ID
  MCPH --> TOOLS
  MCPS --> TOOLS
  ID --> AZ
  TOOLS --> AZ
  AZ --> SC
  AZ --> DF
  AZ --> SF
  SC --> SPI
  DF --> SPI
  SF --> SPI
  SPI --> FS
  SPI --> MEM
  SPI --> YOURS
```

### Packages

```mermaid
flowchart BT
  core["@agentdocstore/core<br/><i>domain · SPI · authz · scanner · diff</i>"]
  mem["provider-memory"] --> core
  fs["provider-fs"] --> core
  kit["@agentdocstore/provider-tests<br/><i>conformance kit</i>"] --> core
  srv["server"] --> core
  mcp["mcp"] --> core
  cli["cli<br/><i>agentdocstore binary</i>"] --> srv
  cli --> mcp
  cli --> fs
  cli --> mem
  web["web<br/><i>esbuild bundle</i>"]
  srv -. serves .-> web
```

| Package                          | Role                                                        | npm distribution             |
| -------------------------------- | ----------------------------------------------------------- | ---------------------------- |
| `@agentdocstore/core`            | Domain model, provider SPI, authorization, scanner, diff    | Published on npm             |
| `@agentdocstore/provider-tests`  | Conformance suite for any provider (vitest peer dependency) | Published on npm             |
| `@agentdocstore/provider-fs`     | Filesystem store: atomic writes, lockfile, persisted index  | Ships inside `agentdocstore` |
| `@agentdocstore/provider-memory` | In-memory store for tests and `--ephemeral`                 | Ships inside `agentdocstore` |
| `@agentdocstore/server`          | Hono HTTP server: REST, static UI, MCP-over-HTTP            | Ships inside `agentdocstore` |
| `@agentdocstore/mcp`             | The 16 MCP tools and the stdio transport                    | Ships inside `agentdocstore` |
| `@agentdocstore/web`             | Frontend, vanilla TS, bundled into one file                 | Ships inside `agentdocstore` |
| `agentdocstore`                  | The `agentdocstore` binary and the network fuse             | Published on npm             |

All eight packages are open source in this repository. The distribution column
describes npm packaging, not source availability. The CLI package,
`agentdocstore`, carries the server, the MCP tools, both built-in providers and
the web UI inside it, so those five are not published on their own.

### Writing a document

Every write — REST or MCP — applies the same `core` rules before it reaches a
store:

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant H as REST route / MCP tool
  participant K as core rules
  participant P as Provider

  C->>H: create or update (no redactionPolicy)
  H->>H: resolve identity for this request
  H->>K: validate id, schema, size limit, authorize
  H->>K: scan content for credentials
  alt credentials found
    H-->>C: 409 {detected, options: [redact, skip]}
    Note over C,P: nothing is persisted
    C->>H: same request + redactionPolicy
    H->>K: redact (or keep, for skip)
  end
  H->>P: appendVersion(id, {content, expect: {latestVersion: n}})
  alt another writer got there first
    P-->>H: VersionConflictError
    H-->>C: 409 conflict
  else
    P->>P: write content, then move the pointer
    P-->>H: document at version n+1
    H->>P: search.update(document)
    H-->>C: 200 / 201
  end
```

More diagrams — identity resolution, provider loading, the fuse, the on-disk
layout — are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Runtime modes

Two independent switches. **Egress** is what the process may reach out to;
**exposure** is who may reach in.

```mermaid
flowchart TD
  start(["agentdocstore serve"]) --> m{"--networked?"}
  m -- no --> off["mode = offline<br/>fuse armed: non-loopback connect / fetch throws<br/>providers with requiresNetwork = true refused"]
  m -- yes --> net["mode = networked<br/>egress allowed, remote providers allowed"]
  off --> h{"non-loopback --host?"}
  h -- no --> ok1(["loopback only ✔"])
  h -- "yes + --expose" --> ok2(["reachable, still offline ✔<br/>(the Docker default)"])
  h -- "yes, no --expose" --> bad(["refuses to start ✘<br/>and says which flag to add"])
  net --> ok3(["any bind ✔"])
```

| Command                                       | Inbound       | Outbound | Typical use                    |
| --------------------------------------------- | ------------- | -------- | ------------------------------ |
| `agentdocstore serve`                         | loopback      | fused    | Personal, on your laptop       |
| `agentdocstore serve --host 0.0.0.0 --expose` | any interface | fused    | Docker, LAN behind a proxy     |
| `agentdocstore serve --networked`             | any interface | allowed  | Remote provider (Postgres, S3) |

The banner and `GET /healthz` always report the active mode. The fuse is a
guard rail, not a sandbox: `child_process` and raw UDP are not covered, so for
a hard guarantee run the container with `--network none` —
[`scripts/airgap-test.sh`](scripts/airgap-test.sh) proves the app works that way.

## Authentication

| Mode             | Identity comes from                     | Use when                                     |
| ---------------- | --------------------------------------- | -------------------------------------------- |
| `single-user`    | `--user`, else your OS login            | Default. Just you, on your machine           |
| `trusted-header` | A header set by your reverse proxy      | Team SSO via oauth2-proxy, Authelia, Caddy … |
| `token`          | `Authorization: Bearer` from a JSON map | Remote API, CLI and MCP clients              |

Identity is resolved **per request** on both the REST API and `/mcp`. An MCP
session is bound to the identity that opened it; replaying its session id as
someone else returns `403`. In `trusted-header` mode your proxy **must** strip
the header from client traffic — see [docs/HOSTING.md](docs/HOSTING.md).

```bash
echo '{"s3cr3t-token-for-alice":"alice"}' > tokens.json
npx agentdocstore serve --auth token --tokens tokens.json
curl -H 'authorization: Bearer s3cr3t-token-for-alice' localhost:8787/api/whoami
```

## Bring your own data store

A provider is an ordinary npm package exporting a `ProviderModule`. AgentDocStore
resolves it from **your** working directory, so adding a store needs no fork:

```bash
npm install @acme/agentdocstore-provider-postgres
npx agentdocstore doctor --networked \
  --provider @acme/agentdocstore-provider-postgres \
  --provider-options '{"url":"postgres://localhost/agentdocstore"}'
npx agentdocstore serve --networked --provider @acme/agentdocstore-provider-postgres
```

```mermaid
classDiagram
  direction LR
  class ProviderModule {
    +providerName: string
    +optionsSchema?: OptionsSchema
    +createProvider(options) Promise~Provider~
  }
  class Provider {
    +repository: DocumentRepository
    +comments: CommentStore
    +search: SearchIndex
    +capabilities: Capabilities
    +healthCheck?() Promise~ProviderHealth~
    +close() Promise~void~
  }
  class DocumentRepository {
    +create(input)
    +get(id)
    +getVersion(id, n)
    +listVersions(id)
    +appendVersion(id, input) CAS on expect.latestVersion
    +updateMeta(id, meta)
    +setVisibility(id, visibility)
    +delete(id)
    +listByOwner(owner, query)
    +listExpired(nowIso, limit)
  }
  class CommentStore {
    +add(documentId, input)
    +list(documentId)
    +setResolved(documentId, id, resolved)
    +delete(documentId, id)
  }
  class SearchIndex {
    +add(doc) update(doc) remove(id)
    +query(q, viewer, opts)
    +snapshot() restore(s)
  }
  class Capabilities {
    +search: native | core-fallback
    +nativeTtl: boolean
    +atomicVersioning: boolean
    +requiresNetwork: boolean
  }
  ProviderModule ..> Provider : creates
  Provider *-- DocumentRepository
  Provider *-- CommentStore
  Provider *-- SearchIndex
  Provider *-- Capabilities
```

Capabilities let a simple store stay simple: a store without native search can
return core's MiniSearch-backed index and declare `core-fallback`; a store without
native TTL declares `nativeTtl: false` and core runs the expiry sweep.

**Writing one takes three commands:**

```bash
npx agentdocstore init-provider mystore       # scaffold, conformance suite wired in
npm test                                    # 60 conformance cases
npx agentdocstore doctor --provider ./dist/index.js   # live smoke check
```

The contract — compare-and-set versioning, immutability, opaque cursors,
content-before-pointer commits, visibility in search — is in
[docs/PROVIDERS.md](docs/PROVIDERS.md).

## Configuration

Precedence: **CLI flags › `AGENTDOCSTORE_*` environment › config file ›
defaults.**

```jsonc
// agentdocstore.config.json
{
  "port": 8787,
  "host": "127.0.0.1",
  "dataDir": "/var/lib/agentdocstore",   // absolute path; "~" is not expanded
  "auth": "single-user",            // single-user | trusted-header | token
  "mode": "offline",                // offline | networked
  "expose": false,
  "provider": { "module": "fs", "options": {} },
  "trustedHeader": "x-forwarded-user",
  "tokens": "./tokens.json"
}
```

| Setting         | Flag                        | Environment variable             | Default                 |
| --------------- | --------------------------- | -------------------------------- | ----------------------- |
| Port            | `--port`                    | `AGENTDOCSTORE_PORT`             | `8787`                  |
| Bind address    | `--host`                    | `AGENTDOCSTORE_HOST`             | `127.0.0.1`             |
| Data directory  | `--data`                    | `AGENTDOCSTORE_DATA_DIR`         | `~/.agentdocstore/data` |
| Auth mode       | `--auth`                    | `AGENTDOCSTORE_AUTH`             | `single-user`           |
| Runtime mode    | `--offline` / `--networked` | `AGENTDOCSTORE_MODE`             | `offline`               |
| Inbound expose  | `--expose`                  | `AGENTDOCSTORE_EXPOSE`           | `false`                 |
| Provider        | `--provider`                | `AGENTDOCSTORE_PROVIDER`         | `fs`                    |
| Provider opts   | `--provider-options`        | `AGENTDOCSTORE_PROVIDER_OPTIONS` | `{}`                    |
| User            | `--user`                    | `AGENTDOCSTORE_USER`             | OS login                |
| Token map       | `--tokens`                  | `AGENTDOCSTORE_TOKENS`           | —                       |
| Identity header | `--trusted-header`          | `AGENTDOCSTORE_TRUSTED_HEADER`   | `x-forwarded-user`      |
| Ephemeral       | `--ephemeral`               | `AGENTDOCSTORE_EPHEMERAL`        | `false`                 |
| Config file     | `--config`                  | `AGENTDOCSTORE_CONFIG`           | —                       |

Full reference: [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## CLI reference

| Command                              | What it does                                                     |
| ------------------------------------ | ---------------------------------------------------------------- |
| `agentdocstore serve`                | Web UI + REST API + MCP-over-HTTP                                |
| `agentdocstore mcp`                  | MCP over stdio, embedding the store directly                     |
| `agentdocstore doctor`               | Loads a provider and runs 11 live checks against it              |
| `agentdocstore init-provider <name>` | Scaffolds a provider package with the conformance suite wired in |
| `agentdocstore export <file.tgz>`    | Archives the data directory                                      |
| `agentdocstore import <file.tgz>`    | Restores an archive (`--force` to overwrite)                     |

Every command accepts `--help`. Errors that refuse an action also print the
flag that would allow it.

## REST API at a glance

| Method   | Path                                   | Purpose                                            |
| -------- | -------------------------------------- | -------------------------------------------------- |
| `POST`   | `/api/documents`                       | Create (scan → `409` → retry with a policy)        |
| `GET`    | `/api/documents?query=&cursor=&limit=` | List your documents, or search yours + public ones |
| `GET`    | `/api/documents/:id[?version=N]`       | Read a document, optionally at a version           |
| `PUT`    | `/api/documents/:id`                   | Update content or metadata (appends a version)     |
| `DELETE` | `/api/documents/:id`                   | Delete a document and everything under it          |
| `GET`    | `/api/documents/:id/versions`          | Version history                                    |
| `GET`    | `/api/documents/:id/diff?from=N&to=M`  | Unified diff                                       |
| `GET`    | `/raw/:id[?version=N]`                 | Plain-text content                                 |
| `POST`   | `/api/documents/:id/visibility`        | Set `PUBLIC` / `PRIVATE`                           |
| `*`      | `/api/documents/:id/comments[/:cid]`   | Add, list, resolve, delete comments                |
| `POST`   | `/api/scan`                            | Scan content without storing it                    |
| `GET`    | `/api/whoami` · `/healthz`             | Identity · health, mode and provider               |

Request and response shapes: [docs/API.md](docs/API.md).

## Deployment

**Docker** — the image is Alpine-based, runs as a non-root user, and stays
offline while reachable:

```bash
docker build -t agentdocstore .
docker run -p 8787:8787 -v agentdocstore-data:/data agentdocstore
# or
docker compose up -d
```

**Behind a reverse proxy** with SSO, **systemd** with sandboxing directives,
and **backup/restore** are covered in [docs/HOSTING.md](docs/HOSTING.md).

## Security

- Threat model, trust boundaries and every defence:
  [docs/SECURITY.md](docs/SECURITY.md).
- Found a vulnerability? Please report it privately — see
  [SECURITY.md](SECURITY.md). Do not open a public issue.

## Development

```bash
npm ci
npm run build      # tsc -b across the workspace, plus the web bundle
npm test           # vitest — every package, including 60 conformance cases per provider
npm run lint       # eslint (correctness) + prettier --check (formatting)
npm run verify     # end-to-end harness, writes VERIFICATION.md
scripts/airgap-test.sh   # runs the app with no network interface at all
```

`npm run verify` runs fifteen end-to-end checks: clean build and tests, a live
REST walkthrough, MCP handshake and round-trip, multi-user isolation, bundle
offline audit, HTML sandbox, packaging and Docker, docs, offline-mode refusals,
provider loading, `/mcp` auth, lint, and the air-gap run. Steps that need Docker
skip cleanly without it.

See [CONTRIBUTING.md](CONTRIBUTING.md) for layout, conventions and how to send
a change.

## Project status and roadmap

AgentDocStore is **v0.4.0** — feature-complete for single-machine and small-team
use, with a stable provider SPI. See [CHANGELOG.md](CHANGELOG.md).

Planned, and good first contributions:

- [ ] Publish the `agentdocstore` CLI to npm (today: clone and build)
- [ ] Reference providers outside this repo: Postgres, SQLite, S3
- [ ] Run the full conformance suite from `doctor`, not a smoke subset
- [ ] Comments anchored to a heading or line
- [ ] OIDC identity provider
- [ ] At-rest encryption as a provider wrapper
- [ ] Prebuilt multi-arch container image

## Documentation

| Document                               | Covers                                             |
| -------------------------------------- | -------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)   | Components, request flows, identity, fuse, storage |
| [Configuration](docs/CONFIGURATION.md) | Every flag, environment variable and config key    |
| [REST API](docs/API.md)                | Routes, bodies, responses, errors                  |
| [MCP tools](docs/MCP.md)               | Transports, client setup, all 16 tools             |
| [Providers](docs/PROVIDERS.md)         | The SPI contract and how to write a store          |
| [Security model](docs/SECURITY.md)     | Threat model and defences                          |
| [Hosting](docs/HOSTING.md)             | Docker, reverse proxies, systemd, backups          |
| [Design decisions](docs/DECISIONS.md)  | Why things are the way they are                    |
| [Release guide](docs/RELEASING.md)     | Versioning, checks, tags, GitHub and npm           |
| [Security policy](SECURITY.md)         | Private vulnerability reporting                    |

## Contributing

Contributions are welcome — bug reports, providers, docs and code. Start with
[CONTRIBUTING.md](CONTRIBUTING.md), and please follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.
