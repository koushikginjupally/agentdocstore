/**
 * Dependency-free credential scanner.
 *
 * `scan` detects secrets and credentials in text content by matching known
 * patterns (PEM keys, AWS keys, JWTs, bearer tokens, platform tokens, generic
 * assignments, connection strings). `redact` replaces detected spans with
 * placeholder tags.
 *
 * Design constraints:
 *   - Every regex quantifier is bounded to prevent catastrophic backtracking.
 *   - The generic-assignment pattern is tuned to skip obvious placeholders.
 *   - No external dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single credential finding within scanned content. */
export interface Finding {
  /** Credential type identifier (e.g. `'pem-private-key'`, `'aws-access-key'`). */
  readonly type: string;
  /** 1-based line number where the finding starts. */
  readonly line: number;
  /** Absolute byte offset of the match start within `content`. */
  readonly start: number;
  /** Absolute byte offset of the match end (exclusive) within `content`. */
  readonly end: number;
}

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

/**
 * Each pattern definition carries:
 *   - `type`  — the Finding.type label
 *   - `regex` — a global regex (must have the `g` flag)
 *   - `comment` — documents intent for maintainability
 */
interface PatternDef {
  readonly type: string;
  readonly regex: RegExp;
  readonly comment: string;
}

/**
 * Placeholder values that the generic-assignment pattern must skip.
 * Lowercased for comparison.
 */
const PLACEHOLDER_VALUES = new Set([
  '',
  'changeme',
  'xxx',
  'xxxx',
  'xxxxx',
  'example',
  'redacted',
  'todo',
  'fixme',
  'placeholder',
  'your-password',
  'your-secret',
  'your-token',
  'your-api-key',
]);

/** Returns true when a value looks like a placeholder rather than a real secret. */
function isPlaceholder(value: string): boolean {
  const trimmed = value.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (trimmed.length === 0) return true;
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_VALUES.has(lower)) return true;
  // Template / env-var references: ${VAR}, $VAR, {{VAR}}, <your-password>
  if (/^\$\{[^}]{1,80}\}$/.test(trimmed)) return true;
  if (/^\$[A-Z_][A-Z0-9_]{0,80}$/.test(trimmed)) return true;
  if (/^\{\{[^}]{1,80}\}\}$/.test(trimmed)) return true;
  if (/^<[^>]{1,80}>$/.test(trimmed)) return true;
  return false;
}

