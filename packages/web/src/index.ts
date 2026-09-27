/**
 * AgentDocStore web UI entry point.
 *
 * Client-side hash router, vanilla TypeScript, zero frameworks.
 * All assets bundled locally from node_modules — zero external egress.
 */
import { onRoute } from './router.js';
import { focusPageHeading } from './dom.js';
import type { Route } from './router.js';
import { initTheme } from './theme.js';
import { injectStyles } from './styles.js';
import { renderHeader } from './header.js';
import { renderHomePage } from './pages/home.js';
import { renderViewPage } from './pages/view.js';
import { renderEditPage } from './pages/edit.js';
import { renderVersionsPage } from './pages/versions.js';
import { renderNotFoundPage } from './pages/not-found.js';

function boot(): void {
  injectStyles();
  initTheme();

  const app = document.getElementById('app');
  if (!app) return;

  // Build shell: header + main content area
  app.innerHTML = '';
  const header = renderHeader();
  const main = document.createElement('main');
  main.className = 'main-content';

  app.appendChild(header);
  app.appendChild(main);

  // Route handler
  // The first render keeps the browser's default focus; later navigations move
  // focus into the new page (see focusPageHeading).
  let firstRender = true;
  onRoute(async (route: Route) => {
    await handleRoute(route, main);
    if (!firstRender) focusPageHeading(main);
    firstRender = false;
  });
}

async function handleRoute(route: Route, container: HTMLElement): Promise<void> {
  // Scroll to top on navigation
  window.scrollTo(0, 0);

  switch (route.page) {
    case 'home':
      await renderHomePage(container);
      break;
    case 'view': {
      const id = route.params['id'];
      if (id) {
        await renderViewPage(id, container);
      } else {
        renderNotFoundPage(container);
      }
      break;
    }
    case 'edit': {
      const id = route.params['id'];
      if (id) {
        await renderEditPage(id, container);
      } else {
        renderNotFoundPage(container);
      }
      break;
    }
    case 'versions': {
      const id = route.params['id'];
      if (id) {
        await renderVersionsPage(id, container);
      } else {
        renderNotFoundPage(container);
      }
      break;
    }
    case 'not-found':
    default:
      renderNotFoundPage(container);
      break;
  }
}

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// Re-export pure logic for testing
export { parseRoute } from './router.js';
export { buildTitle, HTML_IFRAME_SANDBOX, CONTENT_MAX_WIDTH } from './constants.js';
export { getRendererType, LANGUAGE_RENDERER_MAP } from './renderers.js';
