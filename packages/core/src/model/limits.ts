/**
 * Size caps enforced across the app. Content is capped at write time (never
 * stored oversized); the diff-input cap bounds the diff engine's inputs.
 */
export const LIMITS = {
  /** Max doc title length in UTF-8 bytes. */
  MAX_TITLE_BYTES: 300,
  /** Max stored content per version in UTF-8 bytes (write-time reject). */
  MAX_CONTENT_BYTES: 5 * 1024 * 1024,
  /** Max input size (per side) accepted by the diff engine in UTF-8 bytes. */
  MAX_DIFF_INPUT_BYTES: 2 * 1024 * 1024,
  /** Max comment body length in UTF-8 bytes. */
  MAX_COMMENT_BYTES: 10_000,
  /** Max edit message length in characters, after trimming. */
  MAX_EDIT_MESSAGE_CHARS: 500,
  /** Longest expiry, in days from now (about 100 years). Much further is not a date. */
  MAX_EXPIRY_DAYS: 36_500,
} as const;

/** The shape of {@link LIMITS}. */
export type Limits = typeof LIMITS;

/**
 * The detail for a size-limit error: "10976 bytes; the limit is 10000 bytes".
 * Size errors carry it so a REST or MCP client learns how much to cut, not
 * only that the value was too big.
 */
export function sizeOverLimit(size: number, limit: number): string {
  return `${size} bytes; the limit is ${limit} bytes`;
}
