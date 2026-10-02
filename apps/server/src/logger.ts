import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';

const MAX_LOG_BYTES = 10 * 1024 * 1024;

/** Logs go to the console and to <data>/logs/server.log (rotated at 10 MB, 3 generations kept). */
export function createLogger(logsDir: string, level = 'info') {
  const file = join(logsDir, 'server.log');
  if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
    rmSync(`${file}.3`, { force: true });
    for (const n of [2, 1]) if (existsSync(`${file}.${n}`)) renameSync(`${file}.${n}`, `${file}.${n + 1}`);
    renameSync(file, `${file}.1`);
  }
  return pino(
    {
      level,
      redact: { paths: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.newPassword', '*.currentPassword'], remove: true },
      serializers: {
        req: (r) => ({ method: r.method, url: r.url, ip: r.ip }),
        res: (r) => ({ statusCode: r.statusCode }),
      },
    },
    pino.multistream([{ stream: process.stdout }, { stream: pino.destination({ dest: file, mkdir: true, sync: true }) }]),
  );
}
