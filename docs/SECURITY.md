# Security Model

AgentDocStore is designed for self-hosted deployment. This document describes the
trust boundaries, defences, and residual risks.

## Threat model

### Trust boundaries

The trust boundary depends on the auth mode:

```
┌─────────────────────────────────────────────────────┐
│  AgentDocStore server process                         │
│                                                     │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐  │
│  │ single-user│  │trusted-hdr │  │    token      │  │
│  │  (local)   │  │  (proxy)   │  │  (bearer)    │  │
│  └─────┬──────┘  └─────┬──────┘  └──────┬───────┘  │
│        │               │                │           │
│  Identity = OS user    │         Identity from      │
│  (always trusted)      │         token→user map     │
│                        │                            │
│        Identity from header                         │
│        (trusted ONLY if proxy strips it)            │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │         Core authorization layer             │   │
│  │   canRead / canWrite / canDelete / canComment│   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │         Storage provider (SPI)               │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### single-user mode

Every request is attributed to a single identity (the OS username or a
configured name). There is no authentication — anyone who can reach the server
is that user. This is safe when the server binds `127.0.0.1` (the default).

**Risk:** If `--host 0.0.0.0` is used without a firewall, any host on the
network can read, write, and delete all documents as the single user.

An unknown auth mode from `--auth`, `AGENTDOCSTORE_AUTH` or the config file (a
misspelt `token`, say) stops startup; it never falls back to single-user.

### trusted-header mode

Identity is read from a request header set by a reverse proxy (e.g.
`X-Forwarded-User` from oauth2-proxy, Authelia, or Caddy with forward_auth).

**Critical requirement:** The proxy **must** strip this header from incoming
client traffic. If a client can set the header directly, they can impersonate
any user. The server logs a warning at startup:

```
⚠️  Trusted-header auth: the reverse proxy MUST strip the
    'X-Forwarded-User' header from client traffic to prevent impersonation.
```

**Risk:** If the proxy does not strip the header, or if a client bypasses the
proxy, identity is spoofable. The server has no way to verify the header's
provenance.

### token mode

Callers send `Authorization: Bearer <token>`. The server looks up the token in
a static map (`token → username`) loaded from the file given by `--tokens`
(or `AGENTDOCSTORE_TOKENS`, or `tokens` in the config file). Invalid or missing
tokens get 401.

Startup **refuses** `--auth token` without a tokens file, and refuses an empty
or malformed one, naming the path. An empty map would reject every caller, which
looks like a broken server rather than a misconfigured one.

**Risk:** Tokens are static and not rotated automatically. If a token leaks,
the holder has full access as that user until the token is removed from the
map and the server restarted.

## The MCP endpoint is not a way around auth

`/mcp` reaches the same provider as the REST API, so it authenticates callers
through the **same** `IdentityProvider` the REST routes use — one resolver built
once from the auth mode and shared. Three properties are pinned by tests
(`packages/mcp/src/handler.test.ts`) and by criterion S13:

1. **No identity means no access.** A request that resolves to no user — missing
   header, bad token, a thrown identity error — gets `401` with JSON-RPC error
   `-32001`. There is no synthetic fallback user: attributing an unauthenticated
   caller to a placeholder would hand them another user's PRIVATE documents.
2. **Identity is re-resolved on every request**, not once per session, so a
   credential that stops being valid stops working mid-session.
3. **A session id is not a credential.** The identity that opened a session is
   bound to it; a later request carrying that `mcp-session-id` under a different
   identity gets `403` (`-32003`).

The stdio transport (`agentdocstore mcp`) has exactly one caller — the process that
spawned it — and attributes documents to `--user`, defaulting to the OS login so that
ownership matches what `single-user` REST resolves to on the same data directory.

## Authorization

Authorization is enforced in `@agentdocstore/core`, not in individual providers
or route handlers. The rules are:

| Surface                         | PUBLIC document                  | PRIVATE document      |
| ------------------------------- | -------------------------------- | --------------------- |
| Read (GET, raw, versions, diff) | Anyone                           | Owner only            |
| Write (PUT, meta, visibility)   | Owner only                       | Owner only            |
| Delete                          | Owner only                       | Owner only            |
| Comments (read/add/resolve)     | Anyone                           | Owner only            |
| Delete a comment                | Its author or the document owner | Owner only            |
| Search results                  | Visible to all                   | Visible to owner only |

**No existence leak:** Denied access returns `NotFoundError` (HTTP 404), never
a "forbidden" response. A non-owner cannot distinguish "this document does not
exist" from "this document exists but you cannot see it."

## Credential scanner

The scanner (`@agentdocstore/core/scanner`) detects secrets and credentials in
content before it is stored:

- PEM / OpenSSH private key blocks
- AWS access key IDs (AKIA/ASIA prefix)
- AWS secret access keys (keyword-anchored)
- JSON Web Tokens (three-segment base64url)
- Bearer / OAuth tokens
- GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`)
- GitLab tokens (`glpat-`)
- Slack tokens (`xoxb-`, `xoxa-`, `xoxp-`, `xoxr-`, `xoxs-`)
- Connection-string embedded passwords (`scheme://user:password@host`)
- Generic secret assignments (`password=`, `api_key=`, `token=`, etc.)

