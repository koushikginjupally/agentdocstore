# MCP Tools Reference

AgentDocStore exposes **16 tools** via the
[Model Context Protocol](https://modelcontextprotocol.io/). AI assistants get
full CRUD, versioning, diffing, commenting, credential scanning, and visibility
control.

## Transports

### stdio (recommended for local use)

The MCP server runs in-process — no HTTP server needed, nothing listening on
any port. It constructs the configured provider and connects over stdin/stdout.

```bash
npx agentdocstore mcp                       # fs provider, identity = OS login
npx agentdocstore mcp --user alice          # explicit identity
npx agentdocstore mcp --ephemeral           # throwaway in-memory store
npx agentdocstore mcp --provider @acme/agentdocstore-provider-pg --networked
```

Identity defaults to the **OS login**, matching what `single-user` REST resolves
to, so a document created here is owned by the same user the web UI shows on the same
data directory.

The bare transport entry point is also runnable directly; it always uses an
in-memory provider and is intended for tests:

```bash
node packages/mcp/dist/stdio.js --user alice
```

### Streamable HTTP

When the AgentDocStore HTTP server is running, MCP is available at `/mcp` using
the SDK's `StreamableHTTPServerTransport`.

**`/mcp` enforces the server's auth mode.** It reaches the same provider as the
REST API, so it uses the same identity resolver — a `trusted-header` server reads
the configured header, a `token` server requires `Authorization: Bearer <token>`,
a `single-user` server attributes everything to the configured user. Three
consequences worth knowing:

| Situation                                                      | Response                  |
| -------------------------------------------------------------- | ------------------------- |
| No resolvable identity (missing header, bad token, blank user) | `401`, JSON-RPC `-32001`  |
| `mcp-session-id` presented by a _different_ identity           | `403`, JSON-RPC `-32003`  |
| Credential stops being valid mid-session                       | `401` on the next request |

Identity is re-resolved on **every** request, not cached for the session, and a
session id is not a credential. There is no anonymous fallback user.

## Client registration

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentdocstore": {
      "command": "npx",
      "args": ["agentdocstore", "mcp"]
    }
  }
}
```

### Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "agentdocstore": {
      "command": "npx",
      "args": ["agentdocstore", "mcp"]
    }
  }
}
```

### Kiro

`.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "agentdocstore": {
      "command": "npx",
      "args": ["agentdocstore", "mcp"]
    }
  }
}
```

### Generic (any MCP client supporting stdio)

```json
{
  "command": "node",
  "args": ["packages/mcp/dist/stdio.js", "--user", "your-name"]
}
```

## Tools

All `id` parameters accept either a **bare id** (10-character URL-safe string)
or a **URL** whose path contains a valid id. The tool extracts the id
automatically.

### create_document

Create a new document with content.

| Parameter         | Type                  | Required | Description                             |
| ----------------- | --------------------- | -------- | --------------------------------------- |
| `title`           | string                | yes      | Human-readable title                    |
| `content`         | string                | yes      | Initial content                         |
| `language`        | string                | no       | Content language (default: `plaintext`) |
| `visibility`      | `PUBLIC` \| `PRIVATE` | no       | Access visibility (default: `PUBLIC`)   |
| `expiresAt`       | string                | no       | ISO-8601 expiry timestamp               |
| `redactionPolicy` | `redact` \| `skip`    | no       | Credential handling (see below)         |

**Credential detection flow:** If `redactionPolicy` is omitted, the content is
scanned first. If credentials are detected, the tool returns a
`credentials_detected` result with the findings and asks the caller to re-invoke
with `redactionPolicy` set to `redact` (store with `[REDACTED:<type>]` markers)
or `skip` (store as-is). Nothing is persisted until the caller decides.

### read_document

Read a document and its content.

| Parameter | Type   | Required | Description                        |
| --------- | ------ | -------- | ---------------------------------- |
| `id`      | string | yes      | Document id or URL                 |
| `version` | number | no       | Specific version (default: latest) |

### update_document

Update content (creates a new version) and/or metadata.

| Parameter         | Type               | Required    | Description                                         |
| ----------------- | ------------------ | ----------- | --------------------------------------------------- |
| `id`              | string             | yes         | Document id or URL                                  |
| `content`         | string             | no          | New content (creates a new version)                 |
| `title`           | string             | no          | New title                                           |
| `language`        | string             | no          | New language                                        |
| `expiresAt`       | string \| null     | no          | New expiry (`null` clears)                          |
| `latestVersion`   | number             | conditional | **Required** when `content` is provided (CAS guard) |
| `editMessage`     | string             | no          | Note stored on the new version (max 500 characters) |
| `redactionPolicy` | `redact` \| `skip` | no          | Credential handling for new content                 |

The `latestVersion` parameter implements optimistic concurrency control. Pass
the version number you believe is current; if it doesn't match the stored
value, the update fails with a version conflict error.

### delete_document

Delete a document and all its versions and comments (owner only).

