# Security Policy

## Supported versions

AgentDocStore is pre-1.0. Security fixes land on the latest release only.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/koushikginjupally/agentdocstore/security/advisories/new)
(Security → Report a vulnerability).

Include what you have: affected version or commit, configuration (auth mode,
provider, runtime mode), reproduction steps, and the impact you believe it has.
A proof of concept helps but is not required to file.

What to expect: an acknowledgement within a few days, an assessment with a
severity and a fix plan, and credit in the release notes unless you prefer
otherwise. If a report turns out to describe documented behaviour rather than a
defect, we will say so and point at the document — see
[`docs/SECURITY.md`](docs/SECURITY.md), which describes the threat model and the
limits that are intentional.

## Please report

- Reading, editing or deleting another user's `PRIVATE` document under any auth mode
  or surface (REST, `/raw`, comments, list, search, MCP).
- Bypassing authentication, or acting as another identity on `/mcp`.
- Escaping the data directory through a document id, a version number or any other
  user-supplied path component.
- Escaping the HTML render sandbox into the app origin, or XSS through rendered
  Markdown, Mermaid or highlighted code.
- Reaching the network from a process running in `offline` mode through a path
  the documented limits do not already exclude.
- Anything that lets a caller read stored content they are not entitled to.

## Known and documented, so not a vulnerability by itself

These are stated limits, not oversights. A report that only restates one will be
closed with a pointer; a report that shows the limit is worse than documented is
very welcome.

- **The network fuse is a guard rail, not a sandbox.** `child_process` and raw
  `dgram` are not covered. A hard guarantee is a container with no network
  interface — see [`scripts/airgap-test.sh`](scripts/airgap-test.sh).
- **`trusted-header` mode trusts its header.** The reverse proxy must strip it
  from client traffic; the server warns at startup and cannot verify it.
- **`token` mode has no expiry or rotation.** Tokens are static strings in a
  file you control.
- **The credential scanner is best-effort.** It catches common shapes, not all
  secrets, and is not a substitute for not pasting them.
- **Documents are not encrypted at rest.** Filesystem permissions and disk
  encryption are the operator's responsibility.