### How it works

1. On create or update **without** `redactionPolicy`, the content is scanned.
2. If credentials are detected, the server responds **409** with the findings
   and `options: ['redact', 'skip']`. Nothing is stored.
3. The caller re-submits with `redactionPolicy: 'redact'` (detected spans are
   replaced with `[REDACTED:<type>]` before storage) or `'skip'` (stored as-is).

### Limitations

The scanner is **defence-in-depth, not a guarantee**:

- Pattern-based detection has false negatives. A novel credential format or an
  obfuscated secret will not be caught.
- Generic-assignment detection skips placeholders (`TODO`, `${VAR}`, `<your-password>`),
  which means a real secret that looks like a placeholder passes through.
- The scanner runs on the content as submitted. A secret encoded in base64
  inside a larger payload is not detected unless the encoded form matches a
  known pattern (e.g. JWT).
- Redaction is applied to the stored copy. The original content existed in
  server memory during the scan — it is not scrubbed from process memory.

## HTML rendering sandbox

HTML documents are rendered in an `<iframe>` with a strict sandbox:

```
sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
```

This allows:

- JavaScript execution inside the iframe (needed for interactive HTML content)
- Popups that escape the sandbox (so links open in the parent window)

This blocks:

- Form submission to the parent
- Same-origin access to the parent document
- Modals, pointer lock, orientation lock, presentation, downloads
- Top-level navigation of the parent

The sandbox value is defined as the `HTML_IFRAME_SANDBOX` constant in
`packages/web/src/constants.ts` and applied programmatically via
`setAttribute` in `render.ts`.

### Markdown rendering

Markdown is rendered with `marked` and sanitized with `DOMPurify`
(`USE_PROFILES: { html: true }`). This strips `<script>`, `<iframe>`, event
handlers, and other XSS vectors while preserving safe HTML.

## Runtime modes: offline is enforced, not documented

Offline is the **default**, and you opt out of it. Two independent axes, because
conflating them makes one of them unusable:

| Axis     | Governs                          | Flag                                  |
| -------- | -------------------------------- | ------------------------------------- |
| `mode`   | OUTBOUND egress + provider class | `--offline` (default) / `--networked` |
| `expose` | INBOUND bind address             | `--expose` (default: loopback only)   |

In `offline` mode:

1. **A non-loopback bind is refused** — a hard startup failure, not a warning,
   unless `--expose` is passed. Loopback means the whole `127.0.0.0/8` block,
   `::1`, and `localhost`; `0.0.0.0` and `::` are deliberately excluded because
   as bind addresses they mean _every_ interface.
2. **A provider declaring `requiresNetwork: true` is refused** — checked after
   construction, and the provider is closed again before startup aborts.
   `--expose` does NOT waive this clause: it governs inbound only.
3. **The network fuse is armed.** Offline is a promise about the whole process,
   not just our own code — a transitive dependency phoning home would break it
   just as thoroughly as a remote provider. The fuse patches
   `net.Socket.prototype.connect` (the base of http, https, undici, and every
   database driver; TLS sockets inherit it) and `globalThis.fetch`, and throws
   `OfflineViolationError` on any non-loopback destination.

Not fused, deliberately: `server.listen()` and inbound accepted sockets (serving
your own browser is the point), unix domain sockets (they cannot leave the
machine), and loopback destinations.

**This is a guard rail, not a sandbox.** A determined dependency could reach for
`child_process` or a raw `dgram` socket. For a hard guarantee, run the container
with no network interface; the fuse is what makes an accidental leak fail
visibly instead of silently succeeding.

The mode is reported at boot (`▸ mode=offline · provider=fs · auth=single-user ·
egress=fused · inbound=loopback`) and on `GET /healthz`, so a probe can tell an
offline instance from a networked one without reading the launch command.

### Verifying the fuse: `scripts/airgap-test.sh`

```bash
scripts/airgap-test.sh              # builds the image, then runs it air-gapped
scripts/airgap-test.sh --no-build   # reuse an existing image
```

