import { describe, it, expect } from 'vitest';
import { scan, redact } from './scanner.js';
import type { Finding } from './scanner.js';

// ---------------------------------------------------------------------------
// Helper — assert a single finding of the expected type
// ---------------------------------------------------------------------------

function expectOne(content: string, type: string): Finding {
  const findings = scan(content);
  const matches = findings.filter((f) => f.type === type);
  expect(matches.length).toBeGreaterThanOrEqual(1);
  return matches[0]!;
}

function expectNone(content: string, type: string): void {
  const findings = scan(content);
  const matches = findings.filter((f) => f.type === type);
  expect(matches).toHaveLength(0);
}

// ---------------------------------------------------------------------------
// PEM private keys
// ---------------------------------------------------------------------------

describe('scanner — PEM private key', () => {
  const PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIBogIBAAJBALRiMLAHudeSA/x3hB2f+2NRkJKQWE1erYP8akhF8GCAIZ0SNQM
dTjKERIFwR4dIJrFiqxUjfGs4SXPH9wPhIECAwEAAQ==
-----END RSA PRIVATE KEY-----`;

  it('detects PEM private key blocks', () => {
    const f = expectOne(PEM, 'pem-private-key');
    expect(f.line).toBe(1);
    expect(PEM.slice(f.start, f.end)).toContain('BEGIN RSA PRIVATE KEY');
  });

  it('ignores PEM public keys', () => {
    const pub = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA
-----END PUBLIC KEY-----`;
    expectNone(pub, 'pem-private-key');
  });
});

// ---------------------------------------------------------------------------
// AWS access key
// ---------------------------------------------------------------------------

describe('scanner — AWS access key', () => {
  it('detects AKIA prefixed access key', () => {
    const content = 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE';
    const f = expectOne(content, 'aws-access-key');
    expect(content.slice(f.start, f.end)).toBe('AKIAIOSFODNN7EXAMPLE');
  });

  it('detects ASIA prefixed temporary key', () => {
    const content = 'key=ASIAZ34567890123TEMP';
    const f = expectOne(content, 'aws-access-key');
    expect(content.slice(f.start, f.end)).toBe('ASIAZ34567890123TEMP');
  });

  it('ignores AKID or similar non-matching prefixes', () => {
    expectNone('AKIDNOTAVALIDKEY1234', 'aws-access-key');
  });

  it('ignores an AKIA string embedded in longer alphanumeric run', () => {
    // 22 uppercase chars that happen to start with AKIA but are longer than 20
    expectNone('XXAKIAIOSFODNN7EXAMPLE', 'aws-access-key');
  });
});

// ---------------------------------------------------------------------------
// AWS secret key
// ---------------------------------------------------------------------------

describe('scanner — AWS secret key', () => {
  it('detects secret access key with keyword', () => {
    const content = 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const f = expectOne(content, 'aws-secret-key');
    expect(f.start).toBe(0);
  });

  it('ignores a bare 40-char base64 without keyword', () => {
    const bare = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    expectNone(bare, 'aws-secret-key');
  });
});

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

