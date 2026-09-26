/**
 * The network fuse.
 *
 * Offline mode is a promise about a whole process, not just about our own code:
 * a transitive dependency phoning home would break it just as thoroughly as a
 * remote provider would. Policy alone cannot catch that — so in offline mode we
 * sever outbound egress at the two chokepoints every Node network client
 * ultimately passes through, and fail loudly instead of silently succeeding.
 *
 * What is fused:
 *  - `net.Socket.prototype.connect` — the base of http, https, undici, and
 *    every database driver. TLS sockets inherit it. Note that those callers all
 *    arrive via `net.connect()`, which hands the prototype method Node's
 *    normalized `[options, cb]` ARRAY rather than the caller's own arguments;
 *    {@link connectTargetHost} unwraps that, and failing to do so silently
 *    exempted every real library from the fuse.
 *  - `globalThis.fetch` — patched purely for a better message; its sockets
 *    already hit the guard above.
 *
 * What is deliberately NOT fused:
 *  - `server.listen()` and inbound accepted sockets. Serving the operator's own
 *    browser is the point of the program.
 *  - Unix domain sockets. They cannot leave the machine.
 *  - Loopback destinations (127.0.0.0/8, ::1, localhost) — including the
 *    process talking to itself, which the MCP HTTP transport and the test
 *    harness both do.
 *
 * This is a guard rail, not a sandbox. A determined dependency could reach for
 * `child_process` or a raw `dgram` socket. For a hard guarantee, run the
 * container with no network interface; the fuse is what makes an accidental
 * leak fail visibly.
 */

import net from 'node:net';
import { isLoopbackHost, OfflineViolationError } from '@agentdocstore/core';

export interface FuseHandle {
  /** Restore the original implementations (used by tests). */
  release(): void;
  /** Destinations refused so far, newest last. Bounded to avoid unbounded growth. */
  readonly violations: readonly string[];
}

const MAX_RECORDED_VIOLATIONS = 50;

/**
 * Extract the destination host from the many shapes of `socket.connect()`:
 * `(port, host?, cb?)`, `(path, cb?)`, `({ host, port, path }, cb?)`, and
 * Node's own normalized `([options, cb])`.
 *
 * Returns `null` when the destination cannot leave this machine (a unix socket,
 * or an omitted host, which Node resolves to localhost).
 */
export function connectTargetHost(args: unknown[], depth = 0): string | null {
  const first = args[0];

  // `net.connect(...)` / `net.createConnection(...)` — the module-level
  // functions that `http`, `https`, undici (so `fetch`) and every database
  // driver actually call — do NOT forward their own arguments. They run Node's
  // internal `normalizeArgs` first and then invoke
  // `socket.connect([options, callback])`, passing that normalized ARRAY as a
  // single argument. Reading `.host` off the array finds nothing, so without
  // this unwrap the fuse only ever sees the hand-written
  // `new Socket().connect(port, host)` form that almost no library uses — which
  // is exactly how an air-gap test caught `net.connect({host, port})` sailing
  // straight through a fuse whose unit tests were green.
  if (Array.isArray(first) && depth < 4) return connectTargetHost(first, depth + 1);

  if (typeof first === 'object' && first !== null) {
    const opts = first as { host?: unknown; path?: unknown };
    if (typeof opts.path === 'string') return null; // unix socket (IPC)
    if (typeof opts.host === 'string' && opts.host.length > 0) return opts.host;
    return null; // no host => localhost
  }

  // `connect(path, cb)` — a non-numeric first arg is an IPC path.
  if (typeof first === 'string' && Number.isNaN(Number(first))) return null;

  // `connect(port, host?, cb?)`
  const second = args[1];
  if (typeof second === 'string' && second.length > 0) return second;
  return null; // no host => localhost
}

/**
 * Install the fuse. Idempotent: a second call returns the existing handle
 * rather than double-patching (which would make `release()` unsound).
 */
let installed: FuseHandle | undefined;

export function installNetworkFuse(): FuseHandle {
  if (installed !== undefined) return installed;

  const violations: string[] = [];
  const originalConnect = net.Socket.prototype.connect;
  const originalFetch = globalThis.fetch;

  function record(target: string): void {
    violations.push(target);
    if (violations.length > MAX_RECORDED_VIOLATIONS) violations.shift();
  }

  net.Socket.prototype.connect = function patchedConnect(
    this: net.Socket,
    ...args: unknown[]
  ): net.Socket {
    const host = connectTargetHost(args);
    if (host !== null && !isLoopbackHost(host)) {
      record(host);
      throw new OfflineViolationError(
        `Offline mode blocked an outbound connection to '${host}'.`,
        'connect',
        'Start with --networked if this instance is meant to reach the network.',
      );
    }
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;

  if (typeof originalFetch === 'function') {
    globalThis.fetch = async function patchedFetch(
      input: Parameters<typeof originalFetch>[0],
      init?: Parameters<typeof originalFetch>[1],
    ): ReturnType<typeof originalFetch> {
      const url = urlOf(input);
      if (url !== null && !isLoopbackHost(url.hostname)) {
        record(url.hostname);
        throw new OfflineViolationError(
          `Offline mode blocked fetch('${url.origin}').`,
          'fetch',
          'Start with --networked if this instance is meant to reach the network.',
        );
      }
      return originalFetch(input, init);
    } as typeof globalThis.fetch;
  }

  installed = {
    release(): void {
      net.Socket.prototype.connect = originalConnect;
      if (typeof originalFetch === 'function') globalThis.fetch = originalFetch;
      installed = undefined;
    },
    violations,
  };
  return installed;
}

/** Parse whatever `fetch` was handed into a URL, or null if it is unparseable. */
function urlOf(input: unknown): URL | null {
  try {
    if (typeof input === 'string') return new URL(input);
    if (input instanceof URL) return input;
    if (typeof input === 'object' && input !== null && 'url' in input) {
      const u = (input as { url: unknown }).url;
      if (typeof u === 'string') return new URL(u);
    }
  } catch {
    return null;
  }
  return null;
}
