# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0, minor
versions may contain breaking changes; they will be called out under
**Changed**.

## [Unreleased]

### Added

- The web UI asks before discarding unsaved typing: leaving the edit page, or
  the home page with a half-written new document, through Cancel, a link or
  Back now asks first, and reloading or closing the tab gets the browser's
  own warning.
- The edit page's "Edit Message" is now saved with the new version and shown
  on the versions page (REST `editMessage`, MCP `update_document`
  `editMessage`, returned as `message` on versions). Providers receive it as
  the optional `AppendVersionInput.message`; the conformance suite checks it
  round-trips. Previously the message was accepted and discarded.

### Security

- Markdown documents can no longer embed `<iframe>` elements. The sanitizer
  was configured to keep them, although docs/SECURITY.md says they are
  stripped, so a PUBLIC document could show another site (for example a fake
  sign-in page) inside AgentDocStore to anyone who opened it. Use the `html`
  language, which renders in a sandbox, for embedded HTML.
- The web UI's page and bundle now carry `X-Content-Type-Options: nosniff`.
  docs/SECURITY.md said every response carried it and the CSP; it now says
  the CSP covers API responses and that the UI has none yet.
- `PUT /api/documents/:id` no longer applies title, language, expiry or
  visibility when its content change hits a version conflict (409, another
  save landed first). The metadata was written before the new version, so a
  409 could still rename a document or make it PUBLIC. The version is now
  appended first, as MCP `update_document` already did.
- Deleting a comment (REST `DELETE /api/documents/:id/comments/:cid` and MCP
  `delete_comment`) is now limited to the comment's author and the document's
  owner. Previously anyone who could read a PUBLIC document could delete
  anyone's comments on it.
- The web UI shows a comment's Delete button only to its author and the
  document owner, matching the server rule.
- MCP `list_documents` with an `owner` argument returned that user's PRIVATE
  documents (titles and metadata) to any caller. It now applies the same read
  rule as every other tool and returns only their PUBLIC documents.

### Fixed

- The web UI's comment list and version history now load. Both always failed
  ("Failed to load comments." / "Failed to load versions") because the client
  expected a bare array where the API returns `{ comments }` and `{ versions }`.
- `PUT /api/documents/:id` no longer applies title, language, expiry or
  visibility changes when the same request is rejected for detected credentials
  (409) or oversized content (413).
- `GET /api/documents` rejects a `limit` that is not an integer from 1 to 100
  with `400`, matching the MCP `list_documents` tool. Previously `limit=abc`
  returned an empty page and `limit=-1` silently dropped a document.
- Expired documents are now treated as deleted the moment they expire, over both
  REST and MCP. Previously they stayed readable, searchable and editable until
  the once-a-minute sweep ran — and indefinitely under `agentdocstore mcp`,
  which runs no sweep.
- Search `total` no longer counts expired documents. `SearchDoc` gains an
  optional `expiresAt`, which the built-in providers now pass; third-party
  providers can add it without breaking existing code.
- `agentdocstore init-provider` scaffolds a working `CoreSearchIndex` instead of
  an empty stub that made the first document create fail with a 500, and
  documents keeping the index current (including `expiresAt`).
- The "Credentials Detected" dialog keeps keyboard focus inside it, returns
  focus to the Create/Save button when it closes, and no longer leaves a stray
  key listener behind after each use.
- Moving between pages in the web UI now puts keyboard focus on the new page's
  heading, instead of dropping it to the top of the document, so screen
  readers announce the page and Tab continues from there.
- Submitting the create form with no content now moves focus to the Content
  field and marks it invalid, instead of only showing a short-lived toast.
- The theme toggle uses SVG sun/moon icons, so it is no longer blank in the
  light theme on systems without an emoji font, and its label now says which
  theme it switches to.
- The web UI no longer says "No documents yet" when a search matches nothing;
  it names the search and suggests clearing it.
- Empty and error states use theme-coloured SVG icons instead of emoji, which
  rendered as blank boxes on systems without an emoji font.
- Document action buttons and the credential warning use SVG icons instead of
  emoji, so screen readers announce only the label ("Delete", not
  "wastebasket Delete").
- On phone-width screens the document action buttons wrap instead of pushing
  "Delete" off the edge of the page.
- On phone-width screens toasts appear under the header instead of in the
  bottom corner, where they covered the Save and Cancel buttons.
- A `#section` link inside a markdown document now scrolls to that heading
  instead of opening "Page Not Found". Headings get `user-content-` prefixed
  ids so they can be linked to.
- Deleting a comment now asks for confirmation, like deleting a document.
  One click used to delete it for good.
- Code documents are syntax-highlighted again, in both themes. The token
  colours came from a bundled stylesheet that the page never loaded, so code
  always rendered in one colour; they now follow the light/dark theme.
- The document page shows Edit and Delete only to the document's owner. Other
  viewers were offered both, and the server rejected them.
- Web UI error messages now include the server's reason (for example "Title
  exceeds maximum length") instead of only the HTTP status. The client read a
  `message` field, but the API sends `{ "error": "<message>" }`. A non-JSON
  error response, such as a proxy's error page, now reports its status instead
  of "Body is unusable".
- Saving while another save of the same document lands (a version conflict,
  also HTTP 409) no longer fails silently. The web UI treated every 409 as
  detected credentials, so the edit page showed no dialog and no message; it
  now reports the conflict.
- Opening a document's edit page as someone other than its owner now says
  only the owner can edit it, with a link back, instead of showing a form
  whose Save always failed.
- A REST request body that fails validation now gets a 400 naming the field
  and the reason (for example `visibility: must be one of PUBLIC, PRIVATE`)
  instead of only "Invalid request body". The rejected value is not echoed.
- MCP `update_document` no longer stores the new version when the same call's
  title is rejected (blank or over 300 bytes). REST and MCP now check the
  title before anything is written, using the new core `validateTitle`.

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
