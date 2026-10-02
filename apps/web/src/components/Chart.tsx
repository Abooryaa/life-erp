import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export type ChartOption = echarts.EChartsCoreOption;

/** Read a design token so charts follow light/dark mode. */
export function token(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

/**
 * Thin ECharts wrapper: resizes with its container, re-themes with dark mode,
 * and mirrors for Arabic.
 */
export function Chart({ option, height = 260, ariaLabel }: { option: (t: typeof token) => ChartOption; height?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const { dir } = useI18n();

  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const apply = () => {
      const base = option(token);
      chart.current?.setOption(
        {
          textStyle: { fontFamily: getComputedStyle(document.body).fontFamily, color: token('ink-2') },
          animationDuration: 300,
          ...base,
        },
        true,
      );
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, [option, dir]);

  return <div ref={ref} style={{ height }} role="img" aria-label={ariaLabel} />;
}
