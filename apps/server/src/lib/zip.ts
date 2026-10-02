import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';

export interface ZipInput {
  /** Path inside the archive (forward slashes). */
  name: string;
  file?: string;
  buffer?: Buffer;
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

export function writeZip(out: string, entries: ZipInput[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const e of entries) {
      if (e.file) zip.addFile(e.file, e.name);
      else zip.addBuffer(e.buffer ?? Buffer.alloc(0), e.name);
    }
    const ws = createWriteStream(out);
    zip.outputStream.pipe(ws).on('close', resolve).on('error', reject);
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (err, zf) => (err || !zf ? reject(err) : resolve(zf))),
  );
}

function openEntry(zf: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => zf.openReadStream(entry, (err, rs) => (err || !rs ? reject(err) : resolve(rs))));
}

/** Reject entry names that could escape the extraction folder ("zip slip"). */
export function safeEntryName(name: string): string | null {
  if (!name || name.includes('\0') || isAbsolute(name) || /^[a-zA-Z]:/.test(name)) return null;
  const n = normalize(name);
  if (n.startsWith('..') || n.split(sep).includes('..')) return null;
  return n;
}

/**
 * Walk every entry of an archive. The visitor receives a stream for file entries
 * and must fully consume it.
 */
export async function walkZip(
  path: string,
  visit: (name: string, stream: Readable, size: number) => Promise<void>,
  want: (name: string) => boolean = () => true,
) {
  const zf = await openZip(path);
  await new Promise<void>((resolve, reject) => {
    zf.on('error', reject);
    zf.on('end', resolve);
    zf.on('entry', async (entry: yauzl.Entry) => {
      try {
        if (!entry.fileName.endsWith('/') && want(entry.fileName)) {
          const rs = await openEntry(zf, entry);
          await visit(entry.fileName, rs, entry.uncompressedSize);
        }
        zf.readEntry();
      } catch (err) {
        zf.close();
        reject(err);
      }
    });
    zf.readEntry();
  });
}

export async function readZipEntry(path: string, wanted: string): Promise<Buffer | null> {
  let found: Buffer | null = null;
  await walkZip(
    path,
    async (_name, stream) => {
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      found = Buffer.concat(chunks);
    },
    (name) => name === wanted,
  );
  return found;
}

/** Extract everything into `dest`, returning sha256 of each extracted entry. */
export async function extractZip(path: string, dest: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  await walkZip(path, async (name, stream) => {
    const safe = safeEntryName(name);
    if (!safe) throw new Error(`Unsafe path in archive: ${name}`);
    const target = join(dest, safe);
    mkdirSync(dirname(target), { recursive: true });
    const h = createHash('sha256');
    stream.on('data', (c) => h.update(c));
    await pipeline(stream, createWriteStream(target));
    hashes.set(name, h.digest('hex'));
  });
  return hashes;
}
