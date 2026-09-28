#!/usr/bin/env node

/** Remove generated package output before a reproducible build. */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requested = process.argv.slice(2);
const packageRoots =
  requested.length > 0
    ? requested.map((path) => resolve(root, path))
    : readdirSync(join(root, 'packages'))
        .map((name) => join(root, 'packages', name))
        .filter((path) => statSync(path).isDirectory());

for (const packageRoot of packageRoots) {
  if (!packageRoot.startsWith(`${join(root, 'packages')}/`)) {
    throw new Error(`Refusing to clean outside packages/: ${packageRoot}`);
  }
  rmSync(join(packageRoot, 'dist'), { recursive: true, force: true });
  rmSync(join(packageRoot, 'bundle'), { recursive: true, force: true });
  rmSync(join(packageRoot, 'tsconfig.tsbuildinfo'), { force: true });
}

rmSync(join(root, 'tsconfig.tsbuildinfo'), { force: true });
console.error(`Cleaned generated output for ${packageRoots.length} package(s).`);
