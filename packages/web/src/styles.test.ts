// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { injectStyles } from './styles.js';

/** Style rules for `selector` inside `@media (max-width: 600px)` blocks. */
function narrowScreenRules(selector: string): CSSStyleRule[] {
  injectStyles();
  const sheet = document.querySelector('style')?.sheet;
  const found: CSSStyleRule[] = [];
  for (const rule of Array.from(sheet?.cssRules ?? [])) {
    if (!(rule instanceof CSSMediaRule) || !rule.media.mediaText.includes('max-width: 600px')) {
      continue;
    }
    for (const inner of Array.from(rule.cssRules)) {
      if (inner instanceof CSSStyleRule && inner.selectorText === selector) found.push(inner);
    }
  }
  return found;
}

describe('toast placement', () => {
  it('shows toasts under the header on phone-width screens, clear of the page buttons', () => {
    // At the bottom corner a toast covered the edit page's Save and Cancel
    // buttons on a 390px screen for its 3.5 seconds.
    const [rule] = narrowScreenRules('.toast-container');
    expect(rule).toBeDefined();
    expect(rule!.style.top).toBe('64px');
    expect(rule!.style.bottom).toBe('auto');
  });
});
