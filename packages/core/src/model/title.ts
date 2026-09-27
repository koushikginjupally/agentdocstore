import { ValidationError } from '../errors.js';
import { LIMITS, sizeOverLimit } from './limits.js';

/**
 * Reject a title the built-in providers would refuse: blank, or longer than
 * {@link LIMITS.MAX_TITLE_BYTES} bytes of UTF-8. REST and MCP call this before
 * their first write, so an update with a bad title saves nothing — the
 * provider's own check would only fire after the new version was stored.
 */
export function validateTitle(title: string): void {
  if (title.trim().length === 0) throw new ValidationError('Title must not be empty');
  const size = Buffer.byteLength(title, 'utf8');
  if (size > LIMITS.MAX_TITLE_BYTES) {
    throw new ValidationError(
      `Title exceeds maximum length (${sizeOverLimit(size, LIMITS.MAX_TITLE_BYTES)})`,
    );
  }
}