| Parameter | Type   | Required | Description        |
| --------- | ------ | -------- | ------------------ |
| `id`      | string | yes      | Document id or URL |

### list_documents

List documents by owner (defaults to the current user). When `owner` names
someone else, only their `PUBLIC` documents are returned.

With a non-blank `query`, it searches instead, like `GET /api/documents?query=`
in the REST API: it matches titles and content across every `PUBLIC` document
and the caller's own `PRIVATE` ones, best match first. The result adds `total`,
the number of matches, and returns `nextCursor` while more remain; pass it back
as `cursor` for the next page. `owner` cannot be combined with `query`.

| Parameter | Type   | Required | Description                                       |
| --------- | ------ | -------- | ------------------------------------------------- |
| `owner`   | string | no       | Filter by owner (default: viewer)                 |
| `query`   | string | no       | Search keywords instead of listing by owner       |
| `limit`   | number | no       | Page size (max 100)                               |
| `cursor`  | string | no       | Pagination cursor (a `nextCursor` from this call) |

### get_versions

List all versions of a document (version number, author, timestamp and edit
message when one was given — no content).

| Parameter | Type   | Required | Description        |
| --------- | ------ | -------- | ------------------ |
| `id`      | string | yes      | Document id or URL |

### diff_document

Produce a unified diff between two versions.

| Parameter     | Type   | Required | Description                             |
| ------------- | ------ | -------- | --------------------------------------- |
| `id`          | string | yes      | Document id or URL                      |
| `fromVersion` | number | yes      | Older version number                    |
| `toVersion`   | number | yes      | Newer version number                    |
| `context`     | number | no       | Context lines around hunks (default: 3) |

### get_raw_document

Get the raw text content of a document version.

| Parameter | Type   | Required | Description                        |
| --------- | ------ | -------- | ---------------------------------- |
| `id`      | string | yes      | Document id or URL                 |
| `version` | number | no       | Specific version (default: latest) |

### add_comment

Add a comment to a document.

| Parameter | Type   | Required | Description        |
| --------- | ------ | -------- | ------------------ |
| `id`      | string | yes      | Document id or URL |
| `body`    | string | yes      | Comment body       |

### get_comments

List all comments on a document.

| Parameter | Type   | Required | Description        |
| --------- | ------ | -------- | ------------------ |
| `id`      | string | yes      | Document id or URL |

### resolve_comment

Mark a comment as resolved.

| Parameter   | Type   | Required | Description        |
| ----------- | ------ | -------- | ------------------ |
| `id`        | string | yes      | Document id or URL |
| `commentId` | string | yes      | Comment id         |

### unresolve_comment

Mark a comment as unresolved.

| Parameter   | Type   | Required | Description        |
| ----------- | ------ | -------- | ------------------ |
| `id`        | string | yes      | Document id or URL |
| `commentId` | string | yes      | Comment id         |

### delete_comment

Delete a comment. Only the comment's author or the document's owner may delete
it; anyone else gets "not found".

| Parameter   | Type   | Required | Description        |
| ----------- | ------ | -------- | ------------------ |
| `id`        | string | yes      | Document id or URL |
| `commentId` | string | yes      | Comment id         |

### set_visibility

Change the visibility of a document (owner only).

| Parameter    | Type                  | Required | Description        |
| ------------ | --------------------- | -------- | ------------------ |
| `id`         | string                | yes      | Document id or URL |
| `visibility` | `PUBLIC` \| `PRIVATE` | yes      | New visibility     |

### scan_content

Scan text for embedded credentials without storing anything.

| Parameter | Type   | Required | Description  |
| --------- | ------ | -------- | ------------ |
| `content` | string | yes      | Text to scan |

Returns findings with type, line number, and byte offsets.

### get_help

Get usage documentation and examples.

| Parameter | Type   | Required | Description                         |
| --------- | ------ | -------- | ----------------------------------- |
| `topic`   | string | no       | Topic: `overview`, `create`, `diff` |

## Supported languages

`markdown`, `mermaid`, `plaintext`, `text`, `javascript`, `typescript`,
`python`, `java`, `go`, `rust`, `json`, `yaml`, `xml`, `html`, `css`, `sql`,
`bash`, `dockerfile`

## Error handling

MCP tool errors are returned as `{ isError: true, content: [{ type: "text", text: "..." }] }`.

| Error                  | When                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| `NotFoundError`        | Document or version does not exist, or PRIVATE document accessed by non-owner |
| `ValidationError`      | Invalid input (bad language, empty title, missing required field)             |
| `VersionConflictError` | CAS mismatch on `update_document` with content                                |
| `ContentTooLargeError` | Content exceeds 5 MB limit                                                    |

## Limits

| Limit                 | Value        |
| --------------------- | ------------ |
| Title                 | 300 bytes    |
| Content per version   | 5 MB         |
| Diff input (per side) | 2 MB         |
| Comment body          | 10,000 bytes |
