import { describe, it, expect } from 'vitest';
import { unifiedDiff } from './diff.js';
import { ContentTooLargeError } from './errors.js';
import { LIMITS } from './model/limits.js';

describe('unifiedDiff — basic output', () => {
  it('produces a unified diff between two different strings', () => {
    const result = unifiedDiff('hello\nworld\n', 'hello\nearth\n', {
      oldLabel: 'old.txt',
      newLabel: 'new.txt',
    });
    expect(result).toContain('--- old.txt');
    expect(result).toContain('+++ new.txt');
    expect(result).toContain('-world');
    expect(result).toContain('+earth');
  });

  it('uses default labels when none provided', () => {
    const result = unifiedDiff('a\n', 'b\n');
    expect(result).toContain('--- a');
    expect(result).toContain('+++ b');
  });

  it('respects custom context lines', () => {
    const old = 'a\nb\nc\nd\ne\nf\ng\n';
    const new_ = 'a\nb\nc\nX\ne\nf\ng\n';
    const result0 = unifiedDiff(old, new_, { context: 0 });
    const result5 = unifiedDiff(old, new_, { context: 5 });
    // Zero context should be shorter than 5-line context.
    expect(result0.length).toBeLessThan(result5.length);
  });
});

describe('unifiedDiff — identical inputs', () => {
  it('returns empty string for identical content', () => {
    expect(unifiedDiff('same\n', 'same\n')).toBe('');
  });

  it('returns empty string for two empty strings', () => {
    expect(unifiedDiff('', '')).toBe('');
  });
});

describe('unifiedDiff — size cap', () => {
  const limit = LIMITS.MAX_DIFF_INPUT_BYTES;
  const oversized = 'x'.repeat(limit + 1);

  it('throws ContentTooLargeError when old content exceeds limit', () => {
    expect(() => unifiedDiff(oversized, 'small')).toThrow(ContentTooLargeError);
    try {
      unifiedDiff(oversized, 'small');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentTooLargeError);
      const err = e as ContentTooLargeError;
      expect(err.code).toBe('CONTENT_TOO_LARGE');
      expect(err.limit).toBe(limit);
      expect(err.actual).toBeGreaterThan(limit);
    }
  });

  it('throws ContentTooLargeError when new content exceeds limit', () => {
    expect(() => unifiedDiff('small', oversized)).toThrow(ContentTooLargeError);
  });

  it('accepts content exactly at the limit', () => {
    const atLimit = 'y'.repeat(limit);
    // Should not throw — exactly at limit, not over.
    expect(() => unifiedDiff(atLimit, 'different')).not.toThrow();
  });
});

describe('unifiedDiff — changed-lines cap', () => {
  const limit = LIMITS.MAX_DIFF_CHANGED_LINES;
  // Versions that share no line: each line is removed and another added, so
  // a diff of n lines each way changes 2n lines.
  const numbered = (prefix: string, n: number): string =>
    Array.from({ length: n }, (_, i) => `${prefix} ${i}`).join('\n') + '\n';

  it('refuses versions that differ in more lines than the cap', () => {
    const n = limit / 2 + 1;
    let caught: unknown;
    try {
      unifiedDiff(numbered('old', n), numbered('new', n));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ContentTooLargeError);
    const err = caught as ContentTooLargeError;
    expect(err.message).toBe(`Too many changes to diff: more than ${limit} lines added or removed`);
    expect(err.limit).toBe(limit);
  });

  it('still diffs versions that differ in exactly the cap', () => {
    const n = limit / 2;
    const result = unifiedDiff(numbered('old', n), numbered('new', n));
    const changed = result
      .split('\n')
      .filter((line) => line.startsWith('-old ') || line.startsWith('+new '));
    expect(changed).toHaveLength(limit);
  });
});

describe('unifiedDiff — multi-byte content', () => {
  it('measures byte length correctly for multi-byte UTF-8', () => {
    // Each emoji is 4 bytes UTF-8. Create content just over the byte limit.
    const emoji = '🎉';
    const count = Math.floor(LIMITS.MAX_DIFF_INPUT_BYTES / 4) + 1;
    const oversized = emoji.repeat(count);
    expect(() => unifiedDiff(oversized, 'small')).toThrow(ContentTooLargeError);
  });
});
