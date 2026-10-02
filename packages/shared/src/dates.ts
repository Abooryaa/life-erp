/** Calendar-date helpers on 'YYYY-MM-DD' strings (no time zones, no drift). */

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Add months, clamping to the last day of the month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, months: number, anchorDay?: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchorDay ?? d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const monthOf = (date: string) => date.slice(0, 7);
export const monthStart = (month: string) => `${month.slice(0, 7)}-01`;
export function monthEnd(month: string): string {
  return addDays(addMonths(monthStart(month), 1), -1);
}
export function daysInMonth(month: string): number {
  return Number(monthEnd(month).slice(8, 10));
}
export function addMonthsToMonth(month: string, n: number): string {
  return addMonths(monthStart(month), n).slice(0, 7);
}
/** Whole months from month a to month b (b - a). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
