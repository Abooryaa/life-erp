import { z } from 'zod';
import { DOCUMENT_TYPES } from '../entities';
import {
  colorSchema,
  currencySchema,
  entityRefSchema,
  idSchema,
  isoDateSchema,
  optionalText,
  requiredText,
} from './common';

export const WORKSPACE_KINDS = ['personal', 'business'] as const;

export const workspaceSchema = z.object({
  name: requiredText(80),
  kind: z.enum(WORKSPACE_KINDS).default('business'),
  description: optionalText(2000),
  industry: optionalText(120),
  color: colorSchema.default('#4f46e5'),
  currency: currencySchema.default('EGP'),
  website: optionalText(300),
  notes: optionalText(10000),
});
export type WorkspaceInput = z.input<typeof workspaceSchema>;

export const tagNameSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-'))
  .pipe(
    z
      .string()
      .min(1, 'Required')
      .max(40)
      .regex(/^[\p{L}\p{N}_-]+$/u, 'Letters, numbers, dash and underscore only'),
  );

export const tagSchema = z.object({
  name: tagNameSchema,
  color: colorSchema.optional(),
});

export const setTagsSchema = z.object({
  entity: entityRefSchema,
  tags: z.array(tagNameSchema).max(30),
});

export const linkSchema = z.object({
  from: entityRefSchema,
  to: entityRefSchema,
  relation: z.string().trim().max(40).default('related'),
  note: optionalText(500),
});

export const documentMetaSchema = z.object({
  title: requiredText(200),
  description: optionalText(4000),
  docType: z.enum(DOCUMENT_TYPES).default('other'),
  workspaceId: idSchema.nullable().optional(),
  documentDate: isoDateSchema.nullable().optional(),
  expiresOn: isoDateSchema.nullable().optional(),
  tags: z.array(z.string()).max(30).optional(),
});
export type DocumentMeta = z.input<typeof documentMetaSchema>;
