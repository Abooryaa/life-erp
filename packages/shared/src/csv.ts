import { normalizeDigits } from './money';

/** Guess the delimiter from the first lines: comma, semicolon (European Excel) or tab. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  const count = (c: string) => sample.split(c).length - 1;
  const scores = { ',': count(','), ';': count(';'), '\t': count('\t') };
  return (Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0] as ',' | ';' | '\t') ?? ',';
}

/**
 * RFC-4180 style CSV parser: quoted fields, "" escapes, newlines inside quotes, CRLF,
 * a UTF-8 BOM and blank trailing lines.
 */
export function parseCsv(input: string, delimiter?: string): { headers: string[]; rows: string[][]; delimiter: string } {
  const text = input.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(text);
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    out.push(row);
  }
  const rows = out.filter((r) => r.some((x) => x.trim() !== ''));
  const headers = (rows.shift() ?? []).map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows: rows.map((r) => headers.map((_, i) => (r[i] ?? '').trim())), delimiter: d };
}

export const DATE_FORMATS = ['yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'dd-MM-yyyy', 'dd.MM.yyyy'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Parse a date in the given format to 'YYYY-MM-DD' (also accepts 2-digit years and a time part). Null if invalid. */
export function parseDateAs(value: string, format: DateFormat): string | null {
  const s = normalizeDigits(value).trim().split(/[ T]/)[0];
  const parts = s.split(/[-/.]/).map((p) => p.trim());
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  let y: number, m: number, d: number;
  if (format === 'yyyy-MM-dd') [y, m, d] = parts.map(Number);
  else if (format === 'MM/dd/yyyy') [m, d, y] = parts.map(Number);
  else [d, m, y] = parts.map(Number);
  if (y < 100) y += 2000;
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** Pick the date format that parses every sample (preferring day-first when ambiguous). */
export function guessDateFormat(samples: string[]): DateFormat | null {
  const order: DateFormat[] = ['yyyy-MM-dd', 'dd/MM/yyyy', 'dd-MM-yyyy', 'dd.MM.yyyy', 'MM/dd/yyyy'];
  const vals = samples.filter((s) => s.trim());
  if (!vals.length) return null;
  return order.find((f) => vals.every((v) => parseDateAs(v, f) !== null)) ?? null;
}

/**
 * Read an amount as written in bank exports: "1,234.50", "1.234,50" (decimal comma),
 * "(120.00)" or "120.00-" for negatives, currency text, Arabic digits.
 * Returns a plain decimal string ("-1234.5") or null.
 */
export function parseAmount(value: string, decimal: '.' | ',' = '.'): string | null {
  let s = normalizeDigits(value).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s)) {
    neg = true;
    s = s.replace(/-\s*$/, '');
  }
  if (/^\s*-/.test(s) || /^[^\d]*-/.test(s)) {
    neg = !neg;
    s = s.replace('-', '');
  }
  s = s.replace(/[^\d.,٫]/g, '').replace('٫', '.');
  if (decimal === ',') s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = s.replace(/^0+(?=\d)/, '');
  return neg && Number(n) !== 0 ? `-${n}` : n;
}
