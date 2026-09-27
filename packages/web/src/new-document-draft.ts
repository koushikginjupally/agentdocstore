/**
 * "Make a Copy": a document page hands the create form a document to start
 * from. The hand-off lives in memory only, for the next time the form is
 * shown, so nothing about the copy is stored until the user creates it.
 */
import { MAX_TITLE_BYTES, utf8Bytes } from './constants.js';

/** What the create form starts from. */
export interface NewDocumentDraft {
  readonly title: string;
  readonly language: string;
  readonly visibility: 'PUBLIC' | 'PRIVATE';
  readonly content: string;
}

let offered: NewDocumentDraft | null = null;

/** Hand a draft to the next render of the create form. */
export function offerNewDocumentDraft(draft: NewDocumentDraft): void {
  offered = draft;
}

/** The draft offered to the create form, if any. Taking it clears it. */
export function takeNewDocumentDraft(): NewDocumentDraft | null {
  const draft = offered;
  offered = null;
  return draft;
}

/**
 * "Copy of <title>", or the title unchanged when the prefix would take it
 * past the server's title limit (which would reject the copy on create).
 */
export function copyTitle(title: string): string {
  const copy = `Copy of ${title}`;
  return utf8Bytes(copy) <= MAX_TITLE_BYTES ? copy : title;
}
