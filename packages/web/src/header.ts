/** Application header with wordmark and theme toggle. */
import { href } from './router.js';
import { WORDMARK_HTML } from './constants.js';
import { toggleTheme, getStoredTheme } from './theme.js';
import { BUTTON_ICONS } from './icons.js';

export function renderHeader(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'app-header';

  const link = document.createElement('a');
  link.href = href('/');
  link.className = 'wordmark';
  link.innerHTML = WORDMARK_HTML;
  link.style.textDecoration = 'none';

  const actions = document.createElement('div');
  actions.className = 'header-actions';

  const themeBtn = document.createElement('button');
  themeBtn.className = 'btn-icon';
  // SVG rather than emoji: an emoji glyph is blank on systems without an emoji
  // font. The label names the action, which the icon alone does not.
  const updateThemeIcon = () => {
    const dark = getStoredTheme() === 'dark';
    const label = dark ? 'Switch to light theme' : 'Switch to dark theme';
    themeBtn.innerHTML = dark ? BUTTON_ICONS.sun : BUTTON_ICONS.moon;
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
  };
  updateThemeIcon();
  themeBtn.addEventListener('click', () => {
    toggleTheme();
    updateThemeIcon();
  });

  actions.appendChild(themeBtn);
  header.appendChild(link);
  header.appendChild(actions);

  return header;
}
