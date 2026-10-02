import { randomBytes } from 'node:crypto';

let lastMs = 0;
let seq = 0;

/**
 * UUIDv7: time-ordered, globally unique, portable to PostgreSQL's uuid type.
 * Sorting by id sorts by creation time.
 */
export function newId(): string {
  let ms = Date.now();
  if (ms <= lastMs) {
    ms = lastMs;
    seq = (seq + 1) & 0xfff;
    if (seq === 0) ms = ++lastMs;
  } else {
    seq = randomBytes(2).readUInt16BE() & 0x7ff;
  }
  lastMs = ms;
  const b = randomBytes(16);
  b.writeUIntBE(ms, 0, 6);
  b[6] = 0x70 | (seq >> 8);
  b[7] = seq & 0xff;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(s: string) {
  const base = s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'item';
}
