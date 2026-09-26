import type { Comment } from '../model/comment.js';

/** Input to add a comment. */
export interface AddCommentInput {
  readonly author: string;
  readonly body: string;
}

/** Storage of per-doc comments. */
export interface CommentStore {
  add(documentId: string, input: AddCommentInput): Promise<Comment>;
  list(documentId: string): Promise<readonly Comment[]>;
  setResolved(documentId: string, commentId: string, resolved: boolean): Promise<Comment>;
  delete(documentId: string, commentId: string): Promise<void>;
}
