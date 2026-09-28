# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0, minor
versions may contain breaking changes; they will be called out under
**Changed**.

## [Unreleased]

## [0.3.0] - 2026-09-28

### Added

- The CLI is on npm as `agentdocstore`, so `npx agentdocstore serve` and the MCP
  configs in the README and MCP guide work without a clone. `npm run build`
  bundles it, with the server, the MCP tools and the built-in storage
  providers, into `packages/cli/bundle/`, beside a copy of the web UI. The
  build fails if the bundle imports a package the CLI does not declare, or the
  CLI declares one the bundle never imports. `npm run smoke:cli` installs the
  packed package outside the repository and checks `serve` and `mcp`; CI runs
  it on Node 24.

### Changed

- The CLI workspace is named `agentdocstore` (was `@agentdocstore/cli`), and
  the private root package `agentdocstore-monorepo`.
- `serve` looks for the web UI beside the running CLI before looking in
  `packages/web/dist/`.
- The Quickstart and the MCP guide start from the npm package. The generic
  stdio MCP config runs `agentdocstore mcp` instead of the in-memory test entry
  point.

## [0.2.1] - 2026-09-28

### Fixed

- The npm packages include the LICENSE and NOTICE files, which 0.2.0 shipped
  without.

## [0.2.0] - 2026-09-28

### Added

- First npm release: `@agentdocstore/core` and `@agentdocstore/provider-tests`
  are published as public packages.
- Bold and Italic buttons above the content box on the create and edit forms,
  for markdown documents. They make the same edits as Ctrl+B and Ctrl+I (Cmd on
  a Mac), and their tooltips name those keys.
- The create and edit forms show the content's size under the box once it is
  within 10% of the 5 MB limit, and how much to cut once it is over, so a
  large document is trimmed before saving rather than refused after.
- When a save is refused because a newer version was saved meanwhile, the edit
  page says so in the form and keeps what you typed. It links to the newer
  version, opening in a new tab so you can compare, and offers to save your
  text as the next version; the newer one stays in the history.
- In the content box of a markdown document, Ctrl+B and Ctrl+I (Cmd on a Mac)
  make the selected text bold or italic, or take that off again, on both the
  create and edit forms. Other languages keep the keys as they were.
- A document can be read full screen: Full Screen on the document page shows
  it across the whole screen with a readable line length. The arrow, Page and
  Space keys scroll it; Exit Full Screen or Escape returns. The button only
  appears in browsers that can do this (not iPhone Safari).
- MCP `list_documents` takes a `query` and then searches, like the REST API's
  `?query=`: `PUBLIC` documents and the caller's own `PRIVATE` ones, best
  match first, with `total` and a `nextCursor` for the next page. Agents
  connected over MCP could not search before.
- A markdown document with three or more h1–h3 headings starts with a
  Contents list, closed until opened; its links jump to each heading within
  the page. It shows in the Preview too.
- The create and edit forms can load a text file, with a Load File button or
  by dropping the file on the text box. It is read in the browser. Its name
  fills an empty title and picks the language from the extension; replacing
  text already in the box asks first; a file over the content limit, or one
  that is not text, is refused with the reason.
