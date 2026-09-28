/**
 * Unified-diff generation backed by the `diff` npm package.
 *
 * Provides a single function {@link unifiedDiff} that produces a standard
 * unified diff string from two content strings, with a configurable size cap
 * to prevent runaway memory use on very large inputs.
 */

import { createTwoFilesPatch } from 'diff';

import { ContentTooLargeError } from './errors.js';
import { LIMITS } from './model/limits.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for {@link unifiedDiff}. */
export interface UnifiedDiffOptions {
  /** Label for the old file in the diff header. */
  readonly oldLabel?: string;
  /** Label for the new file in the diff header. */
  readonly newLabel?: string;
  /** Number of unchanged context lines around each hunk. */
  readonly context?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Produce a unified diff between two content strings.
 *
 * Returns an empty string when `oldContent` and `newContent` are identical
 * (byte-equal). Throws {@link ContentTooLargeError} if either input exceeds
 * {@link LIMITS.MAX_DIFF_INPUT_BYTES}, or if the diff would add or remove
 * more than {@link LIMITS.MAX_DIFF_CHANGED_LINES} lines.
 *
 * @param oldContent - The original content.
 * @param newContent - The updated content.
 * @param opts       - Optional labels and context lines.
 * @returns A unified diff string, or `''` when inputs are identical.
 */
export function unifiedDiff(
  oldContent: string,
  newContent: string,
  opts?: UnifiedDiffOptions,
): string {
  // Size guard — measure byte length, not character count.
  const oldBytes = Buffer.byteLength(oldContent, 'utf8');
  const newBytes = Buffer.byteLength(newContent, 'utf8');
  const limit = LIMITS.MAX_DIFF_INPUT_BYTES;

  if (oldBytes > limit) {
    throw new ContentTooLargeError(
      `Old content exceeds diff size limit (${oldBytes} > ${limit} bytes)`,
      limit,
      oldBytes,
    );
  }
  if (newBytes > limit) {
    throw new ContentTooLargeError(
      `New content exceeds diff size limit (${newBytes} > ${limit} bytes)`,
      limit,
      newBytes,
    );
  }

  // Identical inputs produce no diff.
  if (oldContent === newContent) return '';

  const oldLabel = opts?.oldLabel ?? 'a';
  const newLabel = opts?.newLabel ?? 'b';
  const context = opts?.context ?? 3;

  // The search grows with the square of the lines that differ and runs on
  // the caller's thread, so stop it at the cap rather than let two versions
  // that share few lines hold the server for minutes.
  const maxEditLength = LIMITS.MAX_DIFF_CHANGED_LINES;
  const patch = createTwoFilesPatch(oldLabel, newLabel, oldContent, newContent, '', '', {
    context,
    maxEditLength,
  });
  if (patch === undefined) {
    throw new ContentTooLargeError(
      `Too many changes to diff: more than ${maxEditLength} lines added or removed`,
      maxEditLength,
    );
  }
  return patch;
}
