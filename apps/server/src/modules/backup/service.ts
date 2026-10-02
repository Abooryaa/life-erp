import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { desc, eq } from 'drizzle-orm';
import { closeDb, getDb, getSqlite, openDb } from '../../db/client';
import { backups } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { extractZip, readZipEntry, sha256File, walkZip, writeZip, type ZipInput } from '../../lib/zip';
import { getConfig } from '../../runtime';
import { notify } from '../notifications/service';
import { rebuildSearchIndex } from '../search/service';
import { getSettings } from '../settings/service';
import pkg from '../../../package.json';

export const BACKUP_FORMAT = 'life-erp-backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupManifest {
  format: string;
  formatVersion: number;
  appVersion: string;
  createdAt: string;
  kind: 'manual' | 'auto' | 'safety';
  demo: boolean;
  migrations: number;
  tableCounts: Record<string, number>;
  fileCount: number;
  entries: { path: string; size: number; sha256: string }[];
}

export function backupDir(): string {
  const dir = getSettings().backup.dir || getConfig().paths.backups;
  return resolve(dir);
}

function ensureWritable(dir: string) {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
  } catch (err) {
    throw new AppError(500, 'backup_dir', `Backup folder "${dir}" is not writable: ${(err as Error).message}`);
  }
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

export function tableCounts(sqlite: Database.Database = getSqlite()): Record<string, number> {
  const tables = sqlite
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE 'search_index%' AND name NOT LIKE '__drizzle%' ORDER BY name`,
    )
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map((t) => [t.name, (sqlite.prepare(`SELECT count(*) AS n FROM "${t.name}"`).get() as { n: number }).n]),
  );
}

function migrationCount(sqlite: Database.Database): number {
  try {
    return (sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
  } catch {
    return 0;
  }
}

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Create a complete, portable backup: database + all files + config + manifest with checksums. */
export async function createBackup(kind: 'manual' | 'auto' | 'safety', ctx: AuditContext = {}) {
  const cfg = getConfig();
  const id = newId();
  const dir = backupDir();
  const snapshot = join(cfg.paths.tmp, `snapshot-${id}.sqlite`);
  const name = `life-erp-${cfg.demo ? 'DEMO-' : ''}backup-${stamp()}${kind === 'manual' ? '' : `-${kind}`}.zip`;
  const out = join(dir, name);
  try {
    ensureWritable(dir);
    const sqlite = getSqlite();
    // VACUUM INTO writes a consistent, compacted snapshot while the app keeps running.
    sqlite.prepare('VACUUM INTO ?').run(snapshot);

    const fileList = walkFiles(cfg.paths.files);
    const configFiles = walkFiles(cfg.paths.config).filter((f) => !f.endsWith('.lock'));
    const entries: ZipInput[] = [
      { name: 'db/life.sqlite', file: snapshot },
      ...fileList.map((f) => ({ name: `files/${relative(cfg.paths.files, f).replace(/\\/g, '/')}`, file: f })),
      ...configFiles.map((f) => ({ name: `config/${relative(cfg.paths.config, f).replace(/\\/g, '/')}`, file: f })),
    ];
    const manifestEntries = [];
    for (const e of entries) manifestEntries.push({ path: e.name, size: statSync(e.file!).size, sha256: await sha256File(e.file!) });

    const snap = new Database(snapshot, { readonly: true });
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: pkg.version,
      createdAt: new Date().toISOString(),
      kind,
      demo: cfg.demo,
      migrations: migrationCount(snap),
      tableCounts: tableCounts(snap),
      fileCount: fileList.length,
      entries: manifestEntries,
    };
    snap.close();
    entries.unshift({ name: 'manifest.json', buffer: Buffer.from(JSON.stringify(manifest, null, 2)) });
    entries.push({ name: 'README.txt', buffer: Buffer.from(README) });

    await writeZip(`${out}.partial`, entries);
    renameSync(`${out}.partial`, out);
    const size = statSync(out).size;
    getDb()
      .insert(backups)
      .values({ id, kind, status: 'ok', path: out, size, manifest: JSON.stringify({ ...manifest, entries: undefined }) })
      .run();
    audit(ctx, 'backup.create', { type: 'backup', id }, `${kind} backup created: ${name} (${size} bytes)`);
    if (kind === 'auto') applyRetention();
    return { id, path: out, name, size, manifest };
  } catch (err) {
    rmSync(`${out}.partial`, { force: true });
    const message = err instanceof AppError ? err.message : `Backup failed: ${(err as Error).message}`;
    try {
      getDb().insert(backups).values({ id, kind, status: 'failed', path: out, error: message }).run();
      notify({ severity: 'critical', title: 'Backup failed', body: message, link: '/settings/backups' });
    } catch {
      /* database may be the problem — the error below still reaches the user */
    }
    throw err instanceof AppError ? err : new AppError(500, 'backup_failed', message);
  } finally {
    rmSync(snapshot, { force: true });
  }
}

/** Keep only the newest N automatic backups (manual and safety backups are never auto-deleted). */
export function applyRetention() {
  const keep = getSettings().backup.retention;
  const autos = getDb().select().from(backups).where(eq(backups.kind, 'auto')).orderBy(desc(backups.createdAt)).all();
  for (const b of autos.filter((b) => b.status === 'ok').slice(keep)) {
    if (b.path) rmSync(b.path, { force: true });
    getDb().delete(backups).where(eq(backups.id, b.id)).run();
  }
}

/** Backups on disk in the backup folder, merged with the history recorded in the database. */
export function listBackups() {
  const dir = backupDir();
  const records = getDb().select().from(backups).orderBy(desc(backups.createdAt)).limit(200).all();
  const onDisk = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.zip')) : [];
  const known = new Set(records.map((r) => r.path && basename(r.path)));
  const items = records.map((r) => ({
    id: r.id,
    name: r.path ? basename(r.path) : null,
    kind: r.kind,
    status: r.status,
    createdAt: r.createdAt,
    size: r.size,
    error: r.error,
    exists: !!r.path && existsSync(r.path),
  }));
  for (const f of onDisk) {
    if (known.has(f)) continue;
    const st = statSync(join(dir, f));
    items.push({ id: `file:${f}`, name: f, kind: 'manual', status: 'ok', createdAt: st.mtime.toISOString(), size: st.size, error: null, exists: true });
  }
  return { dir, items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}

/** Resolve a backup by file name inside the backup folder (never an arbitrary path from a request). */
export function backupPathByName(name: string) {
  if (!/^[\w.-]+\.zip$/.test(name)) throw badRequest('Invalid backup name');
  const p = join(backupDir(), name);
  if (!existsSync(p)) throw new AppError(404, 'not_found', 'Backup file not found');
  return p;
}

export function deleteBackupFile(ctx: AuditContext, name: string) {
  const p = backupPathByName(name);
  rmSync(p, { force: true });
  getDb().delete(backups).where(eq(backups.path, p)).run();
  audit(ctx, 'backup.delete', null, `Deleted backup ${name}`);
}

export interface InspectResult {
  valid: boolean;
  problems: string[];
  manifest: Omit<BackupManifest, 'entries'> | null;
  size: number;
}

/** Read and fully verify a backup archive without changing anything. */
export async function inspectBackup(path: string): Promise<InspectResult> {
  const problems: string[] = [];
  const size = statSync(path).size;
  let manifest: BackupManifest | null = null;
  try {
    const buf = await readZipEntry(path, 'manifest.json');
    if (!buf) return { valid: false, problems: ['This file is not a LIFE ERP backup (manifest.json missing).'], manifest: null, size };
    manifest = JSON.parse(buf.toString('utf8')) as BackupManifest;
  } catch (err) {
    return { valid: false, problems: [`The archive could not be read: ${(err as Error).message}`], manifest: null, size };
  }
  if (manifest.format !== BACKUP_FORMAT) problems.push('Unknown backup format.');
  if (manifest.formatVersion > BACKUP_FORMAT_VERSION) problems.push('This backup was made by a newer version of LIFE ERP. Update the app first.');
  const expected = new Map(manifest.entries.map((e) => [e.path, e.sha256]));
  const seen = new Set<string>();
  try {
    await walkZip(path, async (name, stream) => {
      if (name === 'manifest.json' || name === 'README.txt') {
        stream.resume();
        await new Promise((r) => stream.on('end', r));
        return;
      }
      const h = createHash('sha256');
      for await (const c of stream) h.update(c as Buffer);
      const want = expected.get(name);
      if (!want) problems.push(`Unexpected file in backup: ${name}`);
      else if (want !== h.digest('hex')) problems.push(`Checksum mismatch (file damaged): ${name}`);
      seen.add(name);
    });
  } catch (err) {
    problems.push(`The archive is damaged: ${(err as Error).message}`);
  }
  for (const p of expected.keys()) if (!seen.has(p)) problems.push(`Missing from backup: ${p}`);
  if (!expected.has('db/life.sqlite')) problems.push('The backup has no database.');
  const { entries: _e, ...summary } = manifest;
  return { valid: problems.length === 0, problems, manifest: summary, size };
}

function renameRetry(from: string, to: string) {
  for (let i = 0; ; i++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      if (i >= 10) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); // Windows may briefly hold file handles
    }
  }
}

/**
 * Replace all current data with a backup. A safety backup of the current state is
 * always taken first, and the swap is rolled back if the restored data can't be opened.
 */
export async function restoreBackup(path: string, ctx: AuditContext, confirm: string) {
  if (confirm !== 'RESTORE') throw badRequest('Type RESTORE to confirm. This replaces all current data.', 'confirm_required');
  const cfg = getConfig();
  const info = await inspectBackup(path);
  if (!info.valid) throw new AppError(400, 'invalid_backup', `Backup failed verification: ${info.problems.slice(0, 3).join(' ')}`);
  if (info.manifest!.demo !== cfg.demo) {
    throw new AppError(
      400,
      'demo_mismatch',
      info.manifest!.demo
        ? 'This is a DEMO backup. It cannot be restored into your real data.'
        : 'This is a real-data backup. It cannot be restored into the demo environment.',
    );
  }

  const safety = await createBackup('safety', ctx);
  const id = newId();
  const stage = join(cfg.paths.tmp, `restore-${id}`);
  const old = join(cfg.paths.tmp, `pre-restore-${id}`);
  try {
    await extractZip(path, stage);
    const test = new Database(join(stage, 'db', 'life.sqlite'));
    const check = test.pragma('quick_check', { simple: true });
    test.close();
    if (check !== 'ok') throw new Error(`restored database failed integrity check (${String(check)})`);
    mkdirSync(join(stage, 'files'), { recursive: true });
  } catch (err) {
    rmSync(stage, { recursive: true, force: true });
    throw new AppError(500, 'restore_failed', `Restore aborted before changing anything: ${(err as Error).message}`);
  }

  closeDb();
  mkdirSync(old, { recursive: true });
  try {
    renameRetry(cfg.paths.db, join(old, 'db'));
    renameRetry(cfg.paths.files, join(old, 'files'));
    renameRetry(join(stage, 'db'), cfg.paths.db);
    renameRetry(join(stage, 'files'), cfg.paths.files);
    openDb(cfg.paths.dbFile);
  } catch (err) {
    // Roll back to exactly what was there before.
    closeDb();
    rmSync(cfg.paths.db, { recursive: true, force: true });
    rmSync(cfg.paths.files, { recursive: true, force: true });
    if (existsSync(join(old, 'db'))) renameRetry(join(old, 'db'), cfg.paths.db);
    if (existsSync(join(old, 'files'))) renameRetry(join(old, 'files'), cfg.paths.files);
    mkdirSync(cfg.paths.files, { recursive: true });
    openDb(cfg.paths.dbFile);
    rmSync(stage, { recursive: true, force: true });
    throw new AppError(500, 'restore_failed', `Restore failed and your previous data was put back: ${(err as Error).message}`);
  }
  rmSync(stage, { recursive: true, force: true });
  rmSync(old, { recursive: true, force: true });
  rebuildSearchIndex();
  audit(ctx, 'backup.restore', null, `Restored backup ${basename(path)} (made ${info.manifest!.createdAt}). Safety backup: ${safety.name}`);
  notify({ severity: 'info', title: 'Backup restored', body: `Restored ${basename(path)}. Your previous data was saved as ${safety.name}.` });
  return { restoredFrom: basename(path), safetyBackup: safety.name, manifest: info.manifest };
}

const README = `LIFE ERP backup
================
This archive contains a complete copy of your LIFE ERP data:

  manifest.json   what is inside + SHA-256 checksums of every file
  db/life.sqlite  the database (standard SQLite — readable with any SQLite tool)
  files/          all uploaded documents (stored by content hash)
  config/         instance configuration

To restore: LIFE ERP → Settings → Backups → Restore, or run "npm run restore -- <file.zip>".
`;

export function writeServerLock() {
  const cfg = getConfig();
  writeFileSync(join(cfg.paths.config, 'server.lock'), String(process.pid));
}

export function serverLockPid(): number | null {
  const f = join(getConfig().paths.config, 'server.lock');
  if (!existsSync(f)) return null;
  const pid = Number(readFileSync(f, 'utf8'));
  try {
    process.kill(pid, 0);
    return pid === process.pid ? null : pid;
  } catch {
    return null;
  }
}
