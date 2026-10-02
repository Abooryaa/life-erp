/**
 * Every record type that can participate in cross-module features
 * (tags, links, attachments, search, audit log, notifications).
 * Adding a module = adding its type here; the generic tables never change.
 */
export const ENTITY_TYPES = [
  'workspace',
  'document',
  'note',
  'task',
  'project',
  'milestone',
  'event',
  'goal',
  'person',
  'organization',
  'interaction',
  'opportunity',
  'account',
  'transaction',
  'category',
  'budget',
  'recurring',
  'installment',
  'debt',
  'savings_goal',
  'asset',
  'employment',
  'job_application',
  'achievement',
  'skill',
  'learning',
  'review',
  'scenario',
  'user',
  'settings',
  'backup',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const NOTIFICATION_SEVERITIES = ['critical', 'warning', 'reminder', 'info'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const DOCUMENT_TYPES = [
  'cv',
  'contract',
  'invoice',
  'receipt',
  'proposal',
  'certificate',
  'id',
  'employment_letter',
  'boq',
  'statement',
  'photo',
  'project_file',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
