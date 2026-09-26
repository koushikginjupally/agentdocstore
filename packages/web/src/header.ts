/** Application header with wordmark and theme toggle. */
import { href } from './router.js';
import { WORDMARK_HTML } from './constants.js';
import { toggleTheme, getStoredTheme } from './theme.js';

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
  themeBtn.setAttribute('aria-label', 'Toggle theme');
  themeBtn.title = 'Toggle theme';
  const updateThemeIcon = () => {
    themeBtn.textContent = getStoredTheme() === 'dark' ? '☀️' : '🌙';
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
