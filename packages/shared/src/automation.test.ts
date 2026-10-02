import { describe, expect, it } from 'vitest';
import { AUTOMATION_EVENTS, lastScheduledAt, matchAll, matchCondition, renderTemplate } from './automation';
import { guessDateFormat, parseAmount, parseCsv, parseDateAs } from './csv';

describe('automation conditions', () => {
  const tx = { type: 'expense', amount: 1500, payee: 'Carrefour Maadi', categoryId: 'c1', description: null };
  const fields = AUTOMATION_EVENTS['transaction.create'].fields;
  it('compares numbers numerically and text case-insensitively', () => {
    expect(matchCondition(tx, { field: 'amount', op: 'gt', value: '1000' }, 'number')).toBe(true);
    expect(matchCondition(tx, { field: 'amount', op: 'gt', value: '200' }, 'text')).toBe(false); // text compare would be wrong — type matters
    expect(matchCondition(tx, { field: 'payee', op: 'contains', value: 'carrefour' })).toBe(true);
    expect(matchCondition(tx, { field: 'description', op: 'empty' })).toBe(true);
    expect(matchCondition(tx, { field: 'amount', op: 'lt', value: 'abc' }, 'number')).toBe(false);
  });
  it('requires all conditions', () => {
    expect(matchAll(tx, [{ field: 'type', op: 'eq', value: 'expense' }, { field: 'amount', op: 'gte', value: '1500' }], fields)).toBe(true);
    expect(matchAll(tx, [{ field: 'type', op: 'eq', value: 'income' }, { field: 'amount', op: 'gte', value: '1500' }], fields)).toBe(false);
    expect(matchAll(tx, [], fields)).toBe(true);
  });
  it('renders templates without inventing values', () => {
    expect(renderTemplate('Big spend: {{amount}} at {{ payee }}{{missing}}', tx)).toBe('Big spend: 1500 at Carrefour Maadi');
  });
});

describe('schedules', () => {
  it('daily, weekly and monthly last occurrences', () => {
    expect(lastScheduledAt({ frequency: 'daily', time: '08:00' }, { date: '2026-10-02', time: '09:00' })).toBe('2026-10-02 08:00');
    expect(lastScheduledAt({ frequency: 'daily', time: '08:00' }, { date: '2026-10-02', time: '07:59' })).toBe('2026-10-01 08:00');
    // 2026-10-03 is a Saturday.
    expect(lastScheduledAt({ frequency: 'weekly', time: '10:00', weekday: 6 }, { date: '2026-10-02', time: '12:00' })).toBe('2026-09-26 10:00');
    expect(lastScheduledAt({ frequency: 'monthly', time: '09:00', dayOfMonth: 31 }, { date: '2026-10-02', time: '12:00' })).toBe('2026-09-30 09:00');
    expect(lastScheduledAt({ frequency: 'monthly', time: '09:00', dayOfMonth: 1 }, { date: '2026-10-01', time: '09:00' })).toBe('2026-10-01 09:00');
  });
});

describe('csv & bank formats', () => {
  it('parses quotes, escaped quotes, newlines in fields, BOM, semicolons', () => {
    const r = parseCsv('﻿Date;Description;Amount\r\n01/10/2026;"Rent; October";"-12.000,00"\r\n02/10/2026;"He said ""hi""\nthen left";500\r\n\r\n');
    expect(r.delimiter).toBe(';');
    expect(r.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(r.rows).toEqual([
      ['01/10/2026', 'Rent; October', '-12.000,00'],
      ['02/10/2026', 'He said "hi"\nthen left', '500'],
    ]);
  });
  it('reads bank amount styles', () => {
    expect(parseAmount('1,234.50')).toBe('1234.50');
    expect(parseAmount('1.234,50', ',')).toBe('1234.50');
    expect(parseAmount('(120.00)')).toBe('-120.00');
    expect(parseAmount('120.00-')).toBe('-120.00');
    expect(parseAmount('EGP -45')).toBe('-45');
    expect(parseAmount('١٢٣')).toBe('123');
    expect(parseAmount('n/a')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
  it('parses and guesses date formats', () => {
    expect(parseDateAs('31/12/2025', 'dd/MM/yyyy')).toBe('2025-12-31');
    expect(parseDateAs('12/31/2025', 'MM/dd/yyyy')).toBe('2025-12-31');
    expect(parseDateAs('31/02/2025', 'dd/MM/yyyy')).toBeNull();
    expect(parseDateAs('2025-12-31 14:00', 'yyyy-MM-dd')).toBe('2025-12-31');
    expect(parseDateAs('1.2.26', 'dd.MM.yyyy')).toBe('2026-02-01');
    expect(guessDateFormat(['31/12/2025', '01/01/2026'])).toBe('dd/MM/yyyy');
    expect(guessDateFormat(['12/31/2025'])).toBe('MM/dd/yyyy');
    expect(guessDateFormat(['2025-12-31'])).toBe('yyyy-MM-dd');
  });
});
