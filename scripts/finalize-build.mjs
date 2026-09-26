#!/usr/bin/env node

/** Apply executable modes that TypeScript does not preserve when emitting files. */
import { chmodSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executables = [
  join(root, 'packages/cli/dist/index.js'),
  join(root, 'packages/mcp/dist/stdio.js'),
];

for (const path of executables) {
  if (existsSync(path)) chmodSync(path, 0o755);
}
