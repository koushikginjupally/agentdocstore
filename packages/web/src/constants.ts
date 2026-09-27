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
