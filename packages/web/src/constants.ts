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
