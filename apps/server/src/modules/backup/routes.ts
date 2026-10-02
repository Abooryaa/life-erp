import { createReadStream, createWriteStream, renameSync, rmSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getSqlite } from '../../db/client';
import { ctxOf, sendFileDownload } from '../../http';
import { audit } from '../../lib/audit';
import { AppError, badRequest } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { parse } from '../../lib/validate';
import { getConfig } from '../../runtime';
import { exportAllJson } from './export';
import { backupDir, backupPathByName, createBackup, deleteBackupFile, inspectBackup, listBackups, restoreBackup, tableCounts } from './service';
import pkg from '../../../package.json';

type Name = { Params: { name: string } };

export async function backupRoutes(app: FastifyInstance) {
  app.get('/api/backups', async () => listBackups());

  app.post('/api/backups', async (req) => {
    const b = await createBackup('manual', ctxOf(req));
    return { name: b.name, size: b.size, path: b.path };
  });

  app.get<Name>('/api/backups/:name/inspect', async (req) => inspectBackup(backupPathByName(req.params.name)));

  app.post<Name>('/api/backups/:name/restore', async (req) => {
    const { confirm } = parse(z.object({ confirm: z.string() }), req.body);
    return restoreBackup(backupPathByName(req.params.name), ctxOf(req), confirm);
  });

  app.get<Name>('/api/backups/:name/download', async (req, reply) => {
    const p = backupPathByName(req.params.name);
    sendFileDownload(reply, req.params.name, 'application/zip', false);
    reply.header('Content-Length', statSync(p).size);
    return reply.send(createReadStream(p));
  });

  app.delete<Name>('/api/backups/:name', async (req) => {
    deleteBackupFile(ctxOf(req), req.params.name);
    return { ok: true };
  });

  /** Upload a backup archive from another device so it can be inspected and restored. */
  app.post('/api/backups/upload', async (req) => {
    if (!req.isMultipart()) throw badRequest('Send the backup as multipart/form-data');
    const part = await req.file({ limits: { fileSize: 20 * 1024 * 1024 * 1024, files: 1 } });
    if (!part) throw badRequest('No file was uploaded');
    if (!part.filename.toLowerCase().endsWith('.zip')) throw badRequest('Backups are .zip files');
    const dir = backupDir();
    const tmp = join(getConfig().paths.tmp, `upload-${newId()}.zip`);
    await pipeline(part.file, createWriteStream(tmp));
    const info = await inspectBackup(tmp);
    if (!info.manifest) {
      rmSync(tmp, { force: true });
      throw new AppError(400, 'invalid_backup', info.problems[0] ?? 'Not a LIFE ERP backup');
    }
    const safeBase = part.filename.replace(/[^\w.-]/g, '_').replace(/\.zip$/i, '');
    const name = `${safeBase}-uploaded-${Date.now()}.zip`;
    renameSync(tmp, join(dir, name));
    audit(ctxOf(req), 'backup.upload', null, `Uploaded backup ${part.filename}`);
    return { name, ...info };
  });

  app.get('/api/export/json', async (req, reply) => {
    const data = exportAllJson();
    audit(ctxOf(req), 'export.json', null, 'Exported all data as JSON');
    const date = new Date().toISOString().slice(0, 10);
    sendFileDownload(reply, `life-erp-export-${date}.json`, 'application/json', false);
    return reply.send(JSON.stringify(data, null, 2));
  });

  app.get('/api/system', async () => {
    const cfg = getConfig();
    const addresses = Object.entries(networkInterfaces()).flatMap(([iface, list]) =>
      (list ?? [])
        .filter((a) => a.family === 'IPv4' && !a.internal)
        .map((a) => ({ iface, address: a.address, tailscale: a.address.startsWith('100.') && /tailscale/i.test(iface) })),
    );
    return {
      version: pkg.version,
      demo: cfg.demo,
      env: cfg.env,
      port: cfg.port,
      lan: cfg.lan,
      dataDir: cfg.paths.root,
      backupDir: backupDir(),
      node: process.version,
      sqlite: (getSqlite().prepare('select sqlite_version() v').get() as { v: string }).v,
      uptimeSec: Math.round(process.uptime()),
      counts: tableCounts(),
      addresses,
    };
  });
}
