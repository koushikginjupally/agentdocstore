/**
 * Zod schemas for request body validation. Each schema enforces types and
 * constraints; domain-level validation (size limits, language enum) is
 * additionally checked by the route handlers using core LIMITS.
 */

import { z } from 'zod';
import { LANGUAGES } from '@agentdocstore/core';

const languageEnum = z.enum(LANGUAGES as unknown as [string, ...string[]]);

export const CreateDocumentSchema = z.object({
  title: z.string().min(1),
  content: z.string(),
  language: languageEnum.optional().default('plaintext'),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  expiresInDays: z.number().int().positive().optional(),
  redactionPolicy: z.enum(['redact', 'skip']).optional(),
});
export type CreateDocumentBody = z.infer<typeof CreateDocumentSchema>;

export const UpdateDocumentSchema = z.object({
  content: z.string().optional(),
  title: z.string().min(1).optional(),
  language: languageEnum.optional(),
  editMessage: z.string().optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  expiresInDays: z.number().int().positive().nullish(),
  redactionPolicy: z.enum(['redact', 'skip']).optional(),
});
export type UpdateDocumentBody = z.infer<typeof UpdateDocumentSchema>;

export const CreateCommentSchema = z.object({
  body: z.string().min(1),
});

export const PatchCommentSchema = z.object({
  resolved: z.boolean(),
});

export const SetVisibilitySchema = z.object({
  visibility: z.enum(['PUBLIC', 'PRIVATE']),
});

export const ScanSchema = z.object({
  content: z.string(),
});
