/**
 * Core domain model for AgentDocStore.
 *
 * Only the shapes required by the authorization helper are guaranteed stable
 * here; the full model (limits, comment, version) is layered in by sibling
 * modules. `visibility` + `createdBy` are the fields authorization decisions
 * depend on.
 */

/** Per-doc visibility. PUBLIC is the default; PRIVATE is owner-only. */
export type Visibility = 'PUBLIC' | 'PRIVATE';

/** Supported content languages / render modes (18). */
export type Language =
  | 'markdown'
  | 'mermaid'
  | 'plaintext'
  | 'text'
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'java'
  | 'go'
  | 'rust'
  | 'json'
  | 'yaml'
  | 'xml'
  | 'html'
  | 'css'
  | 'sql'
  | 'bash'
  | 'dockerfile';

/** All valid {@link Language} values, for validation and UI enumeration. */
export const LANGUAGES: readonly Language[] = [
  'markdown',
  'mermaid',
  'plaintext',
  'text',
  'javascript',
  'typescript',
  'python',
  'java',
  'go',
  'rust',
  'json',
  'yaml',
  'xml',
  'html',
  'css',
  'sql',
  'bash',
  'dockerfile',
];

/** The default visibility applied when a caller does not specify one. */
export const DEFAULT_VISIBILITY: Visibility = 'PUBLIC';

/**
 * A stored artifact. Content lives in immutable versions addressed by
 * {@link Document.latestVersion}; the metadata pointer is what this type describes.
 */
export interface Document {
  /** URL-safe identifier (see id.ts). */
  readonly id: string;
  /** Human-readable title. */
  title: string;
  /** Content language / render mode. */
  language: Language;
  /** Access visibility. */
  visibility: Visibility;
  /** Identity of the creator; authoritative owner for authorization. */
  readonly createdBy: string;
  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;
  /** ISO-8601 last-update timestamp. */
  updatedAt: string;
  /** Monotonic latest version number (1-based). */
  latestVersion: number;
  /** Optional ISO-8601 expiry (TTL sweep target when the provider lacks native TTL). */
  expiresAt?: string;
}
