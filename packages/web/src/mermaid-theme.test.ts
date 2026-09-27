// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mermaid needs real layout, so a stub records how it is configured and used.
const calls = vi.hoisted(() => ({ themes: [] as string[], drawn: [] as string[] }));
vi.mock('mermaid', () => ({
  default: {
    initialize: (config: { theme: string }) => calls.themes.push(config.theme),
    render: async (_id: string, source: string) => {
      calls.drawn.push(source);
      return { svg: `<svg data-theme-at-draw="${calls.themes.at(-1)}"></svg>` };
    },
  },
}));

const { renderContent } = await import('./render.js');
const { setTheme } = await import('./theme.js');

beforeEach(() => {
  calls.themes.length = 0;
  calls.drawn.length = 0;
  document.body.innerHTML = '';
});

async function drawDiagram(source: string): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await renderContent('mermaid', source, container);
  return container;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('Mermaid diagrams and the theme', () => {
  it('draws with the light Mermaid theme when the page is light', async () => {
    setTheme('light');
    const diagram = await drawDiagram('flowchart LR\n  A --> B');
    expect(diagram.querySelector('svg')?.getAttribute('data-theme-at-draw')).toBe('default');
  });

  it('redraws diagrams on the page when the theme changes', async () => {
    setTheme('light');
    const diagram = await drawDiagram('flowchart LR\n  A --> B');
    calls.drawn.length = 0;

    setTheme('dark');
    await settle();

    expect(calls.drawn).toEqual(['flowchart LR\n  A --> B']);
    expect(diagram.querySelector('svg')?.getAttribute('data-theme-at-draw')).toBe('dark');
  });

  it('does not redraw diagrams that have left the page', async () => {
    setTheme('dark');
    const diagram = await drawDiagram('flowchart LR\n  C --> D');
    diagram.remove();
    calls.drawn.length = 0;

    setTheme('light');
    await settle();

    expect(calls.drawn).toEqual([]);
  });
});
