/** Build the document.title string for a page. */
export function buildTitle(documentTitle?: string): string {
  if (documentTitle) {
    return `${documentTitle} \u00b7 AgentDocStore`;
  }
  return 'AgentDocStore';
}

/** Header wordmark; centralized so product branding is testable. */
export const WORDMARK_HTML = 'Agent<span class="accent">Doc</span>Store';

/** The exact sandbox attribute value for HTML doc iframes. */
export const HTML_IFRAME_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

/** Maximum content column width CSS value. */
export const CONTENT_MAX_WIDTH = 'min(1920px, 96vw)';

/**
 * Message for an empty document list. A search that matches nothing must not
 * claim the user has no documents; it names the query instead. The query is
 * returned as plain text — callers must set it with textContent, never HTML.
 */
export function emptyListMessage(query: string): string {
  const q = query.trim();
  if (q.length === 0) return 'No documents yet. Create your first one above!';
  return `No documents match “${q}”. Try different words, or clear the search to see all your documents.`;
}

/**
 * How many documents a search matched, in words. No matches reads the same as
 * the empty list. The query is plain text — set it with textContent.
 */
export function searchCountMessage(total: number, query: string): string {
  const q = query.trim();
  if (total === 0) return emptyListMessage(q);
  return total === 1 ? `1 document matches “${q}”` : `${total} documents match “${q}”`;
}

/** Matches LIMITS.MAX_COMMENT_BYTES on the server (a test keeps them equal). */
export const MAX_COMMENT_BYTES = 10_000;

/** Matches LIMITS.MAX_TITLE_BYTES on the server (a test keeps them equal). */
export const MAX_TITLE_BYTES = 300;

const utf8 = new TextEncoder();

/** Length in UTF-8 bytes, the unit the server's size limits are counted in. */
export function utf8Bytes(text: string): number {
  return utf8.encode(text).length;
}

const count = (n: number): string => n.toLocaleString('en-US');

/**
 * The note under the comment box: nothing for a short comment, the size from
 * 90% of the limit, and how much to cut once the comment is over it.
 */
export function commentSizeMessage(bytes: number): string {
  if (bytes < MAX_COMMENT_BYTES * 0.9) return '';
  const size = `${count(bytes)} of ${count(MAX_COMMENT_BYTES)} bytes`;
  if (bytes <= MAX_COMMENT_BYTES) return size;
  const over = bytes - MAX_COMMENT_BYTES;
  return `${size}. Shorten the comment by ${count(over)} ${over === 1 ? 'byte' : 'bytes'} to post it.`;
}
