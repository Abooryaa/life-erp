import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from './app';
import { loadConfig } from './config';
import { closeDb } from './db/client';
import { startScheduler, stopScheduler } from './jobs/scheduler';
import { createLogger } from './logger';
import { serverLockPid, writeServerLock } from './modules/backup/service';
import { setRuntimeConfig } from './runtime';

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.paths.logs);
  setRuntimeConfig(config);
  const other = serverLockPid();
  if (other) {
    console.error(`\n✖ Another LIFE ERP server (process ${other}) is already using ${config.paths.root}. Stop it first.\n`);
    process.exit(1);
  }
  writeServerLock();

  let app;
  try {
    app = await buildApp(config, { logger });
  } catch (err) {
    logger.fatal({ err }, 'LIFE ERP could not start');
    console.error(`\n✖ LIFE ERP could not start: ${(err as Error).message}\n`);
    rmSync(join(config.paths.config, 'server.lock'), { force: true });
    process.exit(1);
  }

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    console.error(
      e.code === 'EADDRINUSE'
        ? `\n✖ Port ${config.port} is already in use. Is LIFE ERP already running? (Set PORT in .env to use another port.)\n`
        : `\n✖ Could not start the web server: ${e.message}\n`,
    );
    process.exit(1);
  }
  startScheduler(app.log);

  const label = config.demo ? 'LIFE ERP (DEMO DATA)' : 'LIFE ERP';
  console.log(`\n  ${label} is running`);
  console.log(`  ➜ On this laptop:  http://localhost:${config.port}`);
  if (config.lan) console.log(`  ➜ On your network: http://<this-laptop-ip>:${config.port}  (see Settings → Remote access)`);
  console.log(`  ➜ Data folder:     ${config.paths.root}`);
  console.log('  Press Ctrl+C to stop.\n');

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info(`Received ${signal}, shutting down`);
    stopScheduler();
    await app.close().catch(() => {});
    closeDb();
    rmSync(join(config.paths.config, 'server.lock'), { force: true });
    console.log('LIFE ERP stopped cleanly.');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGBREAK', () => void shutdown('SIGBREAK'));
}

void main();
