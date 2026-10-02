import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { files } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { newId } from '../../lib/ids';

export type FileRow = typeof files.$inferSelect;

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.dwg': 'application/acad',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
};

/** Detect type from magic bytes first (can't be spoofed by renaming), then extension. */
export function detectMime(head: Buffer, filename: string): string {
  const hex = head.subarray(0, 12).toString('hex');
  if (hex.startsWith('25504446')) return 'application/pdf';
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('52494646') && head.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  const ext = extname(filename).toLowerCase();
  const byExt = EXT_MIME[ext];
  // Office files and zips share the PK header — trust the extension in that case only.
  if (hex.startsWith('504b0304')) return byExt && /officedocument|zip/.test(byExt) ? byExt : 'application/zip';
  if (byExt && !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'].includes(byExt)) return byExt;
  return 'application/octet-stream';
}

/** Types the browser may display inline. Everything else (incl. SVG/HTML) is always downloaded. */
export const INLINE_SAFE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);

export function storagePathFor(filesDir: string, sha: string) {
  return join(filesDir, sha.slice(0, 2), sha.slice(2, 4), sha);
}

/**
 * Stream an upload to disk, hashing as it goes. Identical content is stored once.
 * Throws a clear error when the upload exceeds the size limit.
 */
export async function storeUpload(
  stream: Readable & { truncated?: boolean },
  filename: string,
  dirs: { files: string; tmp: string },
): Promise<FileRow> {
  const tmp = join(dirs.tmp, `upload-${newId()}`);
  const hash = createHash('sha256');
  let size = 0;
  let head = Buffer.alloc(0);
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      size += chunk.length;
      if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(stream, meter, createWriteStream(tmp));
  } catch (err) {
    rmSync(tmp, { force: true });
    throw new AppError(500, 'upload_failed', `The file could not be saved: ${(err as Error).message}`);
  }
  if (stream.truncated) {
    rmSync(tmp, { force: true });
    throw new AppError(413, 'too_large', 'The file is larger than the upload limit');
  }
  if (size === 0) {
    rmSync(tmp, { force: true });
    throw new AppError(400, 'empty_file', 'The file is empty');
  }
  const sha = hash.digest('hex');
  const db = getDb();
  const existing = db.select().from(files).where(eq(files.sha256, sha)).get();
  if (existing && existsSync(join(dirs.files, existing.storagePath))) {
    rmSync(tmp, { force: true });
    return existing;
  }
  const abs = storagePathFor(dirs.files, sha);
  mkdirSync(join(abs, '..'), { recursive: true });
  renameSync(tmp, abs);
  const rel = abs.slice(dirs.files.length + 1).replace(/\\/g, '/');
  if (existing) {
    db.update(files).set({ storagePath: rel }).where(eq(files.id, existing.id)).run();
    return { ...existing, storagePath: rel };
  }
  const row = { id: newId(), sha256: sha, size: statSync(abs).size, mime: detectMime(head, filename), storagePath: rel };
  db.insert(files).values(row).run();
  return db.select().from(files).where(eq(files.id, row.id)).get()!;
}
