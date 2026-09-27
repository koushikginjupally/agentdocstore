# `@agentdocstore/provider-tests`

The reusable conformance suite for
[AgentDocStore](https://github.com/koushikginjupally/agentdocstore) storage providers.

It registers 60 Vitest cases covering CRUD, compare-and-set conflicts, immutable
versions, stable pagination, opaque cursors, private-search isolation, Unicode
and size boundaries, expiry, comments, capabilities and delete cascades.

## Install

```bash
npm install --save-dev @agentdocstore/provider-tests vitest
npm install @agentdocstore/core
```

Vitest is a peer dependency so the tests register in **your** runner.

## Use

```ts
import { runProviderConformance } from '@agentdocstore/provider-tests';
import { createProvider } from '../src/index.js';

runProviderConformance('my provider', async () => {
  const provider = await createProvider({ testDatabase: true });
  return {
    provider,
    cleanup: async () => provider.close(),
  };
});
```

```bash
npx vitest run
```

Use an isolated database/schema/bucket per test factory. The suite creates and
deletes records and must never point at production data.

Passing this suite is necessary but not sufficient: run
`agentdocstore doctor --provider <your-module>` against a realistic local setup,
and test provider-specific failure, reconnect, migration and concurrency paths.
See the full [provider SPI guide](../../docs/PROVIDERS.md).

## Compatibility

Keep this package on the same minor version as `@agentdocstore/core`. AgentDocStore
is pre-1.0, so minor releases may evolve the contract; breaking changes are
called out in the root [CHANGELOG](../../CHANGELOG.md).

## License

Apache-2.0.
