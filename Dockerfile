# ---- Build stage ----
FROM node:22-slim AS build

WORKDIR /app

# Copy package manifests first for layer caching.
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/core/package.json          packages/core/
COPY packages/provider-tests/package.json packages/provider-tests/
COPY packages/provider-memory/package.json packages/provider-memory/
COPY packages/provider-fs/package.json   packages/provider-fs/
COPY packages/server/package.json        packages/server/
COPY packages/mcp/package.json           packages/mcp/
COPY packages/web/package.json           packages/web/
COPY packages/cli/package.json           packages/cli/

RUN npm ci --ignore-scripts

# Copy all source and the reproducible-build helper.
COPY packages/ packages/
COPY scripts/clean.mjs scripts/clean.mjs
COPY scripts/finalize-build.mjs scripts/finalize-build.mjs
COPY scripts/bundle-cli.mjs scripts/bundle-cli.mjs

# Build everything (TypeScript + web bundle).
RUN npm run build

# ---- Runtime stage ----
FROM node:22-slim AS runtime

RUN groupadd --gid 1001 agentdocstore && \
    useradd --uid 1001 --gid 1001 --create-home agentdocstore

WORKDIR /app

# Copy only what's needed for runtime.
COPY --from=build /app/package.json         ./
COPY --from=build /app/node_modules         ./node_modules
COPY --from=build /app/packages/core/dist        packages/core/dist/
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/provider-tests/dist        packages/provider-tests/dist/
COPY --from=build /app/packages/provider-tests/package.json packages/provider-tests/
COPY --from=build /app/packages/provider-memory/dist        packages/provider-memory/dist/
COPY --from=build /app/packages/provider-memory/package.json packages/provider-memory/
COPY --from=build /app/packages/provider-fs/dist   packages/provider-fs/dist/
COPY --from=build /app/packages/provider-fs/package.json packages/provider-fs/
COPY --from=build /app/packages/server/dist        packages/server/dist/
COPY --from=build /app/packages/server/package.json packages/server/
COPY --from=build /app/packages/mcp/dist           packages/mcp/dist/
COPY --from=build /app/packages/mcp/package.json   packages/mcp/
COPY --from=build /app/packages/web/dist           packages/web/dist/
COPY --from=build /app/packages/web/package.json   packages/web/
COPY --from=build /app/packages/cli/dist           packages/cli/dist/
COPY --from=build /app/packages/cli/package.json   packages/cli/

# Data volume.
RUN mkdir -p /data && chown agentdocstore:agentdocstore /data
VOLUME /data

USER agentdocstore

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "packages/cli/dist/index.js"]
# --expose is required because 0.0.0.0 is not a loopback address. It accepts
# INBOUND connections (reachable through the operator's port mapping) while the
# instance stays in offline mode: outbound egress is still fused and a
# network-backed provider would still be refused. Add --networked only if you
# deliberately want this container to reach the network.
CMD ["serve", "--host", "0.0.0.0", "--port", "8787", "--data", "/data", "--expose"]
