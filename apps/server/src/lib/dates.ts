export { addDays, addMonths, daysBetween, monthStart, monthEnd, monthOf } from '@life-erp/shared';

/** Current local date ("2026-10-02") and time ("14:05") in a given IANA time zone. */
export function localDateTime(timeZone: string, at: Date = new Date()) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    return localDateTime('UTC', at);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
