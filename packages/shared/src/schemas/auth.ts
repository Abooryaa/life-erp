import { z } from 'zod';
import { requiredText } from './common';

export const PASSWORD_MIN = 10;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(256, 'Too long')
  .refine((p) => new Set(p).size >= 5, 'Too repetitive — use a mix of characters');

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'At least 3 characters')
  .max(40)
  .regex(/^[a-z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only');

export const setupSchema = z
  .object({
    fullName: requiredText(120),
    username: usernameSchema,
    email: z.string().trim().toLowerCase().email('Not a valid email').max(200),
    password: passwordSchema,
    confirmPassword: z.string(),
    locale: z.enum(['en', 'ar']).default('en'),
    baseCurrency: z.string().length(3).default('EGP'),
    businesses: z.array(requiredText(80)).max(20).default([]),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((v) => !v.password.toLowerCase().includes(v.username), {
    path: ['password'],
    message: 'Password must not contain your username',
  });
export type SetupInput = z.input<typeof setupSchema>;

export const loginSchema = z.object({
  identifier: z.string().trim().toLowerCase().min(1, 'Required').max(200),
  password: z.string().min(1, 'Required').max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^(\d{6}|[a-z0-9]{4}-[a-z0-9]{4})$/i, 'Enter the 6-digit code or a recovery code');

export const loginTotpSchema = z.object({
  challenge: z.string().min(20).max(200),
  code: totpCodeSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'New password must be different',
  });

export const enableTotpSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const disableTotpSchema = z.object({ password: z.string().min(1, 'Required'), code: totpCodeSchema });

export const updateProfileSchema = z.object({
  fullName: requiredText(120),
  email: z.string().trim().toLowerCase().email('Not a valid email').max(200),
});
