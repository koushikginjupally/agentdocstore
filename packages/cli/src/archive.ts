/**
 * `agentdocstore export <file.tgz>` / `agentdocstore import <file.tgz>`
 *
 * Portable archive of the filesystem data directory.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function runExport(file: string, dataDir: string): void {
  const dir = resolve(dataDir);
  if (!existsSync(dir)) {
    console.error(`Data directory does not exist: ${dir}`);
    process.exit(1);
  }

  const outPath = resolve(file);
  console.log(`Exporting data from ${dir} to ${outPath} ...`);

  execFileSync('tar', ['-czf', outPath, '-C', dir, '.'], { stdio: 'inherit' });
  console.log('Export complete.');
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Check whether a directory is non-empty (has any entries besides `.` and `..`).
 */
export function isDirNonEmpty(dir: string): boolean {
  if (!existsSync(dir)) return false;
  const entries = readdirSync(dir);
  return entries.length > 0;
}

export function runImport(file: string, dataDir: string, force: boolean): void {
  const dir = resolve(dataDir);
  const archivePath = resolve(file);

  if (!existsSync(archivePath)) {
    console.error(`Archive file not found: ${archivePath}`);
    process.exit(1);
  }

  if (isDirNonEmpty(dir) && !force) {
    console.error(
      `Data directory is not empty: ${dir}\n` + 'Use --force to overwrite existing data.',
    );
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });
  console.log(`Importing data from ${archivePath} to ${dir} ...`);

  execFileSync('tar', ['-xzf', archivePath, '-C', dir], { stdio: 'inherit' });
  console.log('Import complete.');
}
