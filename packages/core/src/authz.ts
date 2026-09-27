/**
 * Authorization helper.
 *
 * Enforces the single access rule that governs every doc-scoped surface
 * (read, raw, update/write, delete, comments):
 *
 *   - PUBLIC documents are readable / commentable by anyone (including anonymous).
 *   - PRIVATE documents are owner-only for ALL surfaces.
 *   - Mutation (write / delete) is owner-only regardless of visibility.
 *
 * Denials throw {@link NotFoundError}, never a "forbidden" error: a non-owner
 * must not be able to distinguish "exists but you can't touch it" from "does
 * not exist", so a PRIVATE doc's existence is never disclosed. (There is also
 * no dedicated Forbidden error in the core taxonomy by design.) The denial
 * message never contains the owner's identity.
 */

import type { Visibility } from './model/document.js';
import { NotFoundError } from './errors.js';

/** The caller's identity. `null`/`undefined`/`''` == unauthenticated / anonymous. */
export type Viewer = string | null | undefined;

/** The minimal doc projection authorization decisions depend on. */
export interface AccessTarget {
  readonly id: string;
  readonly visibility: Visibility;
  readonly createdBy: string;
}

/** True when `viewer` is the authenticated creator of `doc`. */
export function isOwner(doc: AccessTarget, viewer: Viewer): boolean {
  return typeof viewer === 'string' && viewer.length > 0 && doc.createdBy === viewer;
}

/** True when `viewer` may view `doc` (and its raw content / comments). */
export function canRead(doc: AccessTarget, viewer: Viewer): boolean {
  return doc.visibility === 'PUBLIC' || isOwner(doc, viewer);
}

/** True when `viewer` may update `doc` (owner-only, any visibility). */
export function canWrite(doc: AccessTarget, viewer: Viewer): boolean {
  return isOwner(doc, viewer);
}

/** True when `viewer` may delete `doc` (owner-only, any visibility). */
export function canDelete(doc: AccessTarget, viewer: Viewer): boolean {
  return isOwner(doc, viewer);
}

/** True when `viewer` may post/read comments on `doc` (same gate as read). */
export function canComment(doc: AccessTarget, viewer: Viewer): boolean {
  return canRead(doc, viewer);
}

/**
 * True when `viewer` may delete a comment on `doc`: its author or the document
 * owner, and only while they can still read the document. Anyone who can read
 * a PUBLIC document may comment on it, so without this rule any reader could
 * erase anyone else's feedback.
 */
export function canDeleteComment(
  doc: AccessTarget,
  comment: { readonly author: string },
  viewer: Viewer,
): boolean {
  if (!canComment(doc, viewer)) return false;
  if (isOwner(doc, viewer)) return true;
  return typeof viewer === 'string' && viewer.length > 0 && comment.author === viewer;
}

/**
 * True when `doc` has an `expiresAt` at or before `now`.
 *
 * Expiry is enforced at read time with this check: the background sweep (or a
 * store's native TTL) only reclaims storage, and may run minutes later — or,
 * for the stdio MCP server, not at all. An expired document must behave as
 * deleted from the moment it expires.
 */
export function isExpired(doc: { readonly expiresAt?: string }, now: Date = new Date()): boolean {
  return doc.expiresAt !== undefined && Date.parse(doc.expiresAt) <= now.getTime();
}

/**
 * Uniform denial: throw NotFound with a message that reveals neither the
 * owner nor whether the doc merely exists.
 */
function deny(doc: AccessTarget): never {
  throw new NotFoundError(`Document '${doc.id}' not found`);
}

/** Assert `viewer` may read `doc`, else throw {@link NotFoundError}. */
export function assertCanRead(doc: AccessTarget, viewer: Viewer): void {
  if (!canRead(doc, viewer)) deny(doc);
}

/** Assert `viewer` may read `doc`'s raw content (`/raw` is read-gated). */
export function assertCanReadRaw(doc: AccessTarget, viewer: Viewer): void {
  if (!canRead(doc, viewer)) deny(doc);
}

/** Assert `viewer` may update `doc` (owner-only), else throw {@link NotFoundError}. */
export function assertCanWrite(doc: AccessTarget, viewer: Viewer): void {
  if (!canWrite(doc, viewer)) deny(doc);
}

/** Assert `viewer` may delete `doc` (owner-only), else throw {@link NotFoundError}. */
export function assertCanDelete(doc: AccessTarget, viewer: Viewer): void {
  if (!canDelete(doc, viewer)) deny(doc);
}

/** Assert `viewer` may comment on `doc` (same gate as read), else throw {@link NotFoundError}. */
export function assertCanComment(doc: AccessTarget, viewer: Viewer): void {
  if (!canComment(doc, viewer)) deny(doc);
}

/**
 * Assert `viewer` may delete `comment` on `doc`. A viewer who cannot read the
 * document gets the document denial; one who can read it but neither wrote the
 * comment nor owns the document gets "comment not found", matching how every
 * other denial is shaped.
 */
export function assertCanDeleteComment(
  doc: AccessTarget,
  comment: { readonly id: string; readonly author: string },
  viewer: Viewer,
): void {
  assertCanComment(doc, viewer);
  if (!canDeleteComment(doc, comment, viewer)) {
    throw new NotFoundError(`Comment '${comment.id}' not found`);
  }
}
