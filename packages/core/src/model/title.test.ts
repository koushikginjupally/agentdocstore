import { describe, it, expect } from 'vitest';
import { ValidationError } from '../errors.js';
import { LIMITS, sizeOverLimit } from './limits.js';
import { validateTitle } from './title.js';

describe('validateTitle', () => {
  it('accepts an ordinary title and one at the byte limit', () => {
    expect(() => validateTitle('Release notes')).not.toThrow();
    expect(() => validateTitle('x'.repeat(LIMITS.MAX_TITLE_BYTES))).not.toThrow();
  });

  it('rejects a blank title', () => {
    for (const title of ['', '   ', '\t\n']) {
      expect(() => validateTitle(title)).toThrow(new ValidationError('Title must not be empty'));
    }
  });

  it('counts UTF-8 bytes, not characters', () => {
    // 'é' is two bytes: 150 fit exactly, 151 do not.
    expect(() => validateTitle('é'.repeat(LIMITS.MAX_TITLE_BYTES / 2))).not.toThrow();
    expect(() => validateTitle('é'.repeat(LIMITS.MAX_TITLE_BYTES / 2 + 1))).toThrow(
      new ValidationError('Title exceeds maximum length (302 bytes; the limit is 300 bytes)'),
    );
  });
});

describe('sizeOverLimit', () => {
  it('says how big the value is and what the limit is', () => {
    expect(sizeOverLimit(10_976, 10_000)).toBe('10976 bytes; the limit is 10000 bytes');
  });
});
