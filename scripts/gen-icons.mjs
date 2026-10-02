// Generates the PWA / favicon PNGs from the LIFE ERP mark (no image libraries needed).
// Run: node scripts/gen-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public');
mkdirSync(out, { recursive: true });

const INK = [20, 24, 32];
const ACCENT = [47, 84, 214];
const PAPER = [246, 247, 249];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const SS = 4; // supersampling for smooth corners
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const p = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          if (p) {
            r += p[0] * p[3];
            g += p[1] * p[3];
            b += p[2] * p[3];
            a += p[3];
          }
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const inRoundRect = (x, y, x0, y0, w, h, r) => {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** The mark in unit coordinates; `pad` shrinks it for maskable icons (safe zone). */
function mark(pad, rounded) {
  const s = 1 - pad * 2;
  return (u, v) => {
    const x = (u - pad) / s;
    const y = (v - pad) / s;
    const bg = rounded ? inRoundRect(u, v, 0, 0, 1, 1, 0.22) : true;
    if (!bg) return null;
    const cell = (cx, cy) => inRoundRect(x, y, cx, cy, 0.25, 0.25, 0.06);
    if (cell(0.22, 0.22)) return [...ACCENT, 1];
    if (cell(0.53, 0.22) || cell(0.22, 0.53)) return [...PAPER, 1];
    if (cell(0.53, 0.53)) return [...PAPER.map((c, i) => Math.round(c * 0.55 + INK[i] * 0.45)), 1];
    return [...INK, 1];
  };
}

const files = {
  'icon-192.png': png(192, mark(0, true)),
  'icon-512.png': png(512, mark(0, true)),
  'icon-maskable-512.png': png(512, mark(0.1, false)),
  'apple-touch-icon.png': png(180, mark(0, false)),
  'favicon-32.png': png(32, mark(0, true)),
};
for (const [name, buf] of Object.entries(files)) writeFileSync(join(out, name), buf);
console.log(`Icons written to ${out}`);
