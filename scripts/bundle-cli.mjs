#!/usr/bin/env node

/**
 * Bundle the CLI for npm. The CLI and the internal packages it runs (the
 * server, the MCP tools and the built-in fs and memory providers) become one
 * file, packages/cli/bundle/index.js, with a copy of the web UI beside it in
 * bundle/web/. Every other package stays a runtime dependency.
 *
 * @agentdocstore/core is deliberately not bundled. The server, MCP tools and
 * CLI recognise core's errors with instanceof, and a third-party provider
 * throws them from its own import of core; a private copy inside the bundle
 * would make those errors unrecognisable.
 *
 * The build fails if the bundle imports a package that packages/cli/package.json
 * does not list in dependencies (an npm install would then crash with "Cannot
 * find package"), lists one it never imports, or leaves an internal package to
 * be loaded at run time.
 */

import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { chmodSync, cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliDir = join(root, 'packages/cli');
const outDir = join(cliDir, 'bundle');
const entry = join(cliDir, 'dist/index.js');
const webDist = join(root, 'packages/web/dist');

/** Internal packages compiled into the bundle. */
const BUNDLED = new Set([
  '@agentdocstore/mcp',
  '@agentdocstore/provider-fs',
  '@agentdocstore/provider-memory',
  '@agentdocstore/server',
]);

const builtins = new Set(builtinModules);
const isBuiltin = (specifier) => specifier.startsWith('node:') || builtins.has(specifier);

/** 'hono/body-limit' → 'hono'; '@scope/name/sub' → '@scope/name'. */
function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Leave every bare import external except the internal packages above. */
const keepDependenciesExternal = {
  name: 'keep-dependencies-external',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (isBuiltin(args.path) || !BUNDLED.has(packageName(args.path))) {
        return { path: args.path, external: true };
      }
      return undefined;
    });
  },
};

if (!existsSync(entry)) {
  throw new Error(`Compile the CLI first: ${entry} is missing. Run npm run build.`);
}
if (!existsSync(join(webDist, 'index.html'))) {
  throw new Error(`Build the web UI first: ${webDist} has no index.html. Run npm run build.`);
}

rmSync(outDir, { recursive: true, force: true });
const result = await build({
  entryPoints: [entry],
  outfile: join(outDir, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  metafile: true,
  logLevel: 'warning',
  plugins: [keepDependenciesExternal],
});

const pkg = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8'));
const declared = new Set(Object.keys(pkg.dependencies ?? {}));
const imported = new Set();
for (const input of Object.values(result.metafile.inputs)) {
  for (const imp of input.imports) {
    if (imp.external && !isBuiltin(imp.path)) imported.add(packageName(imp.path));
  }
}

const problems = [];
for (const name of [...imported].sort()) {
  if (name.startsWith('@agentdocstore/') && name !== '@agentdocstore/core') {
    problems.push(`${name} is loaded at run time instead of being bundled`);
  } else if (!declared.has(name)) {
    problems.push(
      `the bundle imports ${name}, which packages/cli/package.json does not list in dependencies`,
    );
  }
}
for (const name of [...declared].sort()) {
  if (!imported.has(name)) {
    problems.push(
      `packages/cli/package.json lists ${name} in dependencies, but the bundle never imports it`,
    );
  }
}
if (problems.length > 0) {
  rmSync(outDir, { recursive: true, force: true });
  throw new Error(`CLI bundle check failed:\n- ${problems.join('\n- ')}`);
}

cpSync(webDist, join(outDir, 'web'), { recursive: true });
chmodSync(join(outDir, 'index.js'), 0o755);
console.error(
  `Bundled the CLI into packages/cli/bundle/ (${imported.size} runtime dependencies, web UI copied).`,
);
