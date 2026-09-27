// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import {
  LEAVE_PROMPT,
  hasUnsavedChanges,
  onRoute,
  setUnsavedChangesCheck,
  watchForUnsavedChanges,
} from './router.js';
import type { Route } from './router.js';

const rendered: Route[] = [];

/** Change the hash and wait for the router's hashchange handling to finish. */
async function goTo(hash: string): Promise<void> {
  window.location.hash = hash;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(() => {
  window.location.hash = '#/d/abc123DEF4/edit';
  onRoute((route) => {
    rendered.push(route);
  });
});

beforeEach(async () => {
  setUnsavedChangesCheck(null);
  await goTo('#/d/abc123DEF4/edit');
  rendered.length = 0;
});

afterEach(() => vi.restoreAllMocks());

describe('leaving a page with unsaved changes', () => {
  it('asks first, and stays with the address unchanged when the user declines', async () => {
    setUnsavedChangesCheck(() => true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await goTo('#/');

    expect(confirm).toHaveBeenCalledWith(LEAVE_PROMPT);
    expect(rendered).toEqual([]);
    expect(window.location.hash).toBe('#/d/abc123DEF4/edit');
    expect(hasUnsavedChanges()).toBe(true);
  });

  it('leaves when the user confirms, and forgets the old check', async () => {
    setUnsavedChangesCheck(() => true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    await goTo('#/');

    expect(rendered.map((r) => r.page)).toEqual(['home']);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it('does not ask when nothing has changed', async () => {
    setUnsavedChangesCheck(() => false);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    await goTo('#/');

    expect(confirm).not.toHaveBeenCalled();
    expect(rendered.map((r) => r.page)).toEqual(['home']);
  });

  it('lets the browser warn on reload or close only while changes are unsaved', () => {
    const unload = (): boolean => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    setUnsavedChangesCheck(() => true);
    expect(unload()).toBe(true);
    setUnsavedChangesCheck(() => false);
    expect(unload()).toBe(false);
  });
});

describe('clicking an in-app link with unsaved changes', () => {
  /** Click a fresh `#…` link; return whether the router cancelled the navigation. */
  function clickLink(target: string, init: MouseEventInit = {}): boolean {
    const link = document.createElement('a');
    link.href = target;
    link.textContent = 'Go';
    document.body.appendChild(link);
    // Runs after the router's capture-phase listener: read its decision, then
    // stop jsdom from performing the navigation later, in another test.
    let cancelled = false;
    const record = (event: Event): void => {
      cancelled = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener('click', record);
    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }),
    );
    document.removeEventListener('click', record);
    link.remove();
    return cancelled;
  }

  it('asks before navigating, and cancels the navigation when declined', () => {
    setUnsavedChangesCheck(() => true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(clickLink('#/')).toBe(true);
    expect(confirm).toHaveBeenCalledWith(LEAVE_PROMPT);
    expect(hasUnsavedChanges()).toBe(true);
  });

  it('lets the navigation happen when confirmed, without asking twice', async () => {
    setUnsavedChangesCheck(() => true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(clickLink('#/')).toBe(false);
    expect(hasUnsavedChanges()).toBe(false);
    await goTo('#/'); // the browser's own navigation for that click
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(rendered.map((r) => r.page)).toEqual(['home']);
  });

  it('does not ask for a modified click, which opens a new tab', () => {
    setUnsavedChangesCheck(() => true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(clickLink('#/', { ctrlKey: true })).toBe(false);
    expect(clickLink('#/', { metaKey: true })).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not ask for a link to the page already shown', () => {
    setUnsavedChangesCheck(() => true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(clickLink('#/d/abc123DEF4/edit')).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(hasUnsavedChanges()).toBe(true);
  });
});

describe('watchForUnsavedChanges', () => {
  it('reports changes while any field differs from its starting value', () => {
    const title = document.createElement('input');
    title.value = 'Draft';
    const body = document.createElement('textarea');
    watchForUnsavedChanges([title, body]);
    expect(hasUnsavedChanges()).toBe(false);

    body.value = 'new text';
    expect(hasUnsavedChanges()).toBe(true);

    body.value = '';
    expect(hasUnsavedChanges()).toBe(false);
  });
});
