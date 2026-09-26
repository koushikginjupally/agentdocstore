/** 404 Not Found page. */
import { href } from '../router.js';
import { buildTitle } from '../constants.js';

export function renderNotFoundPage(container: HTMLElement): void {
  document.title = buildTitle('Not Found');
  container.innerHTML = `
    <div class="empty-state">
      <div class="icon">🔍</div>
      <h2>Page Not Found</h2>
      <p class="text-muted mt-8">The page you're looking for doesn't exist.</p>
      <a href="${href('/')}" class="btn btn-primary mt-16">Go Home</a>
    </div>
  `;
}
