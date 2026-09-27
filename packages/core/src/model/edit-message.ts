import { ValidationError } from '../errors.js';
import { LIMITS } from './limits.js';

/**
 * Normalize an editor's note before it is stored on a version: trim it, treat
 * a blank note as no note, and reject one longer than
 * {@link LIMITS.MAX_EDIT_MESSAGE_CHARS}. REST and MCP both call this so the
 * two surfaces store the same thing.
 */
export function normalizeEditMessage(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const message = raw.trim();
  if (message.length === 0) return undefined;
  if (message.length > LIMITS.MAX_EDIT_MESSAGE_CHARS) {
    throw new ValidationError(
      `Edit message must be at most ${LIMITS.MAX_EDIT_MESSAGE_CHARS} characters`,
    );
  }
  return message;
}
