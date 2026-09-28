# agentdocstore

An offline-first, self-hosted store for the documents AI agents write: plans,
reviews, runbooks, diagrams and logs. One versioned store behind a web UI, a
REST API and an MCP server. Nothing leaves your machine unless you say so.

Requires Node.js 22 or newer.

## Run it

```bash
npx agentdocstore serve               # persistent, stored in ~/.agentdocstore/data
npx agentdocstore serve --ephemeral   # in-memory, gone on exit
```

Then open <http://127.0.0.1:8787>.

`npx` fetches this package from npm when it starts. On a machine without network
access, install it once with `npm install -g agentdocstore` and run
`agentdocstore serve`.

## Use it from an AI assistant (MCP)

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

With a global install, use `"command": "agentdocstore"` and `"args": ["mcp"]`
instead: it starts faster and needs no network.

## Documentation

Configuration, the REST API, the 16 MCP tools, storage providers, hosting and
security are documented in the
[repository](https://github.com/koushikginjupally/agentdocstore).

Licensed under Apache-2.0.
