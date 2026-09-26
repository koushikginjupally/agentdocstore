import { customAlphabet } from 'nanoid';

/**
 * URL-safe id alphabet. Deliberately excludes `/`, `.`, and whitespace so a
 * valid id can never encode a path segment or traversal sequence — this is the
 * primary path-traversal defense used by filesystem-backed providers.
 */
export const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** Fixed id length. */
export const ID_LENGTH = 10;

const generate = customAlphabet(ID_ALPHABET, ID_LENGTH);

/** Generate a fresh URL-safe id. */
export function newId(): string {
  return generate();
}

/** Matches exactly {@link ID_LENGTH} chars from {@link ID_ALPHABET}. */
const ID_PATTERN = /^[A-Za-z0-9_-]{10}$/;

/**
 * Type guard: `true` only for a string that is exactly a well-formed id.
 * Providers MUST call this before constructing any path from a caller-supplied
 * id, so values like `..`, `../x`, or `a/b` are rejected before touching the
 * filesystem.
 */
export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}
