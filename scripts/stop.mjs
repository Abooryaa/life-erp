// Stops a running LIFE ERP server for this data folder (uses the PID in config/server.lock).
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const demo = process.argv.includes('--demo');
const envFile = join(import.meta.dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const root = (demo ? process.env.LIFE_ERP_DEMO_DIR : process.env.LIFE_ERP_DATA_DIR) ?? join(homedir(), demo ? 'LifeERP-Demo' : 'LifeERP-Data');
const lock = join(root, 'config', 'server.lock');

if (!existsSync(lock)) {
  console.log('LIFE ERP is not running (no lock file).');
  process.exit(0);
}
const pid = Number(readFileSync(lock, 'utf8'));
try {
  process.kill(pid, 0);
} catch {
  rmSync(lock, { force: true });
  console.log('LIFE ERP was not running (removed a stale lock file).');
  process.exit(0);
}
// SIGTERM lets the server close the database cleanly; on Windows Node maps it to a hard stop,
// which SQLite (WAL mode) also survives safely.
process.kill(pid, 'SIGTERM');
console.log(`Stopped LIFE ERP (process ${pid}).`);
