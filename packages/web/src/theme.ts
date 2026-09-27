/**
 * Theme manager. Two built-in themes: dark (default) and light.
 * Persisted in localStorage, toggled via a header button.
 * All theming is done via CSS custom properties on :root / [data-theme].
 */

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'agentdocstore-theme';

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage unavailable (e.g. sandboxed iframe)
  }
  return 'dark';
}

/** Dispatched on `document` after the theme changes; `detail` is the new theme. */
export const THEME_CHANGE_EVENT = 'agentdocstore:themechange';

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
  document.documentElement.setAttribute('data-theme', theme);
  // Content drawn with theme colours baked in (Mermaid diagrams) redraws on this.
  document.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: theme }));
}

/** The theme applied to the page right now. */
export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function toggleTheme(): Theme {
  const current = getStoredTheme();
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function initTheme(): void {
  setTheme(getStoredTheme());
}
