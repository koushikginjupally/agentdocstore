/**
 * Language-to-renderer mapping. Determines how content is rendered in the view page.
 *
 * Renderer types:
 * - 'markdown'  -> marked + DOMPurify
 * - 'mermaid'   -> mermaid with securityLevel: 'strict'
 * - 'code'      -> highlight.js with line numbers
 * - 'html'      -> sandboxed iframe
 * - 'json'      -> pretty-print toggle (display-only)
 * - 'plaintext' -> pre-formatted text
 */

export type RendererType = 'markdown' | 'mermaid' | 'code' | 'html' | 'json' | 'plaintext';

/** Map a language to its renderer type. */
export function getRendererType(language: string): RendererType {
  switch (language) {
    case 'markdown':
      return 'markdown';
    case 'mermaid':
      return 'mermaid';
    case 'html':
      return 'html';
    case 'json':
      return 'json';
    case 'plaintext':
    case 'text':
      return 'plaintext';
    default:
      // All other languages use highlight.js code rendering
      return 'code';
  }
}

/**
 * The complete language -> renderer map (for testing / introspection).
 * Every language from the core LANGUAGES list maps to one of the renderer types.
 */
export const LANGUAGE_RENDERER_MAP: Readonly<Record<string, RendererType>> = {
  markdown: 'markdown',
  mermaid: 'mermaid',
  plaintext: 'plaintext',
  text: 'plaintext',
  javascript: 'code',
  typescript: 'code',
  python: 'code',
  java: 'code',
  go: 'code',
  rust: 'code',
  json: 'json',
  yaml: 'code',
  xml: 'code',
  html: 'html',
  css: 'code',
  sql: 'code',
  bash: 'code',
  dockerfile: 'code',
};
