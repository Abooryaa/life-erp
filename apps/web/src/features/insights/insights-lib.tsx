import { currencyDigits, fromMinor } from '@life-erp/shared';
import { useCallback } from 'react';
import type { ChartOption, token } from '../../components/Chart';
import { useI18n } from '../../i18n';

export const INSIGHT_KEYS = [['insights'], ['finance'], ['notifications'], ['audit']];

export interface SeriesDef {
  name: string;
  type: 'bar' | 'line';
  data: (number | null)[];
  color: string;
  /** Values are minor units of the base currency. */
  money?: boolean;
  area?: boolean;
  stack?: string;
}

/** Short month names for 'YYYY-MM' labels in the UI language. */
export function useMonthLabel() {
  const { locale } = useI18n();
  return (m: string) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${m.slice(0, 7)}-15T12:00:00Z`));
}

/**
 * Category-axis chart (bars and/or lines) that mirrors for Arabic and formats money tooltips.
 * Pass a stable `deps` list; the option is rebuilt when it changes.
 */
export function useAxisChart(labels: string[], series: SeriesDef[], base: string, deps: unknown[]) {
  const { fmt, dir } = useI18n();
  return useCallback(
    (tk: typeof token): ChartOption => {
      const anyMoney = series.some((s) => s.money);
      const val = (v: number | null, money?: boolean) => (v == null ? null : money ? fromMinor(v, base) : v);
      return {
        grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
        legend: { top: 0, right: dir === 'rtl' ? undefined : 0, left: dir === 'rtl' ? 0 : undefined, textStyle: { color: tk('ink-2') }, itemWidth: 10, itemHeight: 10 },
        tooltip: {
          trigger: 'axis',
          valueFormatter: (v: number) => (v == null ? '—' : anyMoney ? fmt.money(Math.round(v * 10 ** currencyDigits(base)), base) : fmt.number(v)),
        },
        xAxis: { type: 'category', data: labels, inverse: dir === 'rtl', axisLine: { lineStyle: { color: tk('line-strong') } }, axisLabel: { color: tk('ink-3') } },
        yAxis: {
          type: 'value',
          position: dir === 'rtl' ? 'right' : 'left',
          minInterval: anyMoney ? undefined : 1,
          splitLine: { lineStyle: { color: tk('line') } },
          axisLabel: { color: tk('ink-3'), formatter: (v: number) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(v) },
        },
        series: series.map((s) => ({
          name: s.name,
          type: s.type,
          stack: s.stack,
          data: s.data.map((v) => val(v, s.money)),
          connectNulls: true,
          // No smoothing: curves would invent values between months (and dip below zero).
          smooth: false,
          symbolSize: 5,
          barMaxWidth: 18,
          itemStyle: { color: tk(s.color), borderRadius: s.type === 'bar' ? [3, 3, 0, 0] : undefined },
          lineStyle: s.type === 'line' ? { color: tk(s.color), width: 2 } : undefined,
          areaStyle: s.area ? { color: tk(s.color), opacity: 0.12 } : undefined,
        })),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...deps, dir, fmt, base],
  );
}
