import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from './paths';

export interface DataPaths {
  root: string;
  db: string;
  dbFile: string;
  files: string;
  backups: string;
  config: string;
  logs: string;
  tmp: string;
}

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  demo: boolean;
  port: number;
  host: string;
  /** Allow requests from LAN devices (true = listen on all interfaces). */
  lan: boolean;
  paths: DataPaths;
  secrets: { instanceId: string };
  maxUploadBytes: number;
  sessionDays: number;
}

let envLoaded = false;
function loadDotEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const file = join(REPO_ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function dataPathsFor(root: string): DataPaths {
  const r = resolve(root);
  return {
    root: r,
    db: join(r, 'db'),
    dbFile: join(r, 'db', 'life.sqlite'),
    files: join(r, 'files'),
    backups: join(r, 'backups'),
    config: join(r, 'config'),
    logs: join(r, 'logs'),
    tmp: join(r, 'tmp'),
  };
}

export function ensureDataDirs(paths: DataPaths) {
  for (const dir of [paths.root, paths.db, paths.files, paths.backups, paths.config, paths.logs, paths.tmp]) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadSecrets(paths: DataPaths): AppConfig['secrets'] {
  const file = join(paths.config, 'secrets.json');
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const secrets = { instanceId: randomBytes(16).toString('hex') };
  writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}

export function loadConfig(overrides: Partial<Pick<AppConfig, 'env' | 'demo' | 'port'>> & { dataDir?: string } = {}): AppConfig {
  loadDotEnv();
  const env = overrides.env ?? ((process.env.NODE_ENV as AppConfig['env']) || 'development');
  const demo = overrides.demo ?? process.env.LIFE_ERP_DEMO === '1';
  const defaultRoot = join(homedir(), demo ? 'LifeERP-Demo' : 'LifeERP-Data');
  const root =
    overrides.dataDir ?? (demo ? process.env.LIFE_ERP_DEMO_DIR : process.env.LIFE_ERP_DATA_DIR) ?? defaultRoot;
  const paths = dataPathsFor(root);
  ensureDataDirs(paths);
  const lan = (process.env.LIFE_ERP_LAN ?? '1') !== '0';
  return {
    env,
    demo,
    port: overrides.port ?? Number(process.env.PORT ?? (demo ? 4610 : 4600)),
    host: process.env.HOST ?? (lan ? '0.0.0.0' : '127.0.0.1'),
    lan,
    paths,
    secrets: loadSecrets(paths),
    maxUploadBytes: Number(process.env.LIFE_ERP_MAX_UPLOAD_MB ?? 100) * 1024 * 1024,
    sessionDays: Number(process.env.LIFE_ERP_SESSION_DAYS ?? 30),
  };
}