describe('scanner — JWT', () => {
  // Synthetic JWT-shaped string (three base64url segments starting with eyJ).
  const JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Q5BpiBslDFO1cWogNlCHeaagzXFMM2Cfa_D7iYh3ABC';

  it('detects a well-formed JWT', () => {
    const f = expectOne(`session=${JWT}`, 'jwt');
    expect(f.type).toBe('jwt');
  });

  it('ignores two-segment dot strings', () => {
    expectNone('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'jwt');
  });
});

// ---------------------------------------------------------------------------
// Bearer token
// ---------------------------------------------------------------------------

describe('scanner — bearer token', () => {
  it('detects bearer tokens', () => {
    const content = 'Authorization: Bearer ya29.a0AfH6SMBx12345678901234567890_abc';
    const f = expectOne(content, 'bearer-token');
    expect(content.slice(f.start, f.end)).toContain('ya29');
  });

  it('ignores Bearer with short value', () => {
    expectNone('Bearer short', 'bearer-token');
  });
});

// ---------------------------------------------------------------------------
// GitHub tokens
// ---------------------------------------------------------------------------

describe('scanner — GitHub token', () => {
  it('detects ghp_ personal access token', () => {
    const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij1234';
    const f = expectOne(`GH_PAT=${token}`, 'github-token');
    expect(f.type).toBe('github-token');
  });

  it('ignores gh_ without valid suffix letter', () => {
    expectNone('ghx_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij1234', 'github-token');
  });
});

// ---------------------------------------------------------------------------
// GitLab tokens
// ---------------------------------------------------------------------------

describe('scanner — GitLab token', () => {
  it('detects glpat- token', () => {
    const token = 'glpat-xY7z9K_mNpL4aBcDeFgHiJ';
    const f = expectOne(token, 'gitlab-token');
    expect(f.type).toBe('gitlab-token');
  });

  it('ignores glpa- (no t suffix)', () => {
    expectNone('glpa-xY7z9K_mNpL4aBcDeFgHiJ', 'gitlab-token');
  });
});

// ---------------------------------------------------------------------------
// Slack tokens
// ---------------------------------------------------------------------------

describe('scanner — Slack token', () => {
  it('detects xoxb- bot token', () => {
    const content = 'SLACK_BOT=xoxb-1234567890-abcdefghij';
    const f = expectOne(content, 'slack-token');
    expect(content.slice(f.start, f.end)).toContain('xoxb-');
  });

  it('ignores xoxz- (invalid type letter)', () => {
    expectNone('xoxz-1234567890-abcdefghij', 'slack-token');
  });
});

// ---------------------------------------------------------------------------
// Connection-string password
// ---------------------------------------------------------------------------

describe('scanner — connection string password', () => {
  it('detects password from postgres://user:pass@host', () => {
    const content = 'postgres://admin:s3cret_P4ss!@db.internal.example.com:5432/mydb';
    const f = expectOne(content, 'connection-string-password');
    expect(content.slice(f.start, f.end)).toBe('s3cret_P4ss!');
  });

  it('ignores scheme://host without credentials', () => {
    expectNone('https://example.com/path', 'connection-string-password');
  });
});

// ---------------------------------------------------------------------------
// Generic secret assignment
// ---------------------------------------------------------------------------

describe('scanner — generic secret assignment', () => {
  it('detects password = "realvalue"', () => {
    const content = 'password = "hunter2"';
    const f = expectOne(content, 'generic-secret');
    expect(f.type).toBe('generic-secret');
  });

  it('detects api_key: some_real_key_value', () => {
    const content = 'api_key: sk_live_abc123def456ghi789';
    const f = expectOne(content, 'generic-secret');
    expect(content.slice(f.start, f.end)).toContain('sk_live_');
  });

  // Regression: the keyword is frequently embedded in a longer identifier in
  // real config (`aws_secret_access_key`, `client_secret_id`, `AUTH_TOKEN_V2`).
  // An earlier pattern required the keyword to sit immediately before the
  // separator and silently missed all of these.
  it('detects a keyword embedded in a longer identifier', () => {
    const f = expectOne(
      'aws_secret_access_key = wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
      'generic-secret',
    );
    expect(f.type).toBe('generic-secret');
  });

  it('detects an uppercase suffixed identifier', () => {
    expectOne('AUTH_TOKEN_V2=abc123def456ghi789', 'generic-secret');
  });

  it('detects a colon-separated suffixed identifier', () => {
    expectOne('client_secret_id: s3cr3tv4lue1234567890', 'generic-secret');
  });

  it('detects a keyword with a 64-character suffix', () => {
    expectOne(`token_${'x'.repeat(63)}=s3cr3tv4lue1234567890`, 'generic-secret');
  });

  // Regression: the identifier after the keyword was unbounded, so each of
  // the keywords in "tokentoken…" re-read the whole run to its end: 256 KB
  // took 13 s and the 5 MB content limit about 1.5 hours, on the server's
  // only thread.
  it('scans a long run of repeated keywords in linear time', () => {
    const content = 'token'.repeat((256 * 1024) / 5);
    const t0 = performance.now();
    expect(scan(content)).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('still skips placeholders on suffixed identifiers', () => {
    expectNone('db_password_v2 = ${DB_PASSWORD}', 'generic-secret');
    expectNone('api_key_v2 = changeme', 'generic-secret');
    expectNone('secret_token = <your-token>', 'generic-secret');
  });

  it('skips placeholder password = "changeme"', () => {
    expectNone('password = "changeme"', 'generic-secret');
  });

  it('skips password = ""', () => {
    expectNone('password = ""', 'generic-secret');
  });

  it('skips password = ${ENV_VAR}', () => {
    expectNone('password = ${DB_PASSWORD}', 'generic-secret');
  });

  it('skips password = <your-password>', () => {
    expectNone('password = <your-password>', 'generic-secret');
  });

  it('skips secret = "xxx"', () => {
    expectNone('secret = "xxx"', 'generic-secret');
  });

  it('skips token = "example"', () => {
    expectNone('token = "example"', 'generic-secret');
  });

  it('skips token = "redacted"', () => {
    expectNone('token = "redacted"', 'generic-secret');
  });
});

// ---------------------------------------------------------------------------
// redact
// ---------------------------------------------------------------------------

describe('redact', () => {
  it('replaces a single finding', () => {
    const content = 'key = AKIAIOSFODNN7EXAMPLE rest';
    const findings = scan(content);
    const result = redact(content, findings);
    expect(result).toContain('[REDACTED:');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('handles multiple findings on one line', () => {
    const content = 'keys: AKIAIOSFODNN7EXAMPLE and ASIAZ34567890123TEMP here';
    const findings = scan(content);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    const result = redact(content, findings);
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result).not.toContain('ASIAZ34567890123TEMP');
    // Both redaction tags present
    expect(result.match(/\[REDACTED:aws-access-key\]/g)?.length).toBe(2);
  });

  it('preserves surrounding text with adjacent spans', () => {
    const content = 'a=AKIAIOSFODNN7EXAMPLE b=ASIAZ34567890123TEMP';
    const findings = scan(content);
    const result = redact(content, findings);
    expect(result).toContain('a=');
    expect(result).toContain('b=');
  });

  it('returns original content when findings array is empty', () => {
    const content = 'no secrets here';
    expect(redact(content, [])).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('scanner — edge cases', () => {
  it('returns empty array for empty string', () => {
    expect(scan('')).toHaveLength(0);
  });

  it('does not hang on pathological repeated input', () => {
    // Large repeated string that could cause backtracking in naive regexes.
    const big = 'password = "' + 'a'.repeat(10_000) + '"';
    const start = Date.now();
    scan(big);
    const elapsed = Date.now() - start;
    // Should complete well under 5 seconds.
    expect(elapsed).toBeLessThan(5000);
  });

  it('line numbers are 1-based and correct across multiple lines', () => {
    const content = 'line1\nline2\npassword = "real_secret_value"\nline4';
    const findings = scan(content);
    const f = findings.find((x) => x.type === 'generic-secret');
    expect(f).toBeDefined();
    expect(f!.line).toBe(3);
  });
});
