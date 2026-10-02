import { describe, expect, it } from 'vitest';
import { convertMinor, fromMinor, minorToInput, normalizeDigits, toMinor } from './money';

describe('toMinor', () => {
  it('parses plain and formatted amounts', () => {
    expect(toMinor('1250')).toBe(125000);
    expect(toMinor('1,250.5')).toBe(125050);
    expect(toMinor('1250.05')).toBe(125005);
    expect(toMinor('0.01')).toBe(1);
    expect(toMinor(19.99)).toBe(1999);
    expect(toMinor('-40')).toBe(-4000);
  });

  it('avoids float drift', () => {
    expect(toMinor('0.1')! + toMinor('0.2')!).toBe(toMinor('0.3'));
    expect(toMinor(1.005)).toBe(101); // toFixed(2) rounding of the JS number
  });

  it('accepts Arabic-Indic digits and decimal separator', () => {
    expect(toMinor('١٢٥٠٫٥٠')).toBe(125050);
    expect(normalizeDigits('۱۲۳')).toBe('123');
  });

  it('respects currency precision', () => {
    expect(toMinor('1.234', 'KWD')).toBe(1234);
    expect(toMinor('1.234', 'EGP')).toBeNull();
    expect(toMinor('500', 'JPY')).toBe(500);
    expect(toMinor('500.5', 'JPY')).toBeNull();
  });

  it('rejects garbage', () => {
    for (const bad of ['', 'abc', '1.2.3', '--1', '1e5', '12a']) expect(toMinor(bad)).toBeNull();
  });
});

describe('formatting helpers', () => {
  it('round-trips through input strings', () => {
    expect(minorToInput(125050)).toBe('1250.50');
    expect(minorToInput(-5)).toBe('-0.05');
    expect(minorToInput(1234, 'KWD')).toBe('1.234');
    expect(fromMinor(125050)).toBe(1250.5);
  });

  it('converts between currencies with rounding', () => {
    // 10.00 USD at 48.5 EGP/USD = 485.00 EGP
    expect(convertMinor(1000, 'USD', 'EGP', 48.5)).toBe(48500);
    expect(convertMinor(333, 'EGP', 'USD', 1 / 48.5)).toBe(7);
    expect(convertMinor(-1000, 'USD', 'EGP', 48.5)).toBe(-48500);
    expect(convertMinor(1000, 'EGP', 'EGP', 99)).toBe(1000);
  });
});
