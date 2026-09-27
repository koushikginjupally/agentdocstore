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

describe('syntax highlighting colours', () => {
  function rules(): CSSStyleRule[] {
    injectStyles();
    const sheet = document.querySelector('style')?.sheet;
    return Array.from(sheet?.cssRules ?? []).filter(
      (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
    );
  }

  it('colours highlight.js tokens in code documents from theme variables', () => {
    // The page links no stylesheet besides the injected one, so token colours
    // must live there or code renders in a single colour.
    const keyword = rules().find((r) => r.selectorText.includes('.code-block .hljs-keyword'));
    expect(keyword?.style.color).toBe('var(--syntax-keyword)');
    const string = rules().find((r) => r.selectorText.includes('.code-block .hljs-string'));
    expect(string?.style.color).toBe('var(--syntax-string)');
  });

  it('defines every syntax colour for both the dark and the light theme', () => {
    const names = ['keyword', 'string', 'number', 'comment', 'title', 'type'];
    for (const theme of ['[data-theme="dark"]', '[data-theme="light"]']) {
      const block = rules().find((r) => r.selectorText.includes(theme));
      for (const name of names) {
        expect(block?.style.getPropertyValue(`--syntax-${name}`), `${theme} ${name}`).not.toBe('');
      }
    }
  });
});

describe('long unbroken words', () => {
  function rulesFor(selector: string): CSSStyleRule[] {
    injectStyles();
    const sheet = document.querySelector('style')?.sheet;
    return Array.from(sheet?.cssRules ?? []).filter(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && rule.selectorText === selector,
    );
  }

  it('reads the property this check relies on', () => {
    // Guards the check itself: an existing rule that already wraps.
    expect(
      rulesFor('.version-message').map((r) => r.style.getPropertyValue('overflow-wrap')),
    ).toContain('anywhere');
  });

  // A pasted URL, hash or token has no place to break, so on a 390px screen it
  // ran off the right edge of the card in each of these.
  it.each(['.doc-list-link .doc-title', '.main-content h1', '.markdown-body', '.comment-body'])(
    '%s breaks them instead of overflowing',
    (selector) => {
      const values = rulesFor(selector).map((r) => r.style.getPropertyValue('overflow-wrap'));
      expect(values).toContain('anywhere');
    },
  );
});

describe('toggle buttons', () => {
  it('look pressed while on, in theme colours', () => {
    injectStyles();
    const sheet = document.querySelector('style')?.sheet;
    const rule = Array.from(sheet?.cssRules ?? []).find(
      (r): r is CSSStyleRule =>
        r instanceof CSSStyleRule && r.selectorText === '.btn[aria-pressed="true"]',
    );
    expect(rule?.style.getPropertyValue('background')).toContain('var(--accent-bg)');
    expect(rule?.style.getPropertyValue('border-color')).toBe('var(--accent)');
  });
});
