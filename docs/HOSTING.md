# Hosting Guide

How to run AgentDocStore in different environments: local, LAN, behind a reverse
proxy, in Docker, and as a systemd service.

## Data directory

The filesystem provider stores all data under a single directory (default:
`~/.agentdocstore/data`). Override with `--data <path>` or the
`AGENTDOCSTORE_DATA_DIR` environment variable.

```
~/.agentdocstore/data/
  documents/<id>/meta.json
  documents/<id>/versions/1.txt
  documents/<id>/versions/2.txt
  documents/<id>/comments.json
  index/snapshot.json
  .agentdocstore.lock/
```

- **meta.json** — document metadata (title, language, visibility, timestamps).
- **versions/N.txt** — immutable version content files.
- **comments.json** — comment threads per document.
- **index/snapshot.json** — MiniSearch index snapshot (rebuilt automatically if
  missing or corrupt).
- **.agentdocstore.lock/** — advisory lock directory (prevents two instances from
  sharing one data dir). It is removed when the instance stops, including when
  an MCP client disconnects from `agentdocstore mcp`. After a hard kill (for
  example `kill -9`) it stays; remove it by hand once no instance is running.

### Backup

The data directory is self-contained. To back up:

```bash
# Stop the server first (or accept a point-in-time snapshot)
tar czf agentdocstore-backup-$(date +%Y%m%d).tar.gz ~/.agentdocstore/data
```

To restore:

```bash
tar xzf agentdocstore-backup-20260911.tar.gz -C ~/
```

The search index will be rebuilt automatically on next startup if it is missing
or corrupt — you can safely omit `index/snapshot.json` from backups.

### Export / Import (CLI)

The CLI provides portable export and import (once the CLI is built):

```bash
# Export the entire data directory to a tarball
npx agentdocstore export backup.tgz

# Import into a new data directory
npx agentdocstore import backup.tgz --data /new/path
```

## Runtime modes

Every hosting recipe below is a combination of two independent switches:

| Switch   | Default       | Opt out with  | Governs                                                 |
| -------- | ------------- | ------------- | ------------------------------------------------------- |
| `mode`   | `offline`     | `--networked` | Outbound egress; a provider declaring `requiresNetwork` |
| `expose` | loopback only | `--expose`    | Inbound: binding a non-loopback address                 |

Offline mode is enforced, not advisory: a non-loopback bind is a hard startup
failure without `--expose`, a networked provider is refused without
`--networked`, and outbound sockets are fused. See
[SECURITY.md](SECURITY.md#runtime-modes-offline-is-enforced-not-documented).

The boot banner and `GET /healthz` both state which mode you are in.

## Local (single user)

The simplest setup, and all defaults. The server binds `127.0.0.1` and
attributes all requests to the OS username.

```bash
# Persistent storage
npx agentdocstore serve

# Ephemeral (in-memory, data lost on exit)
npx agentdocstore serve --ephemeral

# Custom port and data directory
npx agentdocstore serve --port 9090 --data ~/my-documents
```

## LAN (trusted-header behind a proxy)

For shared access on a local network, run behind a reverse proxy that handles
authentication and sets an identity header.

Two flags matter here: `--expose` to accept inbound on a non-loopback address
(the instance stays offline — egress is still fused), and `--trusted-header` if
your proxy uses a header other than the default `x-forwarded-user`.

```bash
npx agentdocstore serve --auth trusted-header \
  --trusted-header x-forwarded-user \
  --host 127.0.0.1 --port 8787
```

Binding `127.0.0.1` and letting the proxy reach it over loopback is the safest
arrangement — then you need no `--expose` at all.

```bash
npx agentdocstore serve \
  --auth trusted-header \
  --port 3000
```

The server reads identity from `X-Forwarded-User` by default.

**Critical:** Your reverse proxy **must** strip the `X-Forwarded-User` header
from incoming client traffic. If clients can set it directly, they can
impersonate any user.

### nginx example

```nginx
server {
    listen 443 ssl;
    server_name documents.local;

    # ... TLS config ...

    # Strip the identity header from client requests
    proxy_set_header X-Forwarded-User "";

    # Your auth module sets it
    auth_request /auth;
    auth_request_set $auth_user $upstream_http_x_auth_user;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header X-Forwarded-User $auth_user;
        proxy_set_header Host $host;
    }
}
```

### Caddy example

```
documents.local {
    forward_auth localhost:4181 {
        uri /api/v1/auth
        copy_headers X-Forwarded-User
    }
    reverse_proxy 127.0.0.1:3000 {
        header_up -X-Forwarded-User
        header_up X-Forwarded-User {http.auth.user}
    }
}
```

### oauth2-proxy

A common pattern is `oauth2-proxy` in front of AgentDocStore:

```bash
oauth2-proxy \
  --upstream=http://127.0.0.1:3000 \
  --pass-user-headers=true \
  --set-xauthrequest=true \
  --http-address=0.0.0.0:4180
```

oauth2-proxy sets `X-Forwarded-User` automatically after authentication.

## Token mode (remote API/MCP access)

For remote access without a proxy, use static bearer tokens:

```bash
npx agentdocstore serve \
  --auth token \
  --tokens /etc/agentdocstore/tokens.json \
  --host 0.0.0.0 --expose \
  --port 8787
```

`--tokens` is **required** for token mode — there is no default path. Startup
refuses a missing, empty or malformed file, naming it, because an empty map would
reject every caller and look like a broken server:

```json
{
  "abc123secret": "alice",
  "def456secret": "bob"
}
```

Keep the file readable only by the service user (`chmod 600`). Callers include
`Authorization: Bearer abc123secret` in every request, and the same credential
authenticates `/mcp`.

## Docker

### Build

```bash
docker build -t agentdocstore .
```

### Run

```bash
docker run -d \
  -p 8787:8787 \
  -v agentdocstore-data:/data \
  --name agentdocstore \
  agentdocstore
```

The container runs as a non-root user and stores data at `/data` inside the
container. Mount a named volume or host directory to persist.

The shipped `CMD` is `serve --host 0.0.0.0 --port 8787 --data /data --expose`.
`--expose` is required because `0.0.0.0` is not loopback — but the container
stays in **offline** mode: egress is fused and a network-backed provider would
still be refused. Add `--networked` only if the container deliberately needs to
reach a remote store:

```bash
docker run -d -p 8787:8787 -v agentdocstore-data:/data agentdocstore \
  serve --host 0.0.0.0 --port 8787 --data /data --expose --networked \
  --provider @acme/agentdocstore-provider-pg \
  --provider-options '{"url":"postgres://db/agentdocstore"}'
```

For the strongest offline posture, give the container no egress route at all
(`--network` with no gateway, or an egress-denying network policy). The fuse
makes an accidental leak fail loudly; the network namespace makes it impossible.

### Docker Compose

```yaml
version: '3.8'
services:
  agentdocstore:
    build: .
    ports:
      - "8787:8787"
    volumes:
      - agentdocstore-data:/data
    environment:
      - AGENTDOCSTORE_DATA_DIR=/data
    restart: unless-stopped

volumes:
  agentdocstore-data:
```

```bash
docker compose up -d
```

## systemd service

For running on a Linux server without Docker:

```ini
# /etc/systemd/system/agentdocstore.service
[Unit]
Description=AgentDocStore document server
After=network.target

[Service]
Type=simple
User=agentdocstore
Group=agentdocstore
WorkingDirectory=/opt/agentdocstore
ExecStart=/usr/document/node packages/cli/dist/index.js serve \
  --port 8787 \
  --data /var/lib/agentdocstore/data \
  --auth trusted-header
Restart=on-failure
RestartSec=5

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/agentdocstore
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now agentdocstore
```

## Environment variables

| Variable                         | Description                                          | Default                 |
| -------------------------------- | ---------------------------------------------------- | ----------------------- |
| `AGENTDOCSTORE_PORT`             | Server port                                          | `8787`                  |
| `AGENTDOCSTORE_HOST`             | Bind address                                         | `127.0.0.1`             |
| `AGENTDOCSTORE_DATA_DIR`         | Data directory                                       | `~/.agentdocstore/data` |
| `AGENTDOCSTORE_AUTH`             | Auth mode (`single-user`, `trusted-header`, `token`) | `single-user`           |
| `AGENTDOCSTORE_MODE`             | `offline` or `networked`                             | `offline`               |
| `AGENTDOCSTORE_EXPOSE`           | Accept non-loopback inbound (`1`/`true`)             | `false`                 |
| `AGENTDOCSTORE_PROVIDER`         | `fs`, `memory`, or a module specifier                | `fs`                    |
| `AGENTDOCSTORE_PROVIDER_OPTIONS` | JSON options for the provider                        | `{}`                    |
| `AGENTDOCSTORE_USER`             | Identity for `single-user` auth                      | OS login                |
| `AGENTDOCSTORE_TOKENS`           | Path to the token → username map                     | none                    |
| `AGENTDOCSTORE_TRUSTED_HEADER`   | Identity header name                                 | `x-forwarded-user`      |
| `AGENTDOCSTORE_EPHEMERAL`        | Use in-memory storage (`1`/`true`)                   | `false`                 |
| `AGENTDOCSTORE_CONFIG`           | Path to `agentdocstore.config.json`                  | none                    |

CLI flags take precedence over environment variables, which take precedence over
the config file.

## Monitoring

- `GET /healthz` — HTTP 200 with the runtime mode and store descriptor:

  ```json
  {
    "status": "ok",
    "mode": "offline",
    "provider": { "name": "fs", "search": "core-fallback",
                  "nativeTtl": false, "requiresNetwork": false }
  }
  ```

  A provider implementing `healthCheck()` adds a `store` object; when it reports
  unhealthy the endpoint returns **503** and `"status": "degraded"`, so a
  load-balancer check catches a dead database rather than a process that is
  merely still running.

- `agentdocstore doctor` — validates the configured provider (capabilities, health,
  conformance smoke checks) and exits non-zero on failure. Useful as a
  pre-deployment gate for a third-party store.
- `GET /api/whoami` — returns the resolved identity for the current request.
  Useful for debugging auth configuration.
- Server logs to stdout. Unhandled errors are logged with `[server]` prefix;
  stack traces are never sent to clients.
