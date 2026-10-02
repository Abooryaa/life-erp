import { currencyDigits, fromMinor } from '@life-erp/shared';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { ar } from './ar';
import { en, type MessageKey } from './en';

export type Locale = 'en' | 'ar';
export type Digits = 'latn' | 'arab';

const DICTS: Record<Locale, Record<MessageKey, string>> = { en, ar };

/** Server/validation messages that are worth translating when the UI is in Arabic. */
const AR_ERRORS: Record<string, string> = {
  Required: 'مطلوب',
  'Passwords do not match': 'كلمتا المرور غير متطابقتين',
  'Not a valid email': 'بريد إلكتروني غير صالح',
  'Use at least 10 characters': 'استخدم 10 أحرف على الأقل',
  'Incorrect username or password': 'اسم المستخدم أو كلمة المرور غير صحيحة',
  'That code is not valid': 'الرمز غير صحيح',
  'Current password is incorrect': 'كلمة المرور الحالية غير صحيحة',
  'Please sign in': 'يرجى تسجيل الدخول',
  'Use the format YYYY-MM-DD': 'استخدم الصيغة YYYY-MM-DD',
  'Not a real calendar date': 'تاريخ غير صحيح',
  'Enter the 6-digit code': 'أدخل الرمز المكوّن من 6 أرقام',
  'The file is empty': 'الملف فارغ',
  'The file is larger than the upload limit': 'الملف أكبر من الحد المسموح',
};

const LOCALE_KEY = 'lerp.locale';

export function storedLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    if (v === 'en' || v === 'ar') return v;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.startsWith('ar') ? 'ar' : 'en';
}

export function rememberLocale(l: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, l);
  } catch {
    /* ignore */
  }
}

export interface FormatOptions {
  locale: Locale;
  digits: Digits;
  dateFormat: string;
  timezone: string;
  baseCurrency: string;
}

function intlLocale(o: Pick<FormatOptions, 'locale' | 'digits'>) {
  return `${o.locale === 'ar' ? 'ar-EG' : 'en-GB'}-u-nu-${o.digits}`;
}

export function makeFormatter(o: FormatOptions) {
  const loc = intlLocale(o);
  const num = new Intl.NumberFormat(loc);
  const pad = (n: number) => String(n).padStart(2, '0');
  const toDigits = (s: string) => (o.digits === 'arab' ? s.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]) : s);

  /** Format a calendar date "2026-10-02" (or ISO timestamp) per the chosen pattern. */
  const date = (iso: string | null | undefined) => {
    if (!iso) return '';
    let y: number, m: number, d: number;
    if (iso.length === 10) [y, m, d] = iso.split('-').map(Number);
    else {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: o.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
      const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      [y, m, d] = [g('year'), g('month'), g('day')];
    }
    const out = o.dateFormat.replace('yyyy', String(y)).replace('MM', pad(m)).replace('dd', pad(d));
    return toDigits(out);
  };

  return {
    number: (n: number) => num.format(n),
    /** Amount in minor units → "EGP 1,250.50" style, with sign handling. */
    money(minor: number, currency = o.baseCurrency, opts: { sign?: boolean; compact?: boolean } = {}) {
      const digits = currencyDigits(currency);
      const value = fromMinor(minor, currency);
      const f = new Intl.NumberFormat(loc, {
        style: 'currency',
        currency,
        currencyDisplay: 'code',
        minimumFractionDigits: opts.compact ? 0 : digits,
        maximumFractionDigits: opts.compact ? 1 : digits,
        notation: opts.compact ? 'compact' : 'standard',
        signDisplay: opts.sign ? 'exceptZero' : 'auto',
      });
      return f.format(value).replace(/ /g, ' ');
    },
    percent: (ratio: number, fractionDigits = 0) =>
      new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: fractionDigits }).format(ratio),
    date,
    dateTime(iso: string | null | undefined) {
      if (!iso) return '';
      const t = new Intl.DateTimeFormat(loc, { timeZone: o.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
      return `${date(iso)} ${t}`;
    },
    weekday(iso: string, style: 'long' | 'short' = 'long') {
      return new Intl.DateTimeFormat(loc, { weekday: style, timeZone: 'UTC' }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
    },
    longDate(iso: string) {
      return new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: o.timezone }).format(
        iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso),
      );
    },
    relative(iso: string | null | undefined) {
      if (!iso) return '';
      const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' });
      const diff = (Date.parse(iso) - Date.now()) / 1000;
      const abs = Math.abs(diff);
      if (abs < 60) return rtf.format(Math.round(diff), 'second');
      if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
      if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
      return date(iso);
    },
    bytes(n: number) {
      const units = ['B', 'KB', 'MB', 'GB'];
      let i = 0;
      let v = n;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
      }
      return `${new Intl.NumberFormat(loc, { maximumFractionDigits: i ? 1 : 0 }).format(v)} ${units[i]}`;
    },
  };
}

export type Formatter = ReturnType<typeof makeFormatter>;

interface I18nValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  /** Translate a server/validation message when a translation is known. */
  te: (message: string) => string;
  fmt: Formatter;
}

const Ctx = createContext<I18nValue | null>(null);

export function I18nProvider({ options, children }: { options: FormatOptions; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => {
    const dict = DICTS[options.locale];
    const fmt = makeFormatter(options);
    return {
      locale: options.locale,
      dir: options.locale === 'ar' ? 'rtl' : 'ltr',
      t: (key, params) => {
        let s = dict[key] ?? en[key] ?? key;
        if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, typeof v === 'number' ? fmt.number(v) : v);
        return s;
      },
      te: (m) => (options.locale === 'ar' ? (AR_ERRORS[m] ?? m) : m),
      fmt,
    };
  }, [options.locale, options.digits, options.dateFormat, options.timezone, options.baseCurrency]);

  useEffect(() => {
    document.documentElement.lang = value.locale;
    document.documentElement.dir = value.dir;
    rememberLocale(value.locale);
  }, [value.locale, value.dir]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

export type { MessageKey };
