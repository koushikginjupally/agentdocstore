/**
 * An immutable version of a {@link Document}'s content. Versions are append-only and
 * addressed by a 1-based monotonic number; the doc's `latestVersion` points at
 * the newest one.
 */
export interface DocumentVersion {
  /** Owning doc id. */
  readonly documentId: string;
  /** 1-based monotonic version number. */
  readonly version: number;
  /** Raw content of this version. */
  readonly content: string;
  /** Identity that authored this version. */
  readonly createdBy: string;
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
}
