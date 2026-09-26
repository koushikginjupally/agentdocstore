# Releasing AgentDocStore

AgentDocStore is pre-1.0 and follows Semantic Versioning. The repository, the two
publishable packages, the changelog heading and the Git tag must use the same
version.

## Before the first public release

The repository metadata targets
`github.com/koushikginjupally/agentdocstore`. If the repository is created under
a different owner or name, update those URLs before tagging. Then enable:

- **Settings → Security → Private vulnerability reporting**.
- **Settings → Code security**: Dependabot alerts and CodeQL default or advanced
  setup (the repository includes the advanced workflow).
- Branch protection/rulesets for `main`: require pull requests and the CI checks.

## Prepare

1. Start from a clean `main` and choose the version.
2. Update versions in the root, `@agentdocstore/core`, and
   `@agentdocstore/provider-tests` package manifests. Update inter-package ranges.
3. Move entries from `Unreleased` to a dated heading in `CHANGELOG.md`; update
   its comparison links.
4. Run the complete gate:

   ```bash
   npm ci
   npm run verify
   npm pack --dry-run --workspace @agentdocstore/core
   npm pack --dry-run --workspace @agentdocstore/provider-tests
   ```

5. Inspect each dry-run file list: no source maps, logs, local paths, credentials,
   generated verification report, or unpublished package should appear.
6. Commit with `chore: release vX.Y.Z` and review the diff.

## Tag and GitHub release

Create an annotated tag only after the release commit is on `main`:

```bash
git tag -a vX.Y.Z -m "AgentDocStore vX.Y.Z"
git push origin vX.Y.Z
```

Create a GitHub Release from the tag and use the changelog section as its notes.
Do not describe a release as verified unless `npm run verify` passed on that
exact commit; record Docker-dependent skips.

## npm packages

Only these packages are intended for npm:

1. `@agentdocstore/core`
2. `@agentdocstore/provider-tests`

The application packages remain private until a separate packaging design makes
the CLI self-contained. Publish core first, then the conformance kit, using npm
trusted publishing/provenance where possible. Never put a long-lived npm token in
the repository or a workflow file.

## After release

- Verify the GitHub source archive can build from a clean directory.
- Install each published package in a throwaway project and import its public
  entry point.
- Restore the empty `Unreleased` section for the next change.
- Announce known issues exactly as listed in `CHANGELOG.md`.
