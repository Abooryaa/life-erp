import { getDb } from '../db/client';
import { appMeta, users } from '../db/schema';
import { newId } from '../lib/ids';
import { hashPassword } from '../modules/auth/service';
import { saveSettings } from '../modules/settings/service';
import { createTag } from '../modules/tags/service';
import { createWorkspace } from '../modules/workspaces/service';
import { getConfig } from '../runtime';

/**
 * Demo data lives ONLY in the separate demo data folder (LifeERP-Demo), so it can
 * never mix with real records. Every module adds its sample records here.
 */
export async function seedDemo() {
  if (!getConfig().demo) throw new Error('Refusing to seed demo data into the real data folder');
  const db = getDb();
  const userId = newId();
  db.insert(users)
    .values({ id: userId, username: 'demo', email: 'demo@example.com', fullName: 'Demo User', passwordHash: await hashPassword('demo-password') })
    .run();
  db.insert(appMeta).values({ key: 'demo', value: 'true' }).onConflictDoNothing().run();
  const ctx = { userId };
  saveSettings(ctx, { locale: 'en', baseCurrency: 'EGP' });
  const personal = createWorkspace(ctx, { name: 'Personal', kind: 'personal', color: '#0f766e' });
  const mma = createWorkspace(ctx, {
    name: 'MMA Spaces',
    kind: 'business',
    industry: 'Interior finishing & design',
    description: 'Residential and commercial interior finishing: design, BOQs, procurement and execution.',
    color: '#b45309',
  });
  const basira = createWorkspace(ctx, {
    name: 'Basira',
    kind: 'business',
    industry: 'Data analytics SaaS',
    description: 'Analytics and forecasting for clothing manufacturers.',
    color: '#4f46e5',
  });
  for (const name of ['urgent', 'followup', 'finance', 'career', 'mma', 'basira', '2026']) createTag(ctx, { name });
  return { userId, personal, mma, basira };
}
