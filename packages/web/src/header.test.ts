// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHeader } from './header.js';

const EMOJI = /\p{Extended_Pictographic}/u;

describe('header theme toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute('data-theme', 'dark');
    document.body.innerHTML = '';
  });

  it('draws an SVG icon instead of an emoji, whichever theme is active', () => {
    const header = renderHeader();
    document.body.appendChild(header);
    const btn = header.querySelector('button') as HTMLButtonElement;

    for (let i = 0; i < 2; i++) {
      expect(btn.querySelector('svg')).not.toBeNull();
      // An emoji glyph renders blank on systems without an emoji font.
      expect(btn.textContent ?? '').not.toMatch(EMOJI);
      btn.click();
    }
  });

  it('names the action the button will take', () => {
    localStorage.setItem('agentdocstore-theme', 'dark');
    const header = renderHeader();
    const btn = header.querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Switch to light theme');
    btn.click();
    expect(btn.getAttribute('aria-label')).toBe('Switch to dark theme');
  });
});
