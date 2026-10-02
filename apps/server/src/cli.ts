import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { eq } from 'drizzle-orm';
import { loadConfig, type AppConfig } from './config';
import { closeDb, getDb, openDb } from './db/client';
import { users } from './db/schema';
import { audit } from './lib/audit';
import { hashPassword, disableTotp } from './modules/auth/service';
import { createBackup, inspectBackup, restoreBackup, serverLockPid } from './modules/backup/service';
import { rebuildSearchIndex } from './modules/search/service';
import { seedDemo } from './seed/demo';
import { setRuntimeConfig } from './runtime';
import './modules';

const [, , cmd, ...args] = process.argv;
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

function open(config: AppConfig) {
  setRuntimeConfig(config);
  openDb(config.paths.dbFile);
}

function assertServerStopped() {
  const pid = serverLockPid();
  if (pid) {
    console.error(`✖ LIFE ERP is running (process ${pid}). Stop it first, or use Settings → Backups in the app.`);
    process.exit(1);
  }
}

async function ask(q: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q);
  rl.close();
  return a.trim();
}

const commands: Record<string, () => Promise<void>> = {
  async backup() {
    const config = loadConfig({ demo: flags.has('--demo') });
    open(config);
    const b = await createBackup('manual', {});
    console.log(`✔ Backup created: ${b.path} (${(b.size / 1024 / 1024).toFixed(2)} MB)`);
  },

  async restore() {
    const file = positional[0];
    if (!file) throw new Error('Usage: npm run restore -- <path-to-backup.zip> [--demo]');
    const path = resolve(file);
    if (!existsSync(path)) throw new Error(`File not found: ${path}`);
    const config = loadConfig({ demo: flags.has('--demo') });
    setRuntimeConfig(config);
    assertServerStopped();
    open(config);
    const info = await inspectBackup(path);
    if (!info.valid) throw new Error(`Backup failed verification:\n  - ${info.problems.join('\n  - ')}`);
    const m = info.manifest!;
    console.log(`\nBackup made ${m.createdAt} by LIFE ERP ${m.appVersion}${m.demo ? ' (DEMO)' : ''}`);
    console.log(`Records: ${Object.entries(m.tableCounts).filter(([, n]) => n).map(([t, n]) => `${t}=${n}`).join(', ')}`);
    console.log(`Documents: ${m.fileCount}\n`);
    console.log(`⚠ This REPLACES all current data in ${config.paths.root}.`);
    console.log('  A safety backup of the current data is taken first.\n');
    const answer = flags.has('--yes') ? 'RESTORE' : await ask('Type RESTORE to continue: ');
    const r = await restoreBackup(path, {}, answer);
    console.log(`✔ Restored. Your previous data was saved as ${r.safetyBackup}`);
  },

  async 'reset-password'() {
    const username = positional[0];
    if (!username) throw new Error('Usage: npm run cli -w @life-erp/server -- reset-password <username>');
    const config = loadConfig({ demo: flags.has('--demo') });
    open(config);
    const user = getDb().select().from(users).where(eq(users.username, username.toLowerCase())).get();
    if (!user) throw new Error(`No user "${username}"`);
    const temp = randomBytes(9).toString('base64url');
    getDb().update(users).set({ passwordHash: await hashPassword(temp) }).where(eq(users.id, user.id)).run();
    audit({}, 'auth.password_reset_cli', { type: 'user', id: user.id }, 'Password reset from the command line');
    console.log(`✔ Temporary password for ${user.username}: ${temp}\n  Sign in and change it in Settings → Security.`);
  },

  async 'disable-2fa'() {
    const username = positional[0];
    if (!username) throw new Error('Usage: npm run cli -w @life-erp/server -- disable-2fa <username>');
    const config = loadConfig({ demo: flags.has('--demo') });
    open(config);
    const user = getDb().select().from(users).where(eq(users.username, username.toLowerCase())).get();
    if (!user) throw new Error(`No user "${username}"`);
    disableTotp(user.id);
    audit({}, 'auth.totp_disable_cli', { type: 'user', id: user.id }, 'Two-factor disabled from the command line');
    console.log(`✔ Two-factor authentication disabled for ${user.username}.`);
  },

  async 'rebuild-search'() {
    const config = loadConfig({ demo: flags.has('--demo') });
    open(config);
    console.log(`✔ Search index rebuilt (${rebuildSearchIndex()} records).`);
  },

  async 'seed-demo'() {
    const config = loadConfig({ demo: true });
    open(config);
    if (getDb().select().from(users).get()) {
      console.log('Demo data already exists. Use "npm run reset-dev" to start over.');
      return;
    }
    await seedDemo();
    console.log(`✔ Demo data created in ${config.paths.root}\n  Sign in with username "demo" and password "demo-password".`);
  },

  async 'reset-dev'() {
    // Only ever touches the separate DEMO data folder — real data is never reset by a script.
    const config = loadConfig({ demo: true });
    setRuntimeConfig(config);
    assertServerStopped();
    rmSync(config.paths.db, { recursive: true, force: true });
    rmSync(config.paths.files, { recursive: true, force: true });
    const fresh = loadConfig({ demo: true });
    open(fresh);
    await seedDemo();
    console.log(`✔ Demo environment reset and re-seeded (${fresh.paths.root}).`);
  },
};

async function main() {
  const fn = commands[cmd ?? ''];
  if (!fn) {
    console.log(`LIFE ERP command line

  npm run backup                      Create a full backup now
  npm run restore -- <file.zip>       Restore a backup (server must be stopped)
  npm run seed-demo                   Create demo data (separate DEMO folder)
  npm run reset-dev                   Wipe and re-seed the DEMO folder
  npm run cli -w @life-erp/server -- reset-password <username>
  npm run cli -w @life-erp/server -- disable-2fa <username>
  npm run cli -w @life-erp/server -- rebuild-search

  Add --demo to backup/restore/reset-password to target the demo data.`);
    process.exit(cmd ? 1 : 0);
  }
  try {
    await fn();
  } catch (err) {
    console.error(`✖ ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

void main();
