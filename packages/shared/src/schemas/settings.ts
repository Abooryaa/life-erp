import { z } from 'zod';
import { currencySchema } from './common';
import { DASHBOARD_WIDGETS } from './insights';

/** Areas of your data the AI assistant can be allowed to read (each one separately). */
export const AI_SCOPES = ['finance', 'planning', 'people', 'business', 'career', 'search'] as const;
export type AiScope = (typeof AI_SCOPES)[number];
const AI_SCOPE_DEFAULTS = Object.fromEntries(AI_SCOPES.map((s) => [s, true])) as Record<AiScope, boolean>;

export const settingsSchema = z.object({
  locale: z.enum(['en', 'ar']).default('en'),
  /** Latin digits are the common choice even in Arabic UI; 'arab' uses ٠١٢٣. */
  digits: z.enum(['latn', 'arab']).default('latn'),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  timezone: z.string().min(1).max(64).default('Africa/Cairo'),
  /** 0 = Sunday … 6 = Saturday */
  weekStart: z.number().int().min(0).max(6).default(6),
  /** Day the weekly review is due (0 = Sunday … 6 = Saturday). */
  weeklyReviewDay: z.number().int().min(0).max(6).default(6),
  baseCurrency: currencySchema.default('EGP'),
  /** Command-center widgets, in order. Missing = the default set. */
  dashboard: z.array(z.enum(DASHBOARD_WIDGETS)).max(DASHBOARD_WIDGETS.length).nullable().default(null),
  dateFormat: z.enum(['dd/MM/yyyy', 'yyyy-MM-dd', 'MM/dd/yyyy']).default('dd/MM/yyyy'),
  backup: z
    .object({
      auto: z.boolean().default(true),
      /** Local time HH:mm for the nightly backup. */
      time: z.string().regex(/^\d{2}:\d{2}$/).default('02:00'),
      retention: z.number().int().min(1).max(365).default(14),
      /** Absolute folder path; null = <data dir>/backups */
      dir: z.string().max(400).nullable().default(null),
    })
    .default({ auto: true, time: '02:00', retention: 14, dir: null }),
  ai: z
    .object({
      enabled: z.boolean().default(false),
      provider: z.enum(['ollama', 'anthropic']).default('ollama'),
      ollamaUrl: z
        .string()
        .max(200)
        .regex(/^https?:\/\/[^\s/]+(:\d+)?\/?$/, 'Use a URL like http://127.0.0.1:11434')
        .default('http://127.0.0.1:11434'),
      /** Empty = not chosen yet (pick from the models installed in Ollama). */
      ollamaModel: z.string().max(100).default(''),
      anthropicModel: z.string().max(100).default('claude-sonnet-5'),
      /** Set when you confirmed that questions and the data they need are sent to Anthropic. */
      cloudConsentAt: z.string().max(40).nullable().default(null),
      /** Which parts of your data the assistant may read. */
      allow: z.object(Object.fromEntries(AI_SCOPES.map((s) => [s, z.boolean().default(true)])) as Record<AiScope, z.ZodDefault<z.ZodBoolean>>).default(AI_SCOPE_DEFAULTS),
    })
    .default({
      enabled: false,
      provider: 'ollama',
      ollamaUrl: 'http://127.0.0.1:11434',
      ollamaModel: '',
      anthropicModel: 'claude-sonnet-5',
      cloudConsentAt: null,
      allow: AI_SCOPE_DEFAULTS,
    }),
});

export type Settings = z.infer<typeof settingsSchema>;
export const settingsPatchSchema = settingsSchema.partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
