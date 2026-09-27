/**
 * Inject all application CSS. Uses CSS custom properties for theming.
 * System font stack only, zero external assets.
 */

const CSS = `
/* ===== Theme custom properties ===== */
:root,
[data-theme="dark"] {
  --bg-primary: #0f0f14;
  --bg-secondary: #1a1a24;
  --bg-tertiary: #24243a;
  --bg-input: #1a1a24;
  --border: #2e2e48;
  --border-focus: #7C5CFF;
  --text-primary: #e8e6f0;
  --text-secondary: #a8a4b8;
  --text-muted: #6b6780;
  --accent: #7C5CFF;
  --accent-hover: #9578ff;
  --accent-bg: rgba(124, 92, 255, 0.12);
  --danger: #f04;
  --danger-hover: #f36;
  --success: #2dd4a8;
  --warning: #f5a623;
  --code-bg: #161622;
  --syntax-keyword: #ff7b72;
  --syntax-string: #a5d6ff;
  --syntax-number: #79c0ff;
  --syntax-comment: #8b949e;
  --syntax-title: #d2a8ff;
  --syntax-type: #ffa657;
  --shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
  --radius: 6px;
  --radius-lg: 10px;
  color-scheme: dark;
}

[data-theme="light"] {
  --bg-primary: #fafafe;
  --bg-secondary: #ffffff;
  --bg-tertiary: #f0f0f6;
  --bg-input: #ffffff;
  --border: #ddd8ee;
  --border-focus: #7C5CFF;
  --text-primary: #1a1a2e;
  --text-secondary: #555170;
  --text-muted: #8884a0;
  --accent: #7C5CFF;
  --accent-hover: #6a48e0;
  --accent-bg: rgba(124, 92, 255, 0.08);
  --danger: #d42020;
  --danger-hover: #b01818;
  --success: #16a67a;
  --warning: #d49318;
  --code-bg: #f6f6fb;
  --syntax-keyword: #cf222e;
  --syntax-string: #0a3069;
  --syntax-number: #0550ae;
  --syntax-comment: #6e7781;
  --syntax-title: #8250df;
  --syntax-type: #953800;
  --shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  --radius: 6px;
  --radius-lg: 10px;
  color-scheme: light;
}

/* ===== Reset ===== */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', Arial, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  background: var(--bg-primary);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
}

body { min-height: 100vh; }

a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }

/* ===== Layout ===== */
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
  position: sticky;
  top: 0;
  z-index: 100;
}

.app-header .wordmark {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}
.app-header .wordmark .accent {
  color: var(--accent);
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.main-content {
  max-width: min(1920px, 96vw);
  margin: 0 auto;
  padding: 24px;
}
/* A title that is one long word (a URL, a hash) wraps instead of running off
   a narrow screen; "anywhere" also lets the flex row it sits in shrink. */
.main-content h1 { overflow-wrap: anywhere; }

/* ===== Buttons ===== */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  white-space: nowrap;
}
.btn:hover { border-color: var(--accent); background: var(--accent-bg); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* Beats the :focus border, since the invalid field is focused. */
input[aria-invalid="true"],
input[aria-invalid="true"]:focus,
textarea[aria-invalid="true"],
textarea[aria-invalid="true"]:focus { border-color: var(--danger); }
/* Headings are focused by script after navigation; they are not controls. */
.main-content [tabindex="-1"]:focus { outline: none; }
.action-icon { flex-shrink: 0; }

.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

.btn-danger { border-color: var(--danger); color: var(--danger); }
.btn-danger:hover { background: rgba(255, 0, 68, 0.1); }

.btn-sm { padding: 4px 10px; font-size: 0.8rem; }
/* A toggle button that is on (Preview while previewing). */
.btn[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-bg); color: var(--accent); }
.btn-icon {
  padding: 6px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius);
  font-size: 1.1rem;
  line-height: 1;
}
.btn-icon:hover { color: var(--accent); background: var(--accent-bg); }

/* ===== Forms ===== */
.form-group { margin-bottom: 16px; }
/* The Preview panel takes the text box's place, at least as tall. */
.content-preview {
  min-height: 200px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
}
.form-group label {
  display: block;
  margin-bottom: 4px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}

input[type="text"],
select,
textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.95rem;
  transition: border-color 0.15s;
}
input[type="text"]:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-bg);
}

textarea {
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', 'Menlo', 'Consolas', monospace;
  font-size: 0.875rem;
  line-height: 1.5;
  resize: vertical;
  min-height: 200px;
  tab-size: 2;
}

/* ===== Cards & Panels ===== */
.card {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  padding: 20px;
  box-shadow: var(--shadow);
}

/* ===== Full screen reading ===== */
/* The document card fills the screen and scrolls; its text keeps a readable
   width. The exit bar stays at the top and only shows in full screen. */
.card:fullscreen {
  overflow: auto;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  padding: 16px max(20px, calc((100% - 960px) / 2)) 48px;
  background: var(--bg-primary);
}
.fullscreen-bar { display: none; }
.card:fullscreen > .fullscreen-bar {
  display: flex;
  justify-content: flex-end;
  position: sticky;
  top: 0;
  margin-bottom: 8px;
  pointer-events: none;
}
.card:fullscreen > .fullscreen-bar .btn { pointer-events: auto; }

.panel-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 16px;
  color: var(--text-primary);
}

/* ===== Document list items (real <a> anchors) ===== */
.doc-list { list-style: none; }
.doc-list-item {
  border-bottom: 1px solid var(--border);
}
.doc-list-item:last-child { border-bottom: none; }

.doc-list-link {
  display: block;
  padding: 12px 16px;
  color: var(--text-primary);
  text-decoration: none;
  transition: background 0.12s;
}
.doc-list-link:hover {
  background: var(--accent-bg);
  text-decoration: none;
}
.doc-list-link .doc-title {
  font-weight: 500;
  font-size: 0.95rem;
  overflow-wrap: anywhere;
}
.doc-list-link .doc-meta {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 2px;
}

/* ===== Code rendering ===== */
.code-block {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow-x: auto;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', 'Menlo', 'Consolas', monospace;
  font-size: 0.85rem;
  line-height: 1.6;
}

.code-block table {
  border-collapse: collapse;
  width: 100%;
}
.code-block .line-number {
  padding: 0 12px;
  text-align: right;
  color: var(--text-muted);
  user-select: none;
  white-space: nowrap;
  width: 1%;
  border-right: 1px solid var(--border);
  vertical-align: top;
}
.code-block .line-content {
  padding: 0 16px;
  white-space: pre;
}
.code-block .line-content .hljs { background: transparent; }

/* Syntax colours come from the theme, so they follow the light/dark toggle.
   (The page links no stylesheet besides this one.) */
.code-block .hljs-keyword, .code-block .hljs-selector-tag, .code-block .hljs-doctag { color: var(--syntax-keyword); }
.code-block .hljs-string, .code-block .hljs-regexp, .code-block .hljs-meta .hljs-string { color: var(--syntax-string); }
.code-block .hljs-number, .code-block .hljs-literal, .code-block .hljs-attr, .code-block .hljs-attribute, .code-block .hljs-variable, .code-block .hljs-symbol { color: var(--syntax-number); }
.code-block .hljs-comment, .code-block .hljs-quote, .code-block .hljs-meta { color: var(--syntax-comment); }
.code-block .hljs-comment { font-style: italic; }
.code-block .hljs-title, .code-block .hljs-section, .code-block .hljs-name { color: var(--syntax-title); }
.code-block .hljs-built_in, .code-block .hljs-type, .code-block .hljs-params .hljs-type { color: var(--syntax-type); }

/* ===== Markdown rendering ===== */
/* The contents list at the top of a longer document. */
.doc-toc {
  margin-bottom: 16px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}
.doc-toc summary { cursor: pointer; font-weight: 500; color: var(--text-secondary); }
.doc-toc ol { list-style: none; margin: 8px 0 4px; padding: 0; }
.doc-toc li { margin: 2px 0; }
.doc-toc .toc-h2 { padding-left: 16px; }
.doc-toc .toc-h3 { padding-left: 32px; }
.markdown-body {
  line-height: 1.7;
  /* Long URLs and hashes in text wrap; code blocks keep white-space: pre and
     scroll sideways instead. */
  overflow-wrap: anywhere;
}
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
}
.markdown-body h1 { font-size: 1.8rem; }
.markdown-body h2 { font-size: 1.4rem; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
.markdown-body h3 { font-size: 1.15rem; }
.markdown-body p { margin-bottom: 1em; }
.markdown-body code {
  background: var(--code-bg);
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', 'Menlo', 'Consolas', monospace;
  font-size: 0.875em;
}
.markdown-body pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  overflow-x: auto;
  margin-bottom: 1em;
}
.markdown-body pre code { background: transparent; padding: 0; }
.markdown-body blockquote {
  border-left: 3px solid var(--accent);
  padding-left: 16px;
  color: var(--text-secondary);
  margin-bottom: 1em;
}
.markdown-body ul, .markdown-body ol { padding-left: 2em; margin-bottom: 1em; }
.markdown-body table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
.markdown-body th, .markdown-body td {
  border: 1px solid var(--border);
  padding: 8px 12px;
  text-align: left;
}
.markdown-body th { background: var(--bg-tertiary); font-weight: 600; }
.markdown-body img { max-width: 100%; border-radius: var(--radius); }
.markdown-body a { color: var(--accent); }
.markdown-body hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }

/* ===== Version badge ===== */
.version-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--accent-bg);
  color: var(--accent);
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
}

.edit-message {
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-style: italic;
}

/* ===== Comment panel ===== */
.comment-panel {
  border-top: 1px solid var(--border);
  margin-top: 24px;
  padding-top: 24px;
}
.comment-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.comment-item:last-child { border-bottom: none; }
.comment-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.comment-author {
  font-weight: 500;
  font-size: 0.9rem;
}
.comment-time {
  font-size: 0.75rem;
  color: var(--text-muted);
}
.comment-body {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.comment-resolved {
  opacity: 0.5;
}

.comment-form {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.comment-form textarea {
  min-height: 60px;
  flex: 1;
}
.comment-size:not(:empty) { margin-top: 6px; }
.comment-size.over-limit { color: var(--danger); }

/* ===== Diff view ===== */
.diff-container {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow-x: auto;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', 'Menlo', 'Consolas', monospace;
  font-size: 0.85rem;
  line-height: 1.6;
}
.diff-line { white-space: pre; padding: 0 16px; }
.diff-add { background: rgba(45, 212, 168, 0.12); color: var(--success); }
.diff-del { background: rgba(255, 0, 68, 0.12); color: var(--danger); }
.diff-hunk { color: var(--accent); font-weight: 500; padding: 8px 16px; }

/* ===== Modal ===== */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
  max-width: 480px;
  width: 90vw;
  box-shadow: var(--shadow);
}
.modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 12px;
}
.modal-title .action-icon { width: 20px; height: 20px; color: var(--warning); }
.modal-body { margin-bottom: 16px; font-size: 0.9rem; color: var(--text-secondary); }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }

/* ===== Visibility badge ===== */
.visibility-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.visibility-badge.public { background: rgba(45, 212, 168, 0.15); color: var(--success); }
.visibility-badge.private { background: rgba(255, 165, 0, 0.15); color: var(--warning); }

/* ===== Search ===== */
.search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.search-bar input { flex: 1; }
.search-status:not(:empty) { margin: -8px 0 12px; }

/* ===== Utility ===== */
.flex-row { display: flex; gap: 8px; align-items: center; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }
.gap-16 { gap: 16px; }
.mt-8 { margin-top: 8px; }
.mt-16 { margin-top: 16px; }
.mt-24 { margin-top: 24px; }
.mb-16 { margin-bottom: 16px; }
.text-muted { color: var(--text-muted); }
.text-sm { font-size: 0.85rem; }
.text-center { text-align: center; }
.hidden { display: none !important; }
/* Read by screen readers, not shown on screen. */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ===== Empty state ===== */
.empty-state {
  text-align: center;
  padding: 48px 20px;
  color: var(--text-muted);
}
.empty-state .icon { margin-bottom: 12px; line-height: 0; }
.empty-state .state-icon { width: 40px; height: 40px; }
/* The page heading of an empty state (for example Page Not Found) keeps the
   size it had as an h2. */
.empty-state h1 { font-size: 1.5em; }

/* ===== JSON pretty toggle ===== */
.json-toggle {
  margin-bottom: 8px;
}

/* ===== Tab bar ===== */
.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}
.tab-bar .tab {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 0.9rem;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
}
.tab-bar .tab:hover { color: var(--text-primary); }
.tab-bar .tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 500;
}

/* ===== Version list ===== */
.version-list { list-style: none; }
.version-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.version-list-item:last-child { border-bottom: none; }
.version-message { margin-top: 4px; color: var(--text-secondary); overflow-wrap: anywhere; }
.version-notice {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  color: var(--text-secondary);
}
.version-checkbox { accent-color: var(--accent); }

/* ===== Loading spinner ===== */
.spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px;
  color: var(--text-muted);
}

/* ===== Toast ===== */
.toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 300;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toast {
  padding: 10px 16px;
  border-radius: var(--radius);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  font-size: 0.875rem;
  animation: slideIn 0.2s ease-out;
}
.toast.success { border-color: var(--success); }
.toast.error { border-color: var(--danger); color: var(--danger); }
@keyframes slideIn {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
/* On a phone the bottom of the screen is where the button just tapped (Save,
   Comment) usually is; put toasts under the sticky header so they never
   cover it. */
@media (max-width: 600px) {
  .toast-container { top: 64px; bottom: auto; left: 12px; right: 12px; }
}

/* ===== HTML iframe ===== */
.html-frame {
  width: 100%;
  min-height: 400px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
}

/* ===== Mermaid ===== */
.mermaid-container {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  overflow-x: auto;
}
.mermaid-container svg { max-width: 100%; }
`;

let injected = false;

/** Inject the application stylesheet into the document head. */
export function injectStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}
