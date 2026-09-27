// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError } from '../api.js';
import * as dom from '../dom.js';
import { renderViewPage } from './view.js';

const doc = {
  id: 'd1',
  title: 'Shared notes',
  language: 'plaintext',
  visibility: 'PUBLIC' as const,
  createdBy: 'alice',
  createdAt: '2026-09-27T00:00:00Z',
  updatedAt: '2026-09-27T00:00:00Z',
  latestVersion: 1,
  version: 1,
  content: 'hello',
};

/** Render the view page as `viewer`; return the labels of the document's action controls. */
async function actionsAs(viewer: string | Error): Promise<string[]> {
  vi.spyOn(api, 'getDocument').mockResolvedValue(doc);
  vi.spyOn(api, 'getComments').mockResolvedValue([]);
  vi.spyOn(api, 'whoami').mockImplementation(() =>
    viewer instanceof Error ? Promise.reject(viewer) : Promise.resolve({ user: viewer }),
  );
  document.body.innerHTML = '';
  await renderViewPage('d1', document.body);
  const header = document.querySelector('.flex-between');
  return [...(header?.querySelectorAll('a, button') ?? [])].map((el) => el.textContent ?? '');
}

describe('view page document actions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('offers Edit and Delete to the document owner', async () => {
    expect(await actionsAs('alice')).toEqual([
      'Copy Link',
      'Copy Raw',
      'Download',
      'Edit',
      'Versions',
      'Delete',
    ]);
  });

  it('hides Edit and Delete from other viewers', async () => {
    expect(await actionsAs('bob')).toEqual(['Copy Link', 'Copy Raw', 'Download', 'Versions']);
  });

  it('hides Edit and Delete when the viewer is unknown', async () => {
    expect(await actionsAs(new Error('offline'))).toEqual([
      'Copy Link',
      'Copy Raw',
      'Download',
      'Versions',
    ]);
  });

  it('asks who the viewer is once for the whole page', async () => {
    await actionsAs('bob');
    await vi.waitFor(() => expect(document.querySelector('#comment-list p')).not.toBeNull());
    expect(api.whoami).toHaveBeenCalledTimes(1);
  });
});

describe('view page for an old version', () => {
  afterEach(() => vi.restoreAllMocks());

  async function renderVersion(version: number, latest: number): Promise<void> {
    vi.spyOn(api, 'getDocument').mockResolvedValue({
      ...doc,
      latestVersion: latest,
      version,
      content: `content of v${version}`,
    });
    vi.spyOn(api, 'getComments').mockResolvedValue([]);
    vi.spyOn(api, 'whoami').mockResolvedValue({ user: 'alice' });
    document.body.innerHTML = '';
    await renderViewPage('d1', document.body, version);
  }

  it('loads that version and says it is not the latest, with a way back', async () => {
    await renderVersion(1, 3);
    expect(api.getDocument).toHaveBeenCalledWith('d1', 1);
    expect(document.body.textContent).toContain('content of v1');
    const notice = document.querySelector('[role="note"]');
    expect(notice?.textContent).toContain('You are viewing version 1 of 3.');
    const latest = [...document.querySelectorAll('a')].find(
      (a) => a.textContent === 'View the latest version',
    );
    expect(latest?.getAttribute('href')).toBe('#/d/d1');
  });

  it('offers only read actions for an old version, even to the owner', async () => {
    await renderVersion(1, 3);
    const header = document.querySelector('.flex-between');
    const labels = [...(header?.querySelectorAll('a, button') ?? [])].map((el) => el.textContent);
    expect(labels).toEqual(['Copy Link', 'Copy Raw', 'Download', 'Versions']);
    // Comments belong to the document, not to one old version.
    expect(document.querySelector('.comment-panel')).toBeNull();
    // The document's last-updated date would read as this version's date.
    expect(document.body.textContent).not.toContain('2026');
  });

  it('shows the latest version as the normal page', async () => {
    await renderVersion(3, 3);
    expect(document.querySelector('[role="note"]')).toBeNull();
    expect(document.querySelector('.comment-panel')).not.toBeNull();
  });
});

describe('view page for a version that does not exist', () => {
  afterEach(() => vi.restoreAllMocks());

  it('says the version is missing and links to the document', async () => {
    vi.spyOn(api, 'getDocument').mockRejectedValue(new ApiError('API error 404: Not found', 404));
    vi.spyOn(api, 'whoami').mockResolvedValue({ user: 'alice' });
    document.body.innerHTML = '';
    await renderViewPage('d1', document.body, 99);
    expect(document.body.textContent).toContain('Version not found');
    const back = document.querySelector<HTMLAnchorElement>('a.btn');
    expect(back?.textContent).toBe('Go to the document');
    expect(back?.getAttribute('href')).toBe('#/d/d1');
  });

  it('treats an id from the address as text, not markup', async () => {
    vi.spyOn(api, 'getDocument').mockRejectedValue(new ApiError('API error 404: Not found', 404));
    vi.spyOn(api, 'whoami').mockResolvedValue({ user: 'alice' });
    document.body.innerHTML = '';
    await renderViewPage('"><img src=x onerror=alert(1)>', document.body, 2);
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('downloading a document', () => {
  afterEach(() => vi.restoreAllMocks());

  it('saves the shown version as a file named after the document', async () => {
    const saved: Array<{ text: string; name: string }> = [];
    vi.spyOn(dom, 'downloadText').mockImplementation((text, name) => {
      saved.push({ text, name });
    });
    vi.spyOn(api, 'getDocument').mockResolvedValue({
      ...doc,
      language: 'markdown',
      latestVersion: 3,
      version: 1,
      content: '# First draft',
    });
    vi.spyOn(api, 'whoami').mockResolvedValue({ user: 'bob' });
    document.body.innerHTML = '';
    await renderViewPage('d1', document.body, 1);
    const download = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Download',
    )!;
    download.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).toEqual([{ text: '# First draft', name: 'Shared notes v1.md' }]);
  });
});
