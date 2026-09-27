#!/usr/bin/env node

/** Validate local Markdown links and balanced fenced-code blocks without adding a dependency. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const files = [];

function visit(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) visit(path);
    else if (extname(entry).toLowerCase() === '.md') files.push(path);
  }
}

visit(root);
const failures = [];

for (const file of files) {
  const body = readFileSync(file, 'utf8');
  const fences = body.match(/^```/gm)?.length ?? 0;
  if (fences % 2 !== 0) failures.push(`${file}: unbalanced fenced-code blocks`);

  const links = body.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g);
  for (const match of links) {
    let target = match[1];
    if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
    target = target.split('#', 1)[0].split('?', 1)[0];
    if (!target) continue;
    try {
      target = decodeURIComponent(target);
    } catch {
      failures.push(`${file}: malformed URL encoding in ${match[1]}`);
      continue;
    }
    const destination = resolve(dirname(file), target);
    if (!existsSync(destination)) failures.push(`${file}: missing local link target ${match[1]}`);
  }
}

// Stated conformance case counts must match the suite. A case was added once
// and every "59 cases" went stale. CHANGELOG.md is left alone: each release
// entry states the count it shipped with.
const suite = readFileSync(join(root, 'packages/provider-tests/src/conformance.ts'), 'utf8');
const cases = suite.match(/^\s+it\(/gm)?.length ?? 0;
for (const file of files) {
  if (file.endsWith('CHANGELOG.md')) continue;
  const body = readFileSync(file, 'utf8');
  for (const match of body.matchAll(
    /\b(\d+)(?:-case\b|\s+(?:conformance\s+|Vitest\s+)?cases\b)/g,
  )) {
    if (Number(match[1]) !== cases) {
      failures.push(`${file}: says ${match[1]} conformance cases; the suite has ${cases}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Documentation check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure.replace(`${root}/`, '')}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed: ${files.length} Markdown files.`);
}
