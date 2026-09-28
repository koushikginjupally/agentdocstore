/**
 * Typed core errors. Each carries a discriminant `name` (for `switch (e.name)`)
 * and a stable machine `code`.
 *
 * `instanceof` works across copies of this package. A third-party provider
 * imports @agentdocstore/core itself, and under npx or a global install that is
 * not the copy the CLI loads, so its classes are different objects. Each error
 * therefore carries a mark under a registered symbol, which every copy in the
 * process shares, and each class's `instanceof` also accepts an error with its
 * mark from another copy. The fields are read the same way from either copy, so
 * changing a field is a breaking change for providers built against another
 * version of core.
 */

export type ErrorCode =
  'VERSION_CONFLICT' | 'NOT_FOUND' | 'VALIDATION' | 'CONTENT_TOO_LARGE' | 'OFFLINE_VIOLATION';

/** The mark's key. `Symbol.for` returns the same symbol to every copy of core. */
const CORE_ERROR = Symbol.for('agentdocstore.core-error');

/**
 * Finish constructing a core error: its name, the prototype of the class
 * actually constructed (so a subclass keeps its own), and the mark.
 */
function initCoreError(error: Error, prototype: object, name: string, code: ErrorCode): void {
  error.name = name;
  Object.setPrototypeOf(error, prototype);
  Object.defineProperty(error, CORE_ERROR, { value: code });
}

/**
 * `instanceof` for a core error class: the prototype chain as usual or, for
 * the core class itself (not a subclass), the mark set by any copy of core.
 */
function isCoreError(
  cls: { prototype: object },
  coreClass: object,
  code: ErrorCode,
  value: unknown,
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (Object.prototype.isPrototypeOf.call(cls.prototype, value)) return true;
  return cls === coreClass && (value as Record<symbol, unknown>)[CORE_ERROR] === code;
}

/** Raised by CAS `appendVersion` when `expect.latestVersion` is stale. */
export class VersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT' as const;
  constructor(
    message = 'Version conflict',
    readonly expected?: number,
    readonly actual?: number,
  ) {
    super(message);
    initCoreError(this, new.target.prototype, 'VersionConflictError', this.code);
  }

  static [Symbol.hasInstance](value: unknown): value is VersionConflictError {
    return isCoreError(this, VersionConflictError, 'VERSION_CONFLICT', value);
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
    initCoreError(this, new.target.prototype, 'NotFoundError', this.code);
  }

  static [Symbol.hasInstance](value: unknown): value is NotFoundError {
    return isCoreError(this, NotFoundError, 'NOT_FOUND', value);
  }
}

/** Raised on invalid input (bad language, empty title, oversized field, ...). */
export class ValidationError extends Error {
  readonly code = 'VALIDATION' as const;
  constructor(message = 'Validation failed') {
    super(message);
    initCoreError(this, new.target.prototype, 'ValidationError', this.code);
  }

  static [Symbol.hasInstance](value: unknown): value is ValidationError {
    return isCoreError(this, ValidationError, 'VALIDATION', value);
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
    initCoreError(this, new.target.prototype, 'ContentTooLargeError', this.code);
  }

  static [Symbol.hasInstance](value: unknown): value is ContentTooLargeError {
    return isCoreError(this, ContentTooLargeError, 'CONTENT_TOO_LARGE', value);
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
    initCoreError(this, new.target.prototype, 'OfflineViolationError', this.code);
  }

  static [Symbol.hasInstance](value: unknown): value is OfflineViolationError {
    return isCoreError(this, OfflineViolationError, 'OFFLINE_VIOLATION', value);
  }
}

/** Any core error carrying a known {@link ErrorCode}. */
export type AgentDocStoreError =
  | VersionConflictError
  | NotFoundError
  | ValidationError
  | ContentTooLargeError
  | OfflineViolationError;
