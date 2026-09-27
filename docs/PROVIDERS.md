# Provider SPI & Conformance

AgentDocStore's storage is fully pluggable. This document describes the SPI
(Service Provider Interface) contracts, the rules every provider must honour,
and how to prove correctness with the conformance suite.

## Architecture

A `Provider` is the composition of four pieces:

```
Provider
  ├── repository: DocumentRepository    — documents + immutable versions
  ├── comments:   CommentStore     — per-document comment threads
  ├── search:     SearchIndex      — full-text search with visibility
  └── capabilities: Capabilities   — static descriptor of what the backend supports
```

Plus a `close()` method to release resources (locks, file handles, timers).

## SPI interfaces

All interfaces are exported from `@agentdocstore/core`.

### DocumentRepository

```ts
interface DocumentRepository {
  create(input: CreateDocumentInput): Promise<Document>;
  get(id: string): Promise<Document | null>;
  getVersion(id: string, version: number): Promise<DocumentVersion | null>;
  listVersions(id: string): Promise<readonly DocumentVersion[]>;
  appendVersion(id: string, input: AppendVersionInput): Promise<Document>;
  updateMeta(id: string, meta: UpdateMetaInput): Promise<Document>;
  setVisibility(id: string, visibility: Visibility): Promise<Document>;
  delete(id: string): Promise<void>;
  listByOwner(owner: string, query?: ListQuery): Promise<Page<Document>>;
  listExpired(nowIso: string, limit: number): Promise<readonly string[]>;
}
```

#### Input types

```ts
interface CreateDocumentInput {
  title: string;
  language: Language;
  visibility: Visibility;
  content: string;          // initial version-1 content
  createdBy: string;
  expiresAt?: string;       // ISO-8601
}

interface AppendVersionInput {
  content: string;
  editedBy: string;
  message?: string;                    // optional edit note; store it and
                                       // return it as DocumentVersion.message
  expect: { latestVersion: number };   // CAS guard
}

interface UpdateMetaInput {
  title?: string;
  language?: Language;
  expiresAt?: string | null;           // null clears expiry
}

interface ListQuery {
  limit?: number;
  cursor?: string;                     // opaque continuation token
}

interface Page<T> {
  items: readonly T[];
  nextCursor?: string;
}
```

### CommentStore

```ts
interface CommentStore {
  add(documentId: string, input: { author: string; body: string }): Promise<Comment>;
  list(documentId: string): Promise<readonly Comment[]>;
  setResolved(documentId: string, commentId: string, resolved: boolean): Promise<Comment>;
  delete(documentId: string, commentId: string): Promise<void>;
}
```

### SearchIndex

The search index is **synchronous** — no Promises.

```ts
interface SearchIndex {
  add(doc: SearchDoc): void;
  update(doc: SearchDoc): void;
  remove(documentId: string): void;
  query(q: string, viewer: string | null, opts?: SearchQueryOptions): SearchResults;
  snapshot(): string;
  restore(snapshot: string): void;
  clear(): void;
  size(): number;
}

interface SearchDoc {
  documentId: string;
  owner: string;
  visibility: Visibility;
  title: string;
  content: string;
  expiresAt?: string;      // optional; expired entries are left out of query results
}

interface SearchResults {
  hits: readonly { documentId: string; score: number }[];
  total: number;           // pre-pagination count of visible matches
}
```

### Capabilities

```ts
interface Capabilities {
  search: 'core-fallback' | 'native';
  nativeTtl: boolean;
  atomicVersioning: boolean;
  requiresNetwork: boolean;
}
```

- `search: 'core-fallback'` — the provider does not implement search natively;
  the built-in `CoreSearchIndex` (MiniSearch-backed) is used. The provider is
  responsible for calling `search.update()` / `search.remove()` on writes.
- `search: 'native'` — the provider implements search itself (e.g. database
  full-text index).
- `nativeTtl: false` — the server runs an expiry sweep (calls `listExpired()`
  periodically and deletes returned documents).
- `nativeTtl: true` — the store expires documents on its own (DynamoDB TTL, etc.).
- `atomicVersioning: true` — version content is committed before the metadata
  pointer update. A crash between the two leaves orphaned content but never a
  pointer to missing content.
- `requiresNetwork` — **declare this honestly.** Offline mode (the default)
  refuses to start with a provider that reports `true`, and the network fuse
  would sever its connections anyway. Only a provider that is entirely local —
  in-process memory, or files on this machine — may report `false`. A unix socket
  to a local daemon still counts as `true`: the fuse permits unix sockets, but
  the operator deserves to know the store is not self-contained.