This runs the image under `docker run --network none` — a namespace whose only
device is loopback, with no route and no DNS — and executes
`scripts/airgap-probe.mjs` inside it. It is also criterion S15 in
`scripts/verify.sh`.

The probe is built around one trap: **in an air-gapped container every outbound
attempt fails, so "the request failed" proves nothing about the fuse.** It
therefore discriminates on _which_ error arrives. With the fuse armed, an
attempt must fail with `OfflineViolationError` (refused before a socket is
opened); after `fuse.release()`, the _same_ call must fail with a transport
error (`EAI_AGAIN`/`ENETUNREACH`) instead. The pair is the evidence: the first
shows the fuse intercepting, the second shows the air gap is genuinely there.

Three egress paths are checked, because they reach the socket differently:
`fetch()`, a raw `net.connect()`, and `http.get()` (which goes through an Agent
and never touches the patched `fetch`). The probe then confirms loopback still
works, and exercises the REST surface, the web UI and the stdio MCP server to
show the application itself needs nothing from the network.

> This test is not decorative. Its first run found that `net.connect({host,
port})` — the entry point `http`, `https`, undici and every database driver
> use — was being **allowed**, because those callers pass Node's normalized
> `[options, cb]` array to `Socket.prototype.connect` and the fuse read that
> array as "no host, therefore localhost". The unit suite was green throughout,
> since it only exercised the hand-written `socket.connect(port, host)` form.
> Egress from any real library was unfused until that was fixed.

### Why the Docker image uses `--expose`

A container must bind `0.0.0.0` to be reachable through a port mapping, but that
is inbound exposure inside its own network namespace — it says nothing about
egress. The shipped `CMD` therefore passes `--expose` and stays in offline mode:
egress fused, local provider only. `--networked` is for a container that
deliberately needs to reach a remote store.

### Build-time and asset posture

- All frontend assets are bundled from npm at build time (esbuild).
- No CDN, no external fonts, no analytics, no telemetry.
- The app works with networking fully disabled.

## Size limits

Write-time enforcement prevents resource exhaustion:

| Limit                 | Value        | Error                        |
| --------------------- | ------------ | ---------------------------- |
| Title                 | 300 bytes    | `ValidationError` (400)      |
| Content per version   | 5 MB         | `ContentTooLargeError` (413) |
| Diff input (per side) | 2 MB         | `ContentTooLargeError` (413) |
| Comment body          | 10,000 bytes | `ValidationError` (400)      |
| JSON request body     | 11 MB        | 413 (body-size guard)        |

The request cap leaves room for JSON escaping: a quote, backslash, newline or
tab takes two bytes in the request, so a write carrying 5 MB of content can
need up to 10 MB.

The REST API counts a body as it arrives: a declared `Content-Length` over the
cap is refused before anything is read, and a chunked body without one is cut
off once it passes the cap, so no request is held in memory beyond it.

Content is never stored then rejected on read — oversized writes are rejected
at the API boundary.

## Security headers

Every response carries `X-Content-Type-Options: nosniff`.

API responses (`/api/*`, `/raw/*`, `/healthz`) also carry:

- `Content-Security-Policy: default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self'; object-src 'none'`

The web UI's own page and bundle do not carry a Content-Security-Policy yet:
the UI injects its stylesheet at runtime and the sandboxed HTML preview
inherits its parent's policy, so a UI policy needs its own design. Rendered
markdown is sanitized with DOMPurify either way (see Markdown rendering).

## Path traversal defence

All user-supplied IDs are validated with `isValidId()` before they reach any
filesystem path or store key. The ID alphabet (`A-Z`, `a-z`, `0-9`, `_`, `-`)
deliberately excludes `/`, `.`, and whitespace, so a valid ID can never encode
a traversal sequence like `../` or `./`.

## Recommendations

1. **For local use:** Keep the defaults — `offline`, `single-user`, `127.0.0.1`.
   Nothing to configure and nothing leaves the machine.
2. **For LAN/shared use:** `--expose` plus `trusted-header` behind a reverse
   proxy (nginx, Caddy, Traefik) that handles authentication and strips the
   identity header. Stay in offline mode unless the store is remote.
3. **For remote API/MCP access:** `token` mode with strong, unique tokens in a
   file only the service user can read.
4. **Only pass `--networked` when a provider genuinely needs egress.** It
   disarms the fuse for the whole process, not just for that provider.
5. **Validate a third-party provider before pointing it at real data:**
   `agentdocstore doctor` for a live smoke check, then the full conformance suite.
6. **Back up your data directory** — AgentDocStore has no built-in redundancy.
7. **Do not store highly sensitive data** (credentials, private keys, etc.)
   even with the scanner enabled — the scanner is best-effort.
