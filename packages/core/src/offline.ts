/**
 * Runtime mode policy.
 *
 * AgentDocStore is offline by default and you opt OUT, never in. `offline` is not
 * a decoration: this module is the single place that decides whether a given
 * (mode, host, provider) combination is allowed, and the CLI refuses to start
 * when it says no. The complementary runtime guard — severing actual outbound
 * sockets — lives in the CLI, because it patches process globals; this module
 * stays pure so it can be unit-tested and reused by a fork's own host process.
 */

import { OfflineViolationError } from './errors.js';
import type { Capabilities } from './spi/capabilities.js';

/**
 * `offline` — loopback only, local provider only, outbound egress fused.
 * `networked` — the operator has explicitly accepted egress and remote binding.
 */
export type RuntimeMode = 'offline' | 'networked';

export const RUNTIME_MODES: readonly RuntimeMode[] = ['offline', 'networked'];

export function isRuntimeMode(value: unknown): value is RuntimeMode {
  return value === 'offline' || value === 'networked';
}

/** IPv4 loopback is the whole 127.0.0.0/8 block, not just 127.0.0.1. */
const IPV4_LOOPBACK = /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * True when a host names this machine and nothing else.
 *
 * `localhost` is included because that is what an operator types, even though it
 * resolves through DNS. Deliberately excluded: `0.0.0.0` and `::` — as a bind
 * address they mean *every* interface, which is exactly what offline mode is
 * meant to prevent.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  return IPV4_LOOPBACK.test(h);
}

export interface OfflinePolicyInput {
  mode: RuntimeMode;
  /** The address the server will bind, when it will bind one. */
  host?: string;
  /**
   * The operator has explicitly accepted INBOUND exposure on a non-loopback
   * address. Orthogonal to {@link RuntimeMode}: a container binding `0.0.0.0`
   * inside its own network namespace is reachable only through a port mapping
   * the operator chose, and says nothing about egress. Keeping the two separate
   * is what lets a Docker deployment stay offline (fused egress, local store)
   * while still serving.
   */
  expose?: boolean;
  /** Capabilities of the provider that is about to be used. */
  capabilities?: Pick<Capabilities, 'requiresNetwork'>;
  /** Provider name, for a message that points at the actual culprit. */
  providerName?: string;
}

/**
 * Throw {@link OfflineViolationError} when the requested configuration would
 * break the offline guarantee. A no-op in `networked` mode — that mode's whole
 * purpose is to be permitted.
 *
 * Two independent clauses:
 *  - the bind address, unless `expose` was set (inbound exposure);
 *  - the provider's own network requirement (outbound egress), which `expose`
 *    deliberately does NOT waive.
 */
export function assertOfflinePolicy(input: OfflinePolicyInput): void {
  if (input.mode === 'networked') return;

  if (input.host !== undefined && input.expose !== true && !isLoopbackHost(input.host)) {
    throw new OfflineViolationError(
      `Offline mode refuses to bind '${input.host}': only loopback addresses are permitted.`,
      'host',
      'Pass --expose to accept inbound connections while staying offline, or ' +
        '--networked to also allow egress.',
    );
  }

  if (input.capabilities?.requiresNetwork === true) {
    const name = input.providerName ?? 'the configured provider';
    throw new OfflineViolationError(
      `Offline mode refuses provider '${name}': it declares requiresNetwork=true.`,
      'provider',
      'Use a local provider (fs, memory), or pass --networked to allow egress. ' +
        '--expose does not waive this: it governs inbound only.',
    );
  }
}