The loader rejects a provider whose `capabilities.requiresNetwork` is not a
boolean, because offline mode cannot be enforced without it.

### healthCheck (optional)

```ts
interface ProviderHealth { healthy: boolean; detail?: string }

interface Provider {
  healthCheck?(): Promise<ProviderHealth>;
}
```

Implement it when your store can be down independently of this process — a
database, an object store. It is surfaced on `GET /healthz` (which returns 503
and `status: "degraded"` when unhealthy) and printed by `agentdocstore doctor`, so
it MUST be cheap and MUST NOT throw: report `{ healthy: false, detail }` instead.
A local provider whose health is implied by successful construction should omit
it entirely.

## Contract rules

Every provider **must** honour these rules. The conformance suite tests them.

### 1. Compare-and-set (CAS) on version append

`appendVersion` **must** throw `VersionConflictError` when
`expect.latestVersion` does not equal the stored `latestVersion`. This prevents
lost updates when two writers race.

### 2. Immutable versions

Versions are append-only and 1-based. Once written, a version's content,
`createdBy`, and `createdAt` are immutable. There is no `updateVersion`.

### 3. Reads of unknown IDs

- `get(id)` returns `null` for an unknown **or malformed** id.
- `getVersion(id, n)` returns `null`.
- `listVersions(id)` returns `[]`.
- `listByOwner(owner)` returns `{ items: [], nextCursor: undefined }`.

Reads never throw for missing data. This is intentional — the authorization
layer returns 404 for both "does not exist" and "you cannot see it", so
callers must handle `null` gracefully.

### 4. Mutations of unknown IDs

- `appendVersion`, `updateMeta`, `setVisibility`, and `delete` on an unknown
  id **must** throw `NotFoundError`.

### 5. Content-before-pointer commit point

The content of a new version must be durably written **before** the document's
`latestVersion` pointer is updated. A crash between the two is safe: orphaned
content wastes space but a dangling pointer would lose data.

### 6. Opaque cursors

Pagination cursors are opaque strings owned by the provider. Callers must not
parse, construct, or assume anything about their format.

### 7. Stable ordering

`listByOwner` returns documents in newest-first order. The ordering must be stable
(deterministic) — ties in `createdAt` are broken by id.

### 8. Search visibility

`search.query()` returns PUBLIC hits plus the `viewer`'s own PRIVATE hits.
A PRIVATE document owned by someone else is **never** returned, regardless of the
query.

Pass the document's `expiresAt` in every `search.add()` / `search.update()`.
`CoreSearchIndex` then leaves expired documents out of both `hits` and `total`
from the moment they expire, before the sweep removes them. A native search
implementation should do the same.

### 9. Write-time size limits

Content size is enforced at **write** time (`create` and `appendVersion`). The
limit is `LIMITS.MAX_CONTENT_BYTES` (5 MB). Oversized content must be rejected
with `ContentTooLargeError` — never stored then failing on read.

### 10. Delete cascade

`delete(id)` removes the document, all its versions, and all its comments. After
deletion, `get(id)` returns `null`.

### 11. Concurrency safety

All methods must be safe under concurrent calls within one process. The
filesystem provider uses a per-document in-process mutex; an in-memory provider
is inherently single-threaded (Node.js event loop).

## Built-in providers

### `@agentdocstore/provider-memory`

Everything in Maps. Used by tests and `--ephemeral` mode. No persistence.

```ts
import { createMemoryProvider } from '@agentdocstore/provider-memory';
const provider = createMemoryProvider();
```

### `@agentdocstore/provider-fs`

Persists under a data directory (default `~/.agentdocstore/data`).

```ts
import { createFsProvider } from '@agentdocstore/provider-fs';
const provider = await createFsProvider({ dataDir: '/path/to/data' });
```

On-disk layout:

```
<dataDir>/
  documents/<id>/meta.json
  documents/<id>/versions/1.txt
  documents/<id>/versions/2.txt
  documents/<id>/comments.json
  index/snapshot.json
  .agentdocstore.lock/
```

- Atomicity: temp file + `rename()` (atomic on the same filesystem).
- Concurrency: per-document `KeyedMutex` + advisory boot lock directory.
- Search: `CoreSearchIndex` with snapshot persistence; full rebuild from store
  if the snapshot is missing or corrupt.

Both built-in providers pass the same 60-case conformance suite.

## Writing your own provider

Adding a storage backend is `npm install` plus one config key. You do **not**
fork this repository: your provider is an ordinary npm package, resolved from
_your_ working directory.

### 0. Scaffold it

```bash
agentdocstore init-provider postgres
```

