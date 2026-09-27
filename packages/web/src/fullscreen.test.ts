// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as toast from './toast.js';
import { fullScreenButton } from './fullscreen.js';

/** jsdom has no Fullscreen API: stand in for a browser that has one. */
function supportFullScreen(options: { refuse?: boolean } = {}) {
  let current: Element | null = null;
  const enter = (el: HTMLElement): void => {
    current = el;
    el.dispatchEvent(new Event('fullscreenchange', { bubbles: true }));
  };
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => current,
  });
  const request = vi.fn(function (this: HTMLElement): Promise<void> {
    if (options.refuse === true) return Promise.reject(new TypeError('denied'));
    enter(this);
    return Promise.resolve();
  });
  const exit = vi.fn((): Promise<void> => {
    const was = current;
    current = null;
    was?.dispatchEvent(new Event('fullscreenchange', { bubbles: true }));
    return Promise.resolve();
  });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true,
    value: request,
  });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  return { request, exit };
}

function documentCard(): HTMLElement {
  document.body.innerHTML = '<div class="card"><p>Long text</p></div>';
  return document.querySelector<HTMLElement>('.card')!;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) {
    delete (document as unknown as Record<string, unknown>)[key];
  }
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)['requestFullscreen'];
});

describe('fullScreenButton', () => {
  it('is not offered where the browser cannot show an element full screen', () => {
    expect(fullScreenButton(documentCard())).toBeNull();
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
    expect(fullScreenButton(documentCard())).toBeNull();
  });

  it('shows the document full screen and moves focus into it, so the keys scroll it', async () => {
    const { request } = supportFullScreen();
    const card = documentCard();
    const button = fullScreenButton(card)!;
    expect(button.textContent).toBe('Full Screen');
    button.click();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.contexts[0]).toBe(card);
    expect(document.activeElement).toBe(card);
    expect(card.getAttribute('tabindex')).toBe('-1');
  });

  it('puts an Exit Full Screen button inside the document, which leaves full screen', async () => {
    const { exit } = supportFullScreen();
    const card = documentCard();
    const button = fullScreenButton(card)!;
    document.body.appendChild(button);
    button.click();
    await flush();
    const leave = [...card.querySelectorAll('button')].find(
      (b) => b.textContent === 'Exit Full Screen',
    )!;
    expect(leave).toBeDefined();
    leave.click();
    await flush();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('leaves full screen on Escape, even where the browser leaves the key to the page', async () => {
    const { exit } = supportFullScreen();
    const card = documentCard();
    const button = fullScreenButton(card)!;
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(exit).not.toHaveBeenCalled(); // not full screen yet
    button.click();
    await flush();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the Full Screen button when full screen ends', async () => {
    supportFullScreen();
    const card = documentCard();
    const button = fullScreenButton(card)!;
    document.body.appendChild(button);
    button.click();
    await flush();
    await document.exitFullscreen(); // for example the Escape key
    expect(document.activeElement).toBe(button);
  });

  it('says so when the browser refuses', async () => {
    supportFullScreen({ refuse: true });
    const shown = vi.spyOn(toast, 'showToast').mockImplementation(() => undefined);
    const button = fullScreenButton(documentCard())!;
    button.click();
    await flush();
    expect(shown).toHaveBeenCalledWith('Full screen is not available here', 'error');
  });
});
