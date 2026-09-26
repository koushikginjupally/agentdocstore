# `@agentdocstore/core`

Domain model and extension contracts for
[AgentDocStore](https://github.com/koushikginjupally/agentdocstore), an offline-first,
self-hostable artifact-sharing service.

This package is the stable surface for storage-provider authors. It exports:

- `Provider`, `ProviderModule`, `DocumentRepository`, `CommentStore`, `SearchIndex`
  and `Capabilities`.
- Document, version, comment, page and search types.
- Typed errors including `VersionConflictError`, `NotFoundError`,
  `ValidationError` and `ContentTooLargeError`.
- Authorization helpers, id generation/validation, the credential scanner,
  redaction, the diff engine and the MiniSearch-backed fallback index.

## Install

```bash
npm install @agentdocstore/core
```

## Provider module shape

```ts
import type { ProviderModule } from '@agentdocstore/core';

export const providerName = 'example';
export const optionsSchema = {
  parse(value: unknown) {
    // Validate and return typed options, or throw a helpful error.
    return value;
  },
};

export const createProvider: ProviderModule['createProvider'] = async (options) => {
  return makeYourProvider(options);
};
```

A provider must declare whether it needs a network, implement compare-and-set
version appends, keep versions immutable, hide private search results, and make
delete cascade through versions/comments/search. Do not rely on this summary as
the contract: read the complete [provider SPI guide](../../docs/PROVIDERS.md)
and prove the implementation with `@agentdocstore/provider-tests`.

## Compatibility

AgentDocStore is pre-1.0. The package follows semantic versioning, but a minor
release may change the SPI; such changes are called out in the root
[CHANGELOG](../../CHANGELOG.md).

## License

Apache-2.0.
