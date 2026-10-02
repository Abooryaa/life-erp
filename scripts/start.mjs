// Production / home-server mode: builds once if needed, then runs the optimized server.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const isWin = process.platform === 'win32';

const built = existsSync(join(root, 'apps', 'server', 'dist', 'index.js')) && existsSync(join(root, 'apps', 'web', 'dist', 'index.html'));
if (!built || process.argv.includes('--rebuild')) {
  console.log('Building LIFE ERP (one time)…');
  const b = spawnSync(isWin ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: isWin });
  if (b.status !== 0) {
    console.error('✖ Build failed — see the messages above.');
    process.exit(b.status ?? 1);
  }
}
const p = spawn(process.execPath, ['--enable-source-maps', 'dist/index.js'], {
  cwd: join(root, 'apps', 'server'),
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});
p.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => p.kill(sig));
