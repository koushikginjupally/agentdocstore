#!/usr/bin/env node

/**
 * Publish a release's npm packages in dependency order: @agentdocstore/core,
 * @agentdocstore/provider-tests, then agentdocstore (the CLI, which depends on
 * core). Run by .github/workflows/publish.yml for a pushed v* tag.
 *
 *   node scripts/publish-packages.mjs v0.3.1 --check    # checks only
 *   node scripts/publish-packages.mjs v0.3.1 --dry-run  # checks, then npm publish --dry-run
 *   node scripts/publish-packages.mjs v0.3.1            # checks, then publishes
 *
 * It refuses to publish unless the tag names the version every package has,
 * the CLI and provider-tests ask for exactly that core (`^X.Y.Z`), the MCP
 * server reports it, and the publishable packages are exactly the three
 * above. A version already on npm is skipped, so a failed run can be re-run.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORDER = ['@agentdocstore/core', '@agentdocstore/provider-tests', 'agentdocstore'];
const CORE_DEPENDENTS = ['packages/cli/package.json', 'packages/provider-tests/package.json'];
/** Trusted publishing (OIDC) needs npm 11.5.1 or later. */
const MIN_NPM = [11, 5, 1];

const [tag, ...flags] = process.argv.slice(2);
const checkOnly = flags.includes('--check');
const dryRun = flags.includes('--dry-run');
const unknown = flags.filter((flag) => flag !== '--check' && flag !== '--dry-run');
if (tag === undefined || !tag.startsWith('v') || unknown.length > 0) {
  fail('Usage: node scripts/publish-packages.mjs vX.Y.Z [--check | --dry-run]');
}
const version = tag.slice(1);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(relative) {
  return JSON.parse(readFileSync(join(root, relative), 'utf8'));
}

// ---- Checks ----

const problems = [];
const manifests = [
  'package.json',
  ...readdirSync(join(root, 'packages')).map((dir) => `packages/${dir}/package.json`),
];
const publishable = [];
for (const path of manifests) {
  const pkg = readJson(path);
  if (pkg.version !== version) problems.push(`${path} has version ${pkg.version}, not ${version}`);
  if (pkg.private !== true) publishable.push(pkg.name);
}
if ([...publishable].sort().join() !== [...ORDER].sort().join()) {
  problems.push(
    `the publishable packages are ${publishable.join(', ')}; this script publishes ${ORDER.join(', ')}`,
  );
}
for (const path of CORE_DEPENDENTS) {
  const range = readJson(path).dependencies?.['@agentdocstore/core'];
  if (range !== `^${version}`)
    problems.push(`${path} asks for @agentdocstore/core ${range}, not ^${version}`);
}
const register = readFileSync(join(root, 'packages/mcp/src/register.ts'), 'utf8');
if (!register.includes(`version: '${version}'`)) {
  problems.push(`packages/mcp/src/register.ts does not report version '${version}'`);
}
const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
const npmParts = npmVersion.split('.').map(Number);
const npmTooOld = MIN_NPM.some((part, i) => {
  const same = MIN_NPM.slice(0, i).every((earlier, j) => npmParts[j] === earlier);
  return same && (npmParts[i] ?? 0) < part;
});
if (npmTooOld)
  problems.push(
    `npm ${npmVersion} is too old for trusted publishing; use ${MIN_NPM.join('.')} or later`,
  );

if (problems.length > 0) fail(`Not publishing ${tag}:\n- ${problems.join('\n- ')}`);
console.log(
  `${tag}: all packages are at ${version}; publishing ${ORDER.join(', ')} with npm ${npmVersion}.`,
);
if (checkOnly) process.exit(0);

// ---- Publish ----

/** True when name@version is already on the registry; throws on anything but a 404. */
function isPublished(name) {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(out) === version;
  } catch (err) {
    const out = typeof err.stdout === 'string' ? err.stdout : '';
    let code;
    try {
      code = JSON.parse(out).error?.code;
    } catch {
      code = undefined;
    }
    if (code === 'E404') return false;
    throw new Error(
      `Could not check whether ${name}@${version} is on npm: ${out.trim() || err.message}`,
      { cause: err },
    );
  }
}

for (const name of ORDER) {
  if (isPublished(name)) {
    console.log(`${name}@${version} is already on npm; skipping it.`);
    continue;
  }
  const args = ['publish', '--workspace', name];
  if (dryRun) args.push('--dry-run');
  console.log(`npm ${args.join(' ')}`);
  execFileSync('npm', args, { cwd: root, stdio: 'inherit' });
}
