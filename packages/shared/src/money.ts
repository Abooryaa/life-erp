/**
 * Money is always stored and calculated as an integer number of minor units
 * (piasters for EGP, cents for USD). Never use floats for stored amounts.
 */

export interface CurrencyDef {
  code: string;
  /** Number of minor-unit digits (EGP = 2, JPY = 0, KWD = 3). */
  digits: number;
  name: { en: string; ar: string };
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'EGP', digits: 2, name: { en: 'Egyptian Pound', ar: 'جنيه مصري' } },
  { code: 'USD', digits: 2, name: { en: 'US Dollar', ar: 'دولار أمريكي' } },
  { code: 'EUR', digits: 2, name: { en: 'Euro', ar: 'يورو' } },
  { code: 'GBP', digits: 2, name: { en: 'British Pound', ar: 'جنيه إسترليني' } },
  { code: 'SAR', digits: 2, name: { en: 'Saudi Riyal', ar: 'ريال سعودي' } },
  { code: 'AED', digits: 2, name: { en: 'UAE Dirham', ar: 'درهم إماراتي' } },
  { code: 'KWD', digits: 3, name: { en: 'Kuwaiti Dinar', ar: 'دينار كويتي' } },
  { code: 'QAR', digits: 2, name: { en: 'Qatari Riyal', ar: 'ريال قطري' } },
  { code: 'TRY', digits: 2, name: { en: 'Turkish Lira', ar: 'ليرة تركية' } },
  { code: 'JPY', digits: 0, name: { en: 'Japanese Yen', ar: 'ين ياباني' } },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code);

export function currencyDigits(code: string): number {
  return CURRENCIES.find((c) => c.code === code)?.digits ?? 2;
}

/**
 * Parse a user-entered decimal amount ("1,250.5", "١٢٥٠٫٥", 1250.5) into minor units.
 * Returns null when the input is not a valid amount for the currency.
 */
export function toMinor(input: string | number, currency = 'EGP'): number | null {
  const digits = currencyDigits(currency);
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    // toPrecision(15) strips binary noise (1.005 * 100 = 100.49999… → 100.5).
    const scaled = Number((input * 10 ** digits).toPrecision(15));
    const minor = Math.sign(scaled) * Math.round(Math.abs(scaled));
    return Number.isSafeInteger(minor) ? minor : null;
  }
  let s = input;
  s = normalizeDigits(s).trim().replace(/[\s,_]/g, '').replace('٫', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number((frac + '0'.repeat(digits)).slice(0, digits) || '0');
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/** Minor units → decimal number (for display/charts only, never for storage). */
export function fromMinor(minor: number, currency = 'EGP'): number {
  return minor / 10 ** currencyDigits(currency);
}

/** Minor units → plain decimal string suitable for an input field ("1250.50"). */
export function minorToInput(minor: number, currency = 'EGP'): string {
  const digits = currencyDigits(currency);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  if (digits === 0) return sign + String(abs);
  const whole = Math.floor(abs / 10 ** digits);
  const frac = String(abs % 10 ** digits).padStart(digits, '0');
  return `${sign}${whole}.${frac}`;
}

/** Convert Arabic-Indic and Eastern Arabic-Indic digits to ASCII digits. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * Convert an amount between currencies using a rate expressed as
 * "1 unit of `from` = rate units of `to`". Rounds half away from zero.
 */
export function convertMinor(minor: number, from: string, to: string, rate: number): number {
  if (from === to) return minor;
  const major = minor / 10 ** currencyDigits(from);
  const converted = major * rate * 10 ** currencyDigits(to);
  return Math.sign(converted) * Math.round(Math.abs(converted));
}
