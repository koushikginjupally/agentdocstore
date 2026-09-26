/** A comment attached to a {@link Document}. */
export interface Comment {
  /** URL-safe comment id. */
  readonly id: string;
  /** Owning doc id. */
  readonly documentId: string;
  /** Identity that authored the comment. */
  readonly author: string;
  /** Comment body text. */
  body: string;
  /** Whether the comment has been marked resolved. */
  resolved: boolean;
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
  /** ISO-8601 last-update timestamp. */
  updatedAt: string;
}