const PATTERNS: readonly PatternDef[] = [
  {
    type: 'pem-private-key',
    // Matches -----BEGIN (RSA|DSA|EC|OPENSSH|ENCRYPTED) PRIVATE KEY----- blocks.
    // Base64 body limited to 16 KB of characters.
    regex:
      /-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]{1,16384}?-----END (?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g,
    comment: 'PEM / OpenSSH private key blocks',
  },
  {
    type: 'aws-access-key',
    // AWS access key IDs start with AKIA (long-term) or ASIA (temporary/STS).
    // Followed by exactly 16 uppercase alphanumeric characters.
    regex: /(?:^|[^A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?=[^A-Z0-9]|$)/gm,
    comment: 'AWS access key IDs (AKIA/ASIA prefix + 16 uppercase alphanumerics)',
  },
  {
    type: 'aws-secret-key',
    // AWS secret access keys are 40 characters of base64-like characters.
    // Anchored behind a keyword to reduce false positives.
    regex:
      /(?:aws_secret_access_key|secret_access_key|SecretAccessKey)[\s]*[=:"']\s*[A-Za-z0-9/+=]{40}(?=[^A-Za-z0-9/+=]|$)/gi,
    comment: 'AWS secret access key shapes (keyword + 40 base64 chars)',
  },
  {
    type: 'jwt',
    // JWTs are three dot-separated base64url segments. Header is short (< 512),
    // payload moderate (< 4096), signature moderate (< 1024).
    regex: /eyJ[A-Za-z0-9_-]{4,512}\.eyJ[A-Za-z0-9_-]{4,4096}\.[A-Za-z0-9_-]{4,1024}/g,
    comment: 'JSON Web Tokens (three base64url dot-separated segments starting with eyJ)',
  },
  {
    type: 'bearer-token',
    // Bearer or OAuth tokens in Authorization-style headers.
    regex: /[Bb]earer\s+[A-Za-z0-9_\-.~+/]{20,1024}/g,
    comment: 'Bearer / OAuth tokens in authorization headers or config',
  },
  {
    type: 'github-token',
    // GitHub PAT / OAuth / user / server / refresh tokens.
    regex: /gh[pousr]_[A-Za-z0-9_]{36,255}/g,
    comment: 'GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_ prefixes)',
  },
  {
    type: 'gitlab-token',
    // GitLab personal access tokens.
    regex: /glpat-[A-Za-z0-9_-]{20,255}/g,
    comment: 'GitLab personal access tokens (glpat- prefix)',
  },
  {
    type: 'slack-token',
    // Slack bot, app, user, workspace, and refresh tokens.
    regex: /xox[abprs]-[A-Za-z0-9-]{10,255}/g,
    comment: 'Slack tokens (xoxb-, xoxa-, xoxp-, xoxr-, xoxs- prefixes)',
  },
  {
    type: 'connection-string-password',
    // scheme://user:password@host — captures the password portion.
    // Password bounded to 256 chars; scheme, user, and host also bounded.
    regex: /[a-zA-Z][a-zA-Z0-9+.-]{1,30}:\/\/[^\s:@]{1,128}:([^\s@]{1,256})@[^\s]{1,512}/g,
    comment: 'Connection-string embedded passwords (scheme://user:password@host)',
  },
];

/**
 * Generic assignment pattern built separately because it requires a
 * placeholder filter post-match.
 *
 * Matches: password = "value", api_key: 'value', token=value, and forms where
 * the keyword is embedded in a longer identifier such as
 * `aws_secret_access_key = ...`, `client_secret_id: ...` or `AUTH_TOKEN_V2=...`.
 * The trailing `[A-Za-z0-9_.-]{0,64}` is what admits those: without it the
 * keyword had to sit immediately before the separator, which missed the most
 * common real-world config naming conventions. For a credential scanner a
 * false negative is worse than a false positive, and the placeholder filter
 * below absorbs the extra noise.
 *
 * That identifier tail is bounded because each keyword starts a match of its
 * own: unbounded, every "token" in "tokentoken…" re-read the rest of the run,
 * so the scan took time growing with the square of the input (256 KB took
 * 13 s).
 *
 * The keywords and the value are captured so the placeholder filter can
 * inspect the value group.
 */
const GENERIC_ASSIGNMENT_REGEX =
  /(?:password|passwd|secret|api_key|apikey|token)[A-Za-z0-9_.-]{0,64}\s*[=:]\s*["'`]?([^\s"'`]{1,512})["'`]?/gi;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * The offset of every newline in `content`, in order. Found once per scan, so
 * each finding's line is a binary search: counting from the start of the
 * content for every finding made a finding on every line take time growing
 * with the square of the content.
 */
function newlineOffsets(content: string): number[] {
  const offsets: number[] = [];
  for (let i = content.indexOf('\n'); i !== -1; i = content.indexOf('\n', i + 1)) {
    offsets.push(i);
  }
  return offsets;
}

/**
 * The 1-based line number of `offset`: one more than the newlines before it.
 */
function lineNumberAt(newlines: readonly number[], offset: number): number {
  let lo = 0;
  let hi = newlines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((newlines[mid] ?? Infinity) < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

/**
 * Scan `content` for credential-like patterns.
 *
 * Returns an immutable array of {@link Finding} objects sorted by `start`
 * offset. Overlapping findings are deduplicated: when two patterns match
 * overlapping spans, the longer match wins.
 *
 * @param content - The text to scan (source code, config files, etc.).
 * @returns Detected credential findings, sorted by offset.
 */
export function scan(content: string): readonly Finding[] {
  const raw: Finding[] = [];
  let newlines: number[] | undefined;
  const lineOf = (offset: number): number =>
    lineNumberAt((newlines ??= newlineOffsets(content)), offset);

  // Run each fixed pattern.
  for (const pat of PATTERNS) {
    pat.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.regex.exec(content)) !== null) {
      let matchStart = m.index;
      let matchStr = m[0];

      // For aws-access-key, the leading non-alphanumeric char is a lookaround
      // workaround. Trim it from the match span if present.
      if (pat.type === 'aws-access-key' && matchStr.length > 20) {
        matchStart += matchStr.length - 20;
        matchStr = matchStr.slice(matchStr.length - 20);
      }

      // For connection-string-password, narrow the finding to the password
      // capture group (group 1).
      if (pat.type === 'connection-string-password' && m[1] !== undefined) {
        const pwdOffset = m[0].indexOf(':' + m[1] + '@');
        if (pwdOffset !== -1) {
          matchStart = m.index + pwdOffset + 1; // skip the ':'
          matchStr = m[1];
        }
      }

      raw.push({
        type: pat.type,
        line: lineOf(matchStart),
        start: matchStart,
        end: matchStart + matchStr.length,
      });
    }
  }

  // Run the generic assignment pattern with placeholder filtering.
  GENERIC_ASSIGNMENT_REGEX.lastIndex = 0;
  let gm: RegExpExecArray | null;
  while ((gm = GENERIC_ASSIGNMENT_REGEX.exec(content)) !== null) {
    const value = gm[1] ?? '';
    if (isPlaceholder(value)) continue;
    raw.push({
      type: 'generic-secret',
      line: lineOf(gm.index),
      start: gm.index,
      end: gm.index + gm[0].length,
    });
  }

  // Sort by start offset ascending, then by length descending for overlap tie-breaking.
  raw.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  // Deduplicate overlapping findings: keep the first (longest at each offset).
  const deduped: Finding[] = [];
  let lastEnd = -1;
  for (const f of raw) {
    if (f.start >= lastEnd) {
      deduped.push(f);
      lastEnd = f.end;
    }
  }

  return deduped;
}

/**
 * Replace each finding span in `content` with `[REDACTED:<type>]`.
 *
 * Replacements are applied right-to-left so that earlier offsets remain valid
 * even when replacement text differs in length from the original span.
 *
 * @param content  - The original text.
 * @param findings - Findings from {@link scan} (or a subset).
 * @returns The redacted text.
 */
export function redact(content: string, findings: readonly Finding[]): string {
  // Work on a copy of findings sorted by start offset descending (right-to-left).
  const sorted = [...findings].sort((a, b) => b.start - a.start);
  let result = content;
  for (const f of sorted) {
    const tag = `[REDACTED:${f.type}]`;
    result = result.slice(0, f.start) + tag + result.slice(f.end);
  }
  return result;
}
