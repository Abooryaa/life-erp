// Runs LIFE ERP with the separate DEMO data folder (creates sample data on first run).
// Real data is never touched.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const env = { ...process.env, LIFE_ERP_DEMO: '1', NODE_ENV: 'production' };

if (!existsSync(join(root, 'apps', 'server', 'dist', 'index.js')) || !existsSync(join(root, 'apps', 'web', 'dist', 'index.html'))) {
  console.log('Building LIFE ERP first…');
  const b = spawnSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit', shell: isWin });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
spawnSync(process.execPath, ['dist/cli.js', 'seed-demo'], { cwd: join(root, 'apps', 'server'), stdio: 'inherit', env });
const p = spawn(process.execPath, ['--enable-source-maps', 'dist/index.js'], { cwd: join(root, 'apps', 'server'), stdio: 'inherit', env });
p.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => p.kill('SIGINT'));
