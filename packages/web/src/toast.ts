/** Simple toast notification system. */

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  ensureContainer().appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3500);
}
