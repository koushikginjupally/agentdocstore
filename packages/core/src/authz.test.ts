import { describe, it, expect } from 'vitest';
import { NotFoundError } from './errors.js';
import {
  type AccessTarget,
  assertCanComment,
  assertCanDelete,
  assertCanRead,
  assertCanReadRaw,
  assertCanWrite,
  canRead,
  canWrite,
  isOwner,
} from './authz.js';

const OWNER = 'alice';
const OTHER = 'bob';

const privateDocument: AccessTarget = { id: 'p1', visibility: 'PRIVATE', createdBy: OWNER };
const publicDocument: AccessTarget = { id: 'u1', visibility: 'PUBLIC', createdBy: OWNER };

describe('authz — PRIVATE documents are owner-only', () => {
  it('owner passes read/raw/write/delete/comment on a PRIVATE doc', () => {
    expect(() => assertCanRead(privateDocument, OWNER)).not.toThrow();
    expect(() => assertCanReadRaw(privateDocument, OWNER)).not.toThrow();
    expect(() => assertCanWrite(privateDocument, OWNER)).not.toThrow();
    expect(() => assertCanDelete(privateDocument, OWNER)).not.toThrow();
    expect(() => assertCanComment(privateDocument, OWNER)).not.toThrow();
  });

  it('non-owner is denied read/raw/write/delete/comment with NotFoundError', () => {
    const guards = [
      assertCanRead,
      assertCanReadRaw,
      assertCanWrite,
      assertCanDelete,
      assertCanComment,
    ];
    for (const guard of guards) {
      expect(() => guard(privateDocument, OTHER)).toThrow(NotFoundError);
    }
  });

  it('denial does not disclose existence or the owner identity', () => {
    try {
      assertCanRead(privateDocument, OTHER);
      throw new Error('expected assertCanRead to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundError);
      const msg = (e as Error).message;
      expect(msg).not.toContain(OWNER);
      expect(msg.toLowerCase()).toContain('not found');
    }
  });

  it('anonymous / empty viewer is denied a PRIVATE doc', () => {
    expect(() => assertCanRead(privateDocument, undefined)).toThrow(NotFoundError);
    expect(() => assertCanRead(privateDocument, null)).toThrow(NotFoundError);
    expect(() => assertCanRead(privateDocument, '')).toThrow(NotFoundError);
  });
});

describe('authz — PUBLIC documents are readable by all', () => {
  it('any viewer (incl. anonymous) can read/raw/comment a PUBLIC doc', () => {
    for (const viewer of [OWNER, OTHER, undefined, null, '']) {
      expect(() => assertCanRead(publicDocument, viewer)).not.toThrow();
      expect(() => assertCanReadRaw(publicDocument, viewer)).not.toThrow();
      expect(() => assertCanComment(publicDocument, viewer)).not.toThrow();
    }
  });

  it('only the owner may write/delete a PUBLIC doc; non-owner denied with NotFoundError', () => {
    expect(() => assertCanWrite(publicDocument, OWNER)).not.toThrow();
    expect(() => assertCanDelete(publicDocument, OWNER)).not.toThrow();
    expect(() => assertCanWrite(publicDocument, OTHER)).toThrow(NotFoundError);
    expect(() => assertCanDelete(publicDocument, OTHER)).toThrow(NotFoundError);
  });
});

describe('authz — boolean predicates', () => {
  it('isOwner requires an authenticated matching identity', () => {
    expect(isOwner(privateDocument, OWNER)).toBe(true);
    expect(isOwner(privateDocument, OTHER)).toBe(false);
    expect(isOwner(privateDocument, undefined)).toBe(false);
    expect(isOwner(privateDocument, '')).toBe(false);
  });

  it('canRead / canWrite reflect the assert-* gates', () => {
    expect(canRead(publicDocument, OTHER)).toBe(true);
    expect(canRead(privateDocument, OTHER)).toBe(false);
    expect(canRead(privateDocument, OWNER)).toBe(true);
    expect(canWrite(publicDocument, OTHER)).toBe(false);
    expect(canWrite(publicDocument, OWNER)).toBe(true);
  });
});
