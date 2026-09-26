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
