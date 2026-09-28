/**
 * Core errors are recognised with `instanceof`: the server maps them to HTTP
 * statuses, the MCP tools to tool errors, and `doctor` checks that a provider
 * throws them. A third-party provider imports core itself, and under npx or a
 * global install that is a different copy of this package from the CLI's, with
 * different class objects. These tests load a second copy of this module and
 * check that each copy still recognises the other's errors.
 */

import { describe, it, expect } from 'vitest';
import * as core from './errors.js';

/** A separate copy of this module, as a provider with its own core has. */
async function loadCopy(): Promise<typeof core> {
  const url = new URL('./errors.ts?copy=provider', import.meta.url).href;
  return (await import(url)) as typeof core;
}

const KINDS = [
  'VersionConflictError',
  'NotFoundError',
  'ValidationError',
  'ContentTooLargeError',
  'OfflineViolationError',
] as const;

describe('core errors across copies of @agentdocstore/core', () => {
  it('loads a genuinely separate copy for these tests', async () => {
    const copy = await loadCopy();
    expect(copy.NotFoundError).not.toBe(core.NotFoundError);
  });

  it.each(KINDS)('recognises a %s made by another copy', async (kind) => {
    const copy = await loadCopy();
    const error: unknown = new copy[kind]('from the other copy');
    expect(error instanceof core[kind]).toBe(true);
    expect(error instanceof Error).toBe(true);
  });

  it('does not take one kind of core error for another', async () => {
    const copy = await loadCopy();
    const error: unknown = new copy.NotFoundError();
    for (const kind of KINDS.filter((k) => k !== 'NotFoundError')) {
      expect(error instanceof core[kind]).toBe(false);
    }
  });

  it('keeps the fields of an error from another copy', async () => {
    const copy = await loadCopy();
    const error: unknown = new copy.ContentTooLargeError('Too big', 10, 20);
    expect(error instanceof core.ContentTooLargeError).toBe(true);
    if (error instanceof core.ContentTooLargeError) {
      expect([error.message, error.limit, error.actual, error.code]).toEqual([
        'Too big',
        10,
        20,
        'CONTENT_TOO_LARGE',
      ]);
    }
  });

  it('does not recognise a lookalike that only copies the name and code', () => {
    const lookalike: unknown = Object.assign(new Error('Not found'), {
      name: 'NotFoundError',
      code: 'NOT_FOUND',
    });
    expect(lookalike instanceof core.NotFoundError).toBe(false);
  });

  it('keeps the usual instanceof rules for subclasses', async () => {
    class GoneError extends core.NotFoundError {}
    const copy = await loadCopy();
    expect(new GoneError() instanceof core.NotFoundError).toBe(true);
    expect(new GoneError() instanceof GoneError).toBe(true);
    expect(new core.NotFoundError() instanceof GoneError).toBe(false);
    expect(new copy.NotFoundError() instanceof GoneError).toBe(false);
  });

  it('rejects values that are not errors', () => {
    const values: unknown[] = [null, undefined, 'NotFoundError', 42, {}];
    for (const value of values) {
      expect(value instanceof core.NotFoundError).toBe(false);
    }
  });
});
