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
} as const;

/** The shape of {@link LIMITS}. */
export type Limits = typeof LIMITS;
