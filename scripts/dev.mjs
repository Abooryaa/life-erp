// Development mode: API server (auto-restarts on change) + Vite dev server with hot reload.
// Open http://localhost:5173 — API calls are proxied to the server on port 4600.
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const run = (name, args, color) => {
  const p = spawn(isWin ? 'npm.cmd' : 'npm', args, { stdio: ['inherit', 'pipe', 'pipe'], shell: isWin, env: { ...process.env, NODE_ENV: 'development' } });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (d) =>
      String(d)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((l) => out.write(prefix + l + '\n')),
    );
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown();
  });
  return p;
};

const procs = [run('api', ['run', 'dev', '-w', '@life-erp/server'], 36), run('web', ['run', 'dev', '-w', '@life-erp/web'], 35)];

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (!p.killed) p.kill('SIGINT');
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