- A Make a Copy button on the document page opens the create form filled with
  the shown version — title "Copy of …", language, visibility (a private
  document's copy stays private) and content. Nothing is saved until the copy
  is created, and leaving the form first asks, as for any unsaved document.
- The create and edit forms have a Preview button beside Content. It shows
  the text rendered the way the document page will show it, in the language
  picked on the form, through the same renderer and sanitizing; pressing it
  again returns to the text.
- The comment box shows a comment's size once it nears the 10,000-byte limit
  and, past it, how much to cut; an oversized comment is no longer sent only
  to fail with "Comment exceeds maximum length".
- A search in the web UI now says how many documents matched (for example
  "25 documents match “rollout”"), and screen readers announce it, or that
  nothing matched, while focus stays in the search box.
- Expiry can be set from the web UI. The create form has an "Expires" choice
  (Never, 1, 7, 30 or 90 days, 1 year); the edit form can keep the current
  expiry, remove it, or set a new one from now; and the document page says
  when a document expires. The API already supported `expiresInDays`.
- A Download button on the document page saves the shown version as a file
  named after the document, with the extension for its language (for
  example `Release notes.md`). It is built in the browser; nothing is
  fetched.
- Any earlier version of a document can be opened in full: the Versions page
  has a View link on each version, and `#/d/<id>/v/<n>` shows that version
  rendered, read-only, with a note and a link back to the latest version.
- The web UI asks before discarding unsaved typing: leaving the edit page,
  the home page with a half-written new document, or a document page with a
  half-written comment through Cancel, a link or Back now asks first, and
  reloading or closing the tab gets the browser's own warning. Links that
  only scroll within a document never ask.
- The edit page's "Edit Message" is now saved with the new version and shown
  on the versions page (REST `editMessage`, MCP `update_document`
  `editMessage`, returned as `message` on versions). Providers receive it as
  the optional `AppendVersionInput.message`; the conformance suite checks it
  round-trips. Previously the message was accepted and discarded.

### Security

- The credential scan no longer takes time growing with the square of the
  content. Its generic `password=` / `token=` pattern read an unbounded name
  after each keyword, so text such as `tokentoken…` made every repeat re-read
  the rest: 256 KB took 13 seconds and a 5 MB document about an hour and a half
  on the server's only thread, on every create, update and `POST /api/scan`.
  The name after the keyword is now read up to 64 characters, and 5 MB of such
  text scans in under a second. Text with a finding on every line was slow the
  same way, since each finding's line was counted from the start of the text
  (5 MB took about 23 minutes); it now takes a fifth of a second. Text made of
  private-key BEGIN lines with no END took about a second per megabyte, since
  the pattern looked up to 16 KB ahead after each one; it is now found in one
  pass, and 5 MB of it scans in under a tenth of a second.
- Comparing two versions can no longer stall the server. A diff took time that
  grows with the square of the lines that differ, on the server's only thread:
  two 200 KB versions that share no line held every other request for 30
  seconds, and two at the 2 MB diff limit would take about an hour. A diff that
  would add or remove more than 5,000 lines is now refused with `413` (REST),
  a "Content too large" error (MCP `diff_document`) or a notice on the Versions
  page, after at most about 2 seconds of work.
- A link in a markdown document that opens another window can no longer take
  over the reader's AgentDocStore tab. With `target="_blank" rel="opener"` or a
  named window as its `target`, the page it opened got `window.opener` and could
  replace the tab with any page, such as a fake sign-in. Such links now always
  carry `rel="noopener noreferrer"`.
- `/mcp` now refuses a request body over the 11 MB request cap with `413`,
  counting it as it arrives. It had no limit at all: a 200 MB request was read
  and accepted, taking the server from 117 MB to 934 MB of memory.
- A REST request body sent without `Content-Length` (chunked) is now cut off
  at the request cap as it arrives. It used to be read in full and only then
  measured, so a single request could fill the server's memory: a 200 MB body
  took a running server from 373 MB to 959 MB before it was refused.
- An unknown auth mode now stops startup with an error naming where it came
  from (`--auth`, `AGENTDOCSTORE_AUTH` or `auth` in the config file). It used
  to be skipped, so a misspelt `token` or `trusted-header` started the server
  in single-user mode, where every request is accepted as the local user
  without any credentials.
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

- `POST /api/scan` and the MCP `scan_content` tool now refuse content over the
  5 MB content limit with `413` (REST) or a "Content too large" error (MCP),
  as a save would. They scanned anything up to the 11 MB request cap, which
  doubled the longest scan one request could ask for.
- Comparing two versions that are too large to compare now says so on the
  Versions page, with links to open each version in full. The page only said
  "Failed to compute diff.", and the reason flashed by in a toast.
- Content within the 5 MB limit is no longer refused as "Request body too
  large". The REST request cap was 6 MB, but JSON escaping writes a quote or
  backslash as two bytes, so 4.9 MB of minified JSON made a 6.04 MB request.
  The cap is now 11 MB (`LIMITS.MAX_REQUEST_BYTES`).
- The "ready at" URL that `agentdocstore serve` prints now works: with
  `--port 0` it gives the port the system picked instead of `:0`, and an IPv6
  host is bracketed (`http://[::1]:8787`, not `http://::1:8787`).
- A port that is not a whole number from 0 to 65535 (`--port`,
  `AGENTDOCSTORE_PORT` or `port` in the config file) now stops startup with an
  error naming where it came from. `--port abc` was dropped, so the server
  started on 8787; `--port 8080abc` and `8080.9` started on 8080; and a
  non-numeric `port` in the config file made the server listen on a Unix
  socket in the current directory.
- `agentdocstore serve` no longer leaves the data directory locked when it
  cannot start: a port already in use, a port out of range, or token auth
  without a tokens file. A busy port gets a one-line error instead of a crash,
  and "ready" is printed only once the port is open.
- A version number in `?version=`, or a diff's `from` and `to`, must be a
  whole number: `1.5` or `2abc` get `400` instead of quietly answering with
  version 1 or 2.
- MCP `create_document` and `update_document` store `expiresAt` as ISO-8601
  and refuse one that is not a date-time, is in the past, or is more than
  36,500 days away. Before, any text (`"tomorrow"`, `""`) was stored as the
  expiry, and the document never expired.
- `expiresInDays` above 36,500 (about 100 years) is refused with a `400` that
  names the field and the limit. A much larger value made create and update
  fail with `500 Internal server error`, because the date overflowed.
- Saving from the edit page no longer overwrites a change that someone else,
  or an agent, saved while the page was open. The page now sends the version
  it loaded, and `PUT /api/documents/:id` takes it as `latestVersion`: a save
  made from an older version gets a `409` saying so, and nothing is saved.
  Before, the last save silently won.
- MCP over HTTP answers `404 Session not found` to a request whose
  `mcp-session-id` it does not hold, for example after the server restarted
  or the session was closed, so the client starts a new session. It answered
  `400 Server not initialized`, which clients do not recover from.
- The home page's search box is now a search landmark, so screen reader
  users can jump straight to it instead of tabbing through the create form.
- Every page of the web UI now has one main heading (`h1`), and its headings
  no longer skip a level. The home, edit and not-found pages had no `h1`, and
  the Comments and diff headings jumped from `h1` to `h3`, so screen reader
  users who move by heading got a broken outline. The pages look the same.
- After `agentdocstore import --force` into a data directory that already had
  documents, search finds those documents again. The archive's search index
  replaced the local one, so they were listed but matched no search. Import
  now removes the index snapshot, and the next start rebuilds it.
- `agentdocstore import --force` no longer extracts into a data directory a
  running server or MCP process is using; it stops with the "already locked"
  error. Before, it wrote over the live instance's files.
- A data directory restored with `agentdocstore import` now starts. An export
  taken while the server ran included its lock (`.agentdocstore.lock/`), so
  the restored copy failed with "already locked". Exports now leave the lock
  out, and imports skip one found in an older archive.
- `agentdocstore mcp` now shuts down cleanly when its MCP client disconnects
  (closes the server's stdin): it finishes the requests it has already
  received, then releases the data directory. Before, it exited without
  releasing the lock, so the next `mcp` or `serve` on that directory failed
  with "already locked" until the lock was removed by hand.
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
- The version diff no longer shows its file header as changes: `--- v1` and
  `+++ v2` rendered as a removed and an added line. Comparing two versions
  with the same content now says so instead of showing an empty box.
- Searching in the web UI showed only the first 20 matches, with no way to
  reach the rest. Search results now page with Load More, like the document
  list: `GET /api/documents?query=` returns `nextCursor` while more matches
  remain and accepts it back as `cursor`.
- Load More now moves keyboard focus to the first document it added. When it
  loaded the last page, the focused button disappeared and the next Tab
  started again from the top of the page.
- A long unbroken word (a pasted URL, hash or token) in a document title,
  rendered text or a comment now wraps instead of running off the right edge
  of a phone screen. Code blocks still scroll sideways.
- Size-limit errors now say how big the value was and what the limit is, over
  REST and MCP alike. A comment that is too long gets "Comment exceeds maximum
  length (10976 bytes; the limit is 10000 bytes)" instead of only "Comment
  exceeds maximum length", and titles and content say the same. The new core
  `sizeOverLimit` builds the detail.
- Code documents are syntax-highlighted again, in both themes. The token
  colours came from a bundled stylesheet that the page never loaded, so code
  always rendered in one colour; they now follow the light/dark theme.
- Mermaid diagrams follow the theme: they are drawn with Mermaid's light
  theme on the light page, and redrawn when the theme is toggled. Before,
  they always used the dark theme, which left arrows and edge labels nearly
  invisible on the light page.
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
- The first search after a document was created or saved could rank its
  results wrongly, even putting a weaker match first; repeating the search
  gave a different order. The search index now scores after dropping the
  entries that saving replaced.

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

[Unreleased]: https://github.com/koushikginjupally/agentdocstore/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/koushikginjupally/agentdocstore/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/koushikginjupally/agentdocstore/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/koushikginjupally/agentdocstore/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/koushikginjupally/agentdocstore/releases/tag/v0.1.0
