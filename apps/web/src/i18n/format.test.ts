import { describe, expect, it } from 'vitest';
import { ar } from './ar';
import { en } from './en';
import { makeFormatter } from './index';

const base = { dateFormat: 'dd/MM/yyyy', timezone: 'Africa/Cairo', baseCurrency: 'EGP' };

describe('formatter', () => {
  it('formats money from minor units without float drift', () => {
    const f = makeFormatter({ ...base, locale: 'en', digits: 'latn' });
    expect(f.money(125050, 'EGP')).toBe('EGP 1,250.50');
    expect(f.money(-5, 'EGP')).toBe('-EGP 0.05');
    expect(f.money(1234, 'KWD')).toBe('KWD 1.234');
    expect(f.money(10000, 'EGP', { sign: true })).toBe('+EGP 100.00');
  });

  it('supports Arabic with Western or Arabic-Indic digits', () => {
    const latn = makeFormatter({ ...base, locale: 'ar', digits: 'latn' });
    const arab = makeFormatter({ ...base, locale: 'ar', digits: 'arab' });
    expect(latn.money(125050, 'EGP')).toMatch(/1,250\.50/);
    expect(arab.money(125050, 'EGP')).toMatch(/١٬٢٥٠٫٥٠/);
    expect(arab.date('2026-10-02')).toBe('٠٢/١٠/٢٠٢٦');
  });

  it('formats calendar dates with the chosen pattern and never shifts the day', () => {
    expect(makeFormatter({ ...base, locale: 'en', digits: 'latn' }).date('2026-01-31')).toBe('31/01/2026');
    expect(makeFormatter({ ...base, dateFormat: 'yyyy-MM-dd', locale: 'en', digits: 'latn' }).date('2026-01-31')).toBe('2026-01-31');
    // 23:30 UTC on Jan 31 is already Feb 1 in Cairo.
    expect(makeFormatter({ ...base, locale: 'en', digits: 'latn' }).date('2026-01-31T23:30:00.000Z')).toBe('01/02/2026');
  });
});

describe('translations', () => {
  it('Arabic covers every English key with a non-empty string', () => {
    for (const key of Object.keys(en)) expect(ar[key as keyof typeof en], key).toBeTruthy();
  });
  it('placeholders match between languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect(ph(ar[key]), key).toBe(ph(en[key]));
  });
});
