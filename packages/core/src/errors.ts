/**
 * Typed core errors. Each carries a discriminant `name` (for `switch (e.name)`)
 * and a stable machine `code`. `Object.setPrototypeOf` keeps `instanceof`
 * reliable across the compiled ESM output.
 */

export type ErrorCode =
  'VERSION_CONFLICT' | 'NOT_FOUND' | 'VALIDATION' | 'CONTENT_TOO_LARGE' | 'OFFLINE_VIOLATION';

/** Raised by CAS `appendVersion` when `expect.latestVersion` is stale. */
export class VersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT' as const;
  constructor(
    message = 'Version conflict',
    readonly expected?: number,
    readonly actual?: number,
  ) {
    super(message);
    this.name = 'VersionConflictError';
    Object.setPrototypeOf(this, VersionConflictError.prototype);
  }
}

/**
 * Raised when a resource does not exist OR the caller is not permitted to see
 * it. Authorization deliberately surfaces as NotFound (not Forbidden) so a
 * PRIVATE doc's existence is never disclosed to a non-owner.
 */
export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND' as const;
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/** Raised on invalid input (bad language, empty title, oversized field, ...). */
export class ValidationError extends Error {
  readonly code = 'VALIDATION' as const;
  constructor(message = 'Validation failed') {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/** Raised when content exceeds a configured size cap (write-time or diff-input). */
export class ContentTooLargeError extends Error {
  readonly code = 'CONTENT_TOO_LARGE' as const;
  constructor(
    message = 'Content too large',
    readonly limit?: number,
    readonly actual?: number,
  ) {
    super(message);
    this.name = 'ContentTooLargeError';
    Object.setPrototypeOf(this, ContentTooLargeError.prototype);
  }
}

/**
 * Raised when the configured runtime mode forbids what was asked for — an
 * offline instance pointed at a networked provider, bound to a non-loopback
 * address, or a dependency attempting outbound egress through the fuse.
 */
export class OfflineViolationError extends Error {
  readonly code = 'OFFLINE_VIOLATION' as const;
  constructor(
    message = 'Offline mode violation',
    /** What was attempted, e.g. `provider`, `host`, `connect`, `fetch`. */
    readonly subject?: string,
    /** How the operator can proceed deliberately. */
    readonly remedy?: string,
  ) {
    super(message);
    this.name = 'OfflineViolationError';
    Object.setPrototypeOf(this, OfflineViolationError.prototype);
  }
}

/** Any core error carrying a known {@link ErrorCode}. */
export type AgentDocStoreError =
  | VersionConflictError
  | NotFoundError
  | ValidationError
  | ContentTooLargeError
  | OfflineViolationError;
