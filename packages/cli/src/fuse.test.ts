import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { createServer } from 'node:http';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { OfflineViolationError } from '@agentdocstore/core';
import { connectTargetHost, installNetworkFuse } from './fuse.js';

/** `http.get` with its (async) error path suppressed, so only a synchronous
 *  throw from the fuse escapes to the caller. */
function httpGet(url: string): void {
  const req = http.get(url);
  req.on('error', () => undefined);
  req.destroy();
}

// ---------------------------------------------------------------------------
// Destination extraction
// ---------------------------------------------------------------------------

describe('connectTargetHost', () => {
  it('reads the host from connect(port, host)', () => {
    expect(connectTargetHost([443, 'example.com'])).toBe('example.com');
  });

  it('reads the host from connect({ host, port })', () => {
    expect(connectTargetHost([{ host: 'example.com', port: 443 }])).toBe('example.com');
  });

  it('treats a unix socket path as unreachable-by-network (null)', () => {
    expect(connectTargetHost(['/var/run/postgres.sock'])).toBeNull();
    expect(connectTargetHost([{ path: '/tmp/x.sock' }])).toBeNull();
  });

  it('treats an omitted host as localhost (null)', () => {
    expect(connectTargetHost([8787])).toBeNull();
    expect(connectTargetHost(['8787'])).toBeNull();
    expect(connectTargetHost([{ port: 8787 }])).toBeNull();
  });

  // `net.connect()` does not forward its arguments: it normalizes them and
  // calls `socket.connect([options, cb])`. Every HTTP client and database
  // driver reaches the socket this way, so this shape is the one that matters
  // most — and it is the one that used to slip through.
  it('unwraps Node’s normalized [options, cb] array', () => {
    expect(connectTargetHost([[{ host: 'example.com', port: 443 }, null]])).toBe('example.com');
    expect(connectTargetHost([[{ port: 443, host: 'example.com' }, () => undefined]])).toBe(
      'example.com',
    );
  });

  it('still reports localhost/unix through the normalized array', () => {
    expect(connectTargetHost([[{ port: 8787 }, null]])).toBeNull();
    expect(connectTargetHost([[{ path: '/tmp/x.sock' }, null]])).toBeNull();
    expect(connectTargetHost([[{ host: '127.0.0.1', port: 8787 }, null]])).toBe('127.0.0.1');
  });

  it('does not recurse without bound on a self-referential array', () => {
    const loop: unknown[] = [];
    loop.push(loop);
    expect(connectTargetHost([loop])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

describe('installNetworkFuse', () => {
  let release: (() => void) | undefined;

  afterEach(() => {
    release?.();
    release = undefined;
  });

  it('blocks an outbound TCP connect to a non-loopback host', () => {
    const fuse = installNetworkFuse();
    release = fuse.release;

    const socket = new net.Socket();
    expect(() => socket.connect(443, 'example.com')).toThrow(OfflineViolationError);
    expect(fuse.violations).toContain('example.com');
    socket.destroy();
  });

  // The regression that an air-gap run in a `--network none` container exposed:
  // `net.connect()` is the entry point every HTTP client and database driver
  // uses, and it reached the socket through a normalized argument array the
  // fuse did not unwrap — so it was ALLOWED while the unit suite stayed green.
  it('blocks net.connect({ host, port }) — the form libraries actually use', () => {
    const fuse = installNetworkFuse();
    release = fuse.release;

    expect(() => net.connect({ host: 'example.com', port: 443 })).toThrow(OfflineViolationError);
    expect(fuse.violations).toContain('example.com');
  });

  it('blocks net.connect(port, host)', () => {
    const fuse = installNetworkFuse();
    release = fuse.release;

    expect(() => net.connect(443, 'example.com')).toThrow(OfflineViolationError);
    expect(fuse.violations).toContain('example.com');
  });

  it('blocks an http request, which never touches the patched fetch', () => {
    const fuse = installNetworkFuse();
    release = fuse.release;

    // `http.get` goes Agent -> net.createConnection -> Socket.prototype.connect.
    // If only `fetch` were guarded, this would escape the fuse entirely.
    expect(() => httpGet('http://example.com/telemetry')).toThrow(OfflineViolationError);
    expect(fuse.violations).toContain('example.com');
  });

  it('PERMITS net.connect to loopback', () => {
    const fuse = installNetworkFuse();
    release = fuse.release;

    const socket = net.connect({ host: '127.0.0.1', port: 9 });
    socket.destroy();
    expect(fuse.violations).toEqual([]);
  });

  it('blocks fetch() to a non-loopback origin with a readable message', async () => {
    const fuse = installNetworkFuse();
    release = fuse.release;

    await expect(fetch('https://example.com/telemetry')).rejects.toThrow(
      /Offline mode blocked fetch/,
    );
    expect(fuse.violations).toContain('example.com');
  });

  it('PERMITS loopback traffic — the server serving its own browser', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('local');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    const fuse = installNetworkFuse();
    release = fuse.release;

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('local');
    expect(fuse.violations).toEqual([]);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('is idempotent, so release() fully restores the originals', () => {
    const original = net.Socket.prototype.connect;
    const first = installNetworkFuse();
    const second = installNetworkFuse();
    expect(second).toBe(first);
    first.release();
    release = undefined;
    expect(net.Socket.prototype.connect).toBe(original);
  });
});