That writes `./agentdocstore-provider-postgres/` containing the SPI skeleton with
capabilities pre-declared, an options schema, a `healthCheck`, the conformance
suite wired in, and TODOs exactly where store-specific work belongs.

### The module contract

Your package's entry point must export:

```ts
interface ProviderModule {
  providerName: string;                       // 'postgres' — the store, not the package
  optionsSchema?: { parse(input: unknown): unknown };   // recommended
  createProvider(options: unknown): Promise<Provider>;
}
```

Named exports or a `default` export object both work. `optionsSchema` is
optional but worth writing: it turns a mistyped connection string into a readable
boot failure instead of a 500 on the first write. Any object with a `parse()`
method satisfies it — a zod schema does so directly, and core takes no zod
dependency.

`createProvider` should do the connecting and migrating: a returned provider is
expected to be ready to serve. Throwing aborts startup with your message shown
to the operator.

### Point AgentDocStore at it

```json
{
  "provider": {
    "module": "@acme/agentdocstore-provider-postgres",
    "options": { "url": "postgres://localhost/agentdocstore" }
  }
}
```

```bash
npm install @acme/agentdocstore-provider-postgres
agentdocstore serve --config agentdocstore.config.json --networked
```

Equivalently `--provider <module> --provider-options '{"url":"..."}'`, or
`AGENTDOCSTORE_PROVIDER` / `AGENTDOCSTORE_PROVIDER_OPTIONS`. Module and options layer
independently across flags, env and file, so a flag can override the module while
options stay in the config file.

`--networked` is required for any provider declaring `requiresNetwork: true` —
offline is the default and you opt out of it explicitly.

### Prove it before trusting it

Two gates, in increasing strength:

```bash
agentdocstore doctor --provider @acme/agentdocstore-provider-postgres \
  --provider-options '{"url":"postgres://localhost/agentdocstore_test"}' --networked
```

`doctor` constructs the provider exactly as `serve` would, prints what it
declares, runs its `healthCheck`, then exercises the clauses that silently
corrupt data when they are wrong: CAS on append, version immutability,
pagination stability, PRIVATE search isolation, write-time size limits, expiry
listing, delete cascade. It exits non-zero on any failure. These are **smoke**
checks — fast, runner-free, and safe to run against a live store.

The authoritative gate is the full conformance suite:

1. Install the core types and the suite. `vitest` is a **peer** dependency of
   `provider-tests`, so the suite registers its cases into your test runner
   rather than a duplicate copy of its own:

```bash
npm install --save @agentdocstore/core
npm install --save-dev @agentdocstore/provider-tests vitest
```

2. Implement the `Provider` interface from `@agentdocstore/core`.

3. Wire the conformance suite. The factory returns the provider **directly** —
   the suite creates a fresh one before each case and calls `provider.close()`
   itself afterwards, so there is no cleanup callback to supply:

```ts
// my-provider.conformance.test.ts
import { runProviderConformance } from '@agentdocstore/provider-tests';
import { createMyProvider } from './index.js';

runProviderConformance('my-provider', async () => {
  // Return per-case isolated storage (a temp dir, a unique table or key prefix)
  // so cases cannot observe one another. `close()` is called for you; anything
  // beyond releasing handles — dropping a table, deleting a bucket prefix —
  // belongs inside your own `close()` implementation.
  return createMyProvider({ /* test config */ });
});
```

4. Run: `npx vitest run my-provider.conformance.test.ts`
5. All 60 cases must pass.

Passing `doctor` is necessary but not sufficient: a provider that fails doctor
cannot pass the suite, and only the suite covers the full contract.

The conformance suite covers:

- CRUD lifecycle (create → read → update → delete)
- CAS conflict detection on `appendVersion`
- Version immutability and ordering
- Pagination with cursor continuation
- `listByOwner` ordering and empty-result handling
- PRIVATE visibility filtering in search
- Content size limit enforcement
- Expiry listing (`listExpired`)
- Comment lifecycle (add → list → resolve → delete)
- Delete cascade (document + versions + comments)
- Malformed/unknown id handling
- Capabilities declaration (including `requiresNetwork`) and `healthCheck` shape

### Extension points for forks

- **At-rest encryption** — encrypt content in `create` / `appendVersion` and
  decrypt in `getVersion`. The SPI does not prescribe a key-management scheme.
- **Native search** — set `capabilities.search = 'native'` and implement
  `SearchIndex` against your database's full-text engine.
- **Native TTL** — set `capabilities.nativeTtl = true` and configure your
  store's expiry mechanism (e.g. DynamoDB TTL). The server skips the sweep.
