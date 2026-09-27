import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError } from './api.js';

/** Make the next fetch() return `body` with `status`. */
function respondWith(body: string, status: number, statusText: string): void {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(body, { status, statusText })));
}

describe('api client error handling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the status when an error body is not JSON', async () => {
    // For example a reverse proxy's HTML error page in front of the server.
    respondWith('<html>502 Bad Gateway</html>', 502, 'Bad Gateway');
    const err: unknown = await api.getDocument('abc123DEF4').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, message: 'API error 502: Bad Gateway' });
  });

  it('falls back to the status text when a JSON body has no message', async () => {
    respondWith('{}', 500, 'Internal Server Error');
    await expect(api.whoami()).rejects.toMatchObject({
      status: 500,
      message: 'API error 500: Internal Server Error',
    });
  });
});
