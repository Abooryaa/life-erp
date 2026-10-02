import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Chart } from '../../components/Chart';
import { Button } from '../../components/ui/button';
import { ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { PageHeader, Panel, Stat } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { MissingRates, Money } from '../finance/fin-lib';
import { useAxisChart, useMonthLabel } from './insights-lib';

export interface Analytics {
  base: string;
  months: string[];
  money: { income: number[]; expenses: number[]; net: number[]; savingsRate: (number | null)[] };
  netWorth: (number | null)[];
  tasks: { done: number[]; created: number[] };
  goals: { checkins: number[]; health: Record<string, number>; active: number };
  business: { wonValue: number[] };
  career: { applications: number[]; interviews: number[]; achievements: number[]; learningCompleted: number[] };
  missingRates: string[];
}

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

export function AnalyticsPage() {
  const { t, fmt } = useI18n();
  const label = useMonthLabel();
  const [months, setMonths] = useState(12);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['insights', 'analytics', months], queryFn: () => api.get<Analytics>(`/api/analytics?months=${months}`) });
  const labels = (data?.months ?? []).map(label);
  const base = data?.base ?? 'EGP';
  const money = useAxisChart(
    labels,
    data
      ? [
          { name: t('fin.income'), type: 'bar', data: data.money.income, color: 'pos', money: true },
          { name: t('fin.expenses'), type: 'bar', data: data.money.expenses, color: 'neg', money: true },
          { name: t('fin.savings'), type: 'line', data: data.money.net, color: 'accent', money: true },
        ]
      : [],
    base,
    [data, t],
  );
  const worth = useAxisChart(labels, data ? [{ name: t('nw.netWorth'), type: 'line', data: data.netWorth, color: 'accent', money: true, area: true }] : [], base, [data, t]);
  const work = useAxisChart(
    labels,
    data
      ? [
          { name: t('an.tasksDone'), type: 'bar', data: data.tasks.done, color: 'pos' },
          { name: t('an.tasksCreated'), type: 'line', data: data.tasks.created, color: 'ink-3' },
          { name: t('an.checkins'), type: 'line', data: data.goals.checkins, color: 'accent' },
        ]
      : [],
    base,
    [data, t],
  );
  const business = useAxisChart(labels, data ? [{ name: t('an.wonValue'), type: 'bar', data: data.business.wonValue, color: 'warn', money: true }] : [], base, [data, t]);
  const career = useAxisChart(
    labels,
    data
      ? [
          { name: t('an.applications'), type: 'bar', data: data.career.applications, color: 'accent', stack: 'c' },
          { name: t('car.interviews'), type: 'bar', data: data.career.interviews, color: 'ink-3', stack: 'c' },
          { name: t('car.achievements'), type: 'line', data: data.career.achievements, color: 'pos' },
          { name: t('an.learningDone'), type: 'line', data: data.career.learningCompleted, color: 'warn' },
        ]
      : [],
    base,
    [data, t],
  );
  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock error={error ?? 'No data'} onRetry={refetch} />;
  const rates = data.money.savingsRate.filter((r): r is number => r != null);
  const healthOrder = ['on_track', 'at_risk', 'behind', 'overdue', 'no_deadline', 'no_target'];
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('an.title')}
        subtitle={t('an.subtitle')}
        actions={
          <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
            {[6, 12, 24].map((m) => (
              <Button key={m} size="sm" variant={months === m ? 'subtle' : 'ghost'} onClick={() => setMonths(m)}>
                {t('an.months', { n: m })}
              </Button>
            ))}
          </div>
        }
      />
      <MissingRates list={data.missingRates} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Panel>
          <Stat label={t('an.totalSaved')} value={<Money minor={sum(data.money.net)} currency={base} compact />} tone={sum(data.money.net) >= 0 ? 'pos' : 'neg'} />
        </Panel>
        <Panel>
          <Stat label={t('an.avgSavingsRate')} value={rates.length ? fmt.percent(sum(rates) / rates.length) : '—'} />
        </Panel>
        <Panel>
          <Stat label={t('an.tasksDone')} value={fmt.number(sum(data.tasks.done))} hint={t('an.created', { n: sum(data.tasks.created) })} />
        </Panel>
        <Panel>
          <Stat label={t('an.wonValue')} value={<Money minor={sum(data.business.wonValue)} currency={base} compact />} />
        </Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={t('an.money')}>
          <Chart option={money} height={260} ariaLabel={t('an.money')} />
        </Panel>
        <Panel title={t('nw.netWorth')}>
          {data.netWorth.filter((x) => x != null).length < 2 ? <p className="py-10 text-center text-[13px] text-ink-3">{t('nw.historyEmpty')}</p> : <Chart option={worth} height={260} ariaLabel={t('nw.netWorth')} />}
        </Panel>
        <Panel title={t('an.productivity')}>
          <Chart option={work} height={240} ariaLabel={t('an.productivity')} />
        </Panel>
        <Panel title={t('an.goalHealth')}>
          {data.goals.active === 0 ? (
            <p className="py-10 text-center text-[13px] text-ink-3">{t('an.noGoals')}</p>
          ) : (
            <ul className="space-y-2.5">
              {healthOrder
                .filter((k) => data.goals.health[k])
                .map((k) => (
                  <li key={k} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-[13px] text-ink-2">{t(`an.health.${k}` as MessageKey)}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={k === 'on_track' ? 'h-full bg-pos' : k === 'at_risk' ? 'h-full bg-warn' : k === 'no_target' || k === 'no_deadline' ? 'h-full bg-ink-3' : 'h-full bg-neg'}
                        style={{ width: `${(data.goals.health[k] / data.goals.active) * 100}%` }}
                      />
                    </div>
                    <span className="num w-6 text-end text-[13px]">{data.goals.health[k]}</span>
                  </li>
                ))}
            </ul>
          )}
        </Panel>
        <Panel title={t('an.business')}>
          <Chart option={business} height={240} ariaLabel={t('an.business')} />
        </Panel>
        <Panel title={t('car.title')}>
          <Chart option={career} height={240} ariaLabel={t('car.title')} />
        </Panel>
      </div>
    </div>
  );
}
