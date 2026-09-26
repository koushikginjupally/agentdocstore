import { describe, it, expect } from 'vitest';

import {
  assertOfflinePolicy,
  isLoopbackHost,
  isRuntimeMode,
  RUNTIME_MODES,
  OfflineViolationError,
  isProviderModule,
  describeProviderModuleDefect,
} from './index.js';

// ---------------------------------------------------------------------------
// isLoopbackHost
// ---------------------------------------------------------------------------

describe('isLoopbackHost', () => {
  it('accepts the whole 127.0.0.0/8 block, not just 127.0.0.1', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.0.0.53')).toBe(true);
    expect(isLoopbackHost('127.255.255.254')).toBe(true);
  });

  it('accepts localhost and IPv6 loopback in both spellings', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('LocalHost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('0:0:0:0:0:0:0:1')).toBe(true);
  });

  it('rejects wildcard binds, which expose every interface', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('::')).toBe(false);
  });

  it('rejects LAN, public and lookalike hosts', () => {
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
    expect(isLoopbackHost('example.com')).toBe(false);
    // Lookalikes that must not pass a naive prefix check.
    expect(isLoopbackHost('127.0.0.1.example.com')).toBe(false);
    expect(isLoopbackHost('1270.0.0.1')).toBe(false);
    expect(isLoopbackHost('localhost.evil.test')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Runtime mode
// ---------------------------------------------------------------------------

describe('runtime mode', () => {
  it('recognises exactly two modes', () => {
    expect(RUNTIME_MODES).toEqual(['offline', 'networked']);
    expect(isRuntimeMode('offline')).toBe(true);
    expect(isRuntimeMode('networked')).toBe(true);
    expect(isRuntimeMode('online')).toBe(false);
    expect(isRuntimeMode(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertOfflinePolicy
// ---------------------------------------------------------------------------

describe('assertOfflinePolicy', () => {
  const localCaps = { requiresNetwork: false };
  const remoteCaps = { requiresNetwork: true };

  it('permits a loopback host with a local provider', () => {
    expect(() =>
      assertOfflinePolicy({ mode: 'offline', host: '127.0.0.1', capabilities: localCaps }),
    ).not.toThrow();
  });

  it('refuses a non-loopback bind in offline mode', () => {
    expect(() =>
      assertOfflinePolicy({ mode: 'offline', host: '0.0.0.0', capabilities: localCaps }),
    ).toThrow(OfflineViolationError);
  });

  it('points at --expose and --networked so the operator can choose', () => {
    try {
      assertOfflinePolicy({ mode: 'offline', host: '0.0.0.0', capabilities: localCaps });
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as OfflineViolationError;
      expect(e.subject).toBe('host');
      expect(e.remedy).toContain('--expose');
      expect(e.remedy).toContain('--networked');
    }
  });

  it('permits a non-loopback bind when expose is set — inbound is not egress', () => {
    expect(() =>
      assertOfflinePolicy({
        mode: 'offline',
        host: '0.0.0.0',
        expose: true,
        capabilities: localCaps,
      }),
    ).not.toThrow();
  });

  it('does NOT let expose waive the provider clause — that is egress', () => {
    expect(() =>
      assertOfflinePolicy({
        mode: 'offline',
        host: '0.0.0.0',
        expose: true,
        capabilities: remoteCaps,
        providerName: 'postgres',
      }),
    ).toThrow(/requiresNetwork=true/);
  });

  it('refuses a provider that declares requiresNetwork', () => {
    try {
      assertOfflinePolicy({
        mode: 'offline',
        host: '127.0.0.1',
        capabilities: remoteCaps,
        providerName: 'postgres',
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(OfflineViolationError);
      const e = err as OfflineViolationError;
      expect(e.subject).toBe('provider');
      expect(e.message).toContain('postgres');
      expect(e.remedy).toContain('--networked');
    }
  });

  it('is a no-op in networked mode — that is the point of the mode', () => {
    expect(() =>
      assertOfflinePolicy({
        mode: 'networked',
        host: '0.0.0.0',
        capabilities: remoteCaps,
        providerName: 'postgres',
      }),
    ).not.toThrow();
  });

  it('checks the host even when no provider is supplied (stdio MCP has no bind)', () => {
    expect(() => assertOfflinePolicy({ mode: 'offline' })).not.toThrow();
    expect(() => assertOfflinePolicy({ mode: 'offline', capabilities: remoteCaps })).toThrow(
      OfflineViolationError,
    );
  });
});

// ---------------------------------------------------------------------------
// Provider module contract
// ---------------------------------------------------------------------------

describe('isProviderModule', () => {
  const valid = {
    providerName: 'postgres',
    createProvider: async () => ({}) as never,
  };

  it('accepts a minimal valid module', () => {
    expect(isProviderModule(valid)).toBe(true);
  });

  it('accepts an optionsSchema exposing parse()', () => {
    expect(isProviderModule({ ...valid, optionsSchema: { parse: (v: unknown) => v } })).toBe(true);
  });

  it.each([
    ['not an object', 42, 'module did not export an object'],
    ['null', null, 'module did not export an object'],
    ['no providerName', { createProvider: () => undefined }, "missing a non-empty 'providerName'"],
    [
      'empty providerName',
      { providerName: '', createProvider: () => undefined },
      "missing a non-empty 'providerName'",
    ],
    ['no createProvider', { providerName: 'x' }, "missing a 'createProvider(options)' export"],
    [
      'schema without parse',
      { ...valid, optionsSchema: {} },
      "'optionsSchema' is present but has no parse()",
    ],
  ])('rejects %s and explains why', (_label, value, expectedDefect) => {
    expect(isProviderModule(value)).toBe(false);
    expect(describeProviderModuleDefect(value)).toContain(expectedDefect);
  });
});
