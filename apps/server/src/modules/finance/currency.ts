import { CURRENCIES, convertMinor, currencyDefSchema, fxRateSchema, normalizeDigits } from '@life-erp/shared';
import { and, desc, eq, lte } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { currencies, fxRates } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { parse } from '../../lib/validate';
import { getSettings } from '../settings/service';

export function allCurrencies() {
  const custom = getDb().select().from(currencies).all();
  return [
    ...CURRENCIES.map((c) => ({ code: c.code, name: c.name.en, nameAr: c.name.ar, digits: c.digits, custom: false })),
    ...custom.filter((c) => !CURRENCIES.find((k) => k.code === c.code)).map((c) => ({ code: c.code, name: c.name, nameAr: c.name, digits: c.digits, custom: true })),
  ];
}

export function digitsFor(code: string): number {
  const known = CURRENCIES.find((c) => c.code === code);
  if (known) return known.digits;
  return getDb().select().from(currencies).where(eq(currencies.code, code)).get()?.digits ?? 2;
}

export function assertCurrency(code: string, field = 'currency') {
  if (CURRENCIES.find((c) => c.code === code)) return;
  if (getDb().select().from(currencies).where(eq(currencies.code, code)).get()) return;
  throw new AppError(400, 'validation', `Unknown currency ${code}. Add it in Finance → Currencies first.`, [
    { path: field, message: `Unknown currency ${code}` },
  ]);
}

/**
 * Convert a validated decimal string to minor units for a currency, with a field-level error
 * if it has too many decimals (e.g. 1.234 EGP).
 */
export function minorOf(amount: string, currency: string, field = 'amount'): number {
  const digits = digitsFor(currency);
  const s = normalizeDigits(String(amount)).trim().replace(/[\s,_]/g, '').replace('٫', '.');
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new AppError(400, 'validation', 'Enter a valid amount', [{ path: field, message: 'Enter a valid amount' }]);
  const frac = m[3] ?? '';
  if (frac.replace(/0+$/, '').length > digits) {
    const msg = digits === 0 ? `${currency} has no decimals` : `${currency} allows at most ${digits} decimals`;
    throw new AppError(400, 'validation', msg, [{ path: field, message: msg }]);
  }
  const minor = Number(m[2]) * 10 ** digits + Number((frac + '0'.repeat(digits)).slice(0, digits) || '0');
  if (!Number.isSafeInteger(minor) || minor > 1e15) {
    throw new AppError(400, 'validation', 'Amount is too large', [{ path: field, message: 'Amount is too large' }]);
  }
  return m[1] ? -minor : minor;
}

export function addCurrency(ctx: AuditContext, input: unknown) {
  const c = parse(currencyDefSchema, input);
  if (CURRENCIES.find((k) => k.code === c.code) || getDb().select().from(currencies).where(eq(currencies.code, c.code)).get()) {
    throw conflict(`${c.code} already exists`);
  }
  getDb().insert(currencies).values(c).run();
  audit(ctx, 'currency.create', null, `Added currency ${c.code}`);
  return c;
}

// ---------- exchange rates ----------

export function listRates() {
  return getDb().select().from(fxRates).orderBy(desc(fxRates.date), fxRates.currency).limit(500).all();
}

export function setRate(ctx: AuditContext, input: unknown) {
  const r = parse(fxRateSchema, input);
  const base = getSettings().baseCurrency;
  if (r.currency === base) throw badRequest(`${base} is your main currency — its rate is always 1`);
  assertCurrency(r.currency);
  const db = getDb();
  const existing = db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.currency, r.currency), eq(fxRates.base, base), eq(fxRates.date, r.date)))
    .get();
  if (existing) db.update(fxRates).set({ rate: r.rate }).where(eq(fxRates.id, existing.id)).run();
  else db.insert(fxRates).values({ id: newId(), currency: r.currency, base, rate: r.rate, date: r.date }).run();
  audit(ctx, 'fx.set', null, `Rate ${r.date}: 1 ${r.currency} = ${r.rate} ${base}`);
  return { ...r, base };
}

export function deleteRate(ctx: AuditContext, id: string) {
  const row = getDb().select().from(fxRates).where(eq(fxRates.id, id)).get();
  if (!row) throw notFound('Rate');
  getDb().delete(fxRates).where(eq(fxRates.id, id)).run();
  audit(ctx, 'fx.delete', null, `Deleted rate ${row.date} ${row.currency}/${row.base}`);
}

function directRate(from: string, to: string, date: string): number | null {
  const db = getDb();
  const pick = (c: string, b: string) =>
    db
      .select()
      .from(fxRates)
      .where(and(eq(fxRates.currency, c), eq(fxRates.base, b), lte(fxRates.date, date)))
      .orderBy(desc(fxRates.date))
      .get() ??
    // No rate on/before the date: fall back to the earliest known rate rather than failing.
    db.select().from(fxRates).where(and(eq(fxRates.currency, c), eq(fxRates.base, b))).orderBy(fxRates.date).get();
  const d = pick(from, to);
  if (d) return d.rate;
  const inv = pick(to, from);
  if (inv) return 1 / inv.rate;
  return null;
}

/** Rate to convert 1 unit of `from` into `to` on `date` (direct, inverse or via a common base). */
export function rateFor(from: string, to: string, date: string): number | null {
  if (from === to) return 1;
  const direct = directRate(from, to, date);
  if (direct !== null) return direct;
  const bases = new Set(getDb().select({ b: fxRates.base }).from(fxRates).all().map((r) => r.b));
  for (const via of bases) {
    if (via === from || via === to) continue;
    const a = directRate(from, via, date);
    const b = directRate(via, to, date);
    if (a !== null && b !== null) return a * b;
  }
  return null;
}

/**
 * Converter that caches rates for one report. Amounts it cannot convert are collected
 * in `missing` so the UI can say exactly which currencies need a rate — never guessed.
 */
export function makeConverter(to: string, date: string) {
  const cache = new Map<string, number | null>();
  const missing = new Set<string>();
  return {
    missing,
    convert(minor: number, from: string): number {
      if (from === to || minor === 0) return minor;
      if (!cache.has(from)) cache.set(from, rateFor(from, to, date));
      const rate = cache.get(from);
      if (rate == null) {
        missing.add(from);
        return 0;
      }
      return convertMinor(minor, from, to, rate);
    },
  };
}
