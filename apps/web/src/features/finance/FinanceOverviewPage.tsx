import { currencyDigits, fromMinor, monthEnd } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarClock, Landmark, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { Chart } from '../../components/Chart';
import { Button } from '../../components/ui/button';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useWorkspace } from '../../lib/workspace';
import { useUI } from '../../layout/ui-context';
import { AccountFormModal } from './AccountsPage';
import { accountTypeLabel, currentMonth, MissingRates, Money, MonthNav, type Account } from './fin-lib';

interface MonthTotals {
  month: string;
  income: number;
  expenses: number;
  net: number;
  savingsRate: number | null;
}
interface Overview {
  today: string;
  month: string;
  base: string;
  current: MonthTotals;
  previous: MonthTotals;
  series: MonthTotals[];
  categories: { total: number; items: { id: string; name: string; nameAr: string | null; color: string | null; total: number }[]; missingRates: string[] };
  net: { liquid: number; assets: number; liabilities: number; netWorth: number; receivables: number; installmentsRemaining: number; debtsOwed: number; accountLiabilities: number; missingRates: string[] };
  upcoming: { id: string; kind: string; date: string; name: string; amount: number; currency: string; direction: 'in' | 'out'; overdue: boolean; link: string }[];
  accounts: Account[];
  missingRates: string[];
}

function Delta({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  const { t, fmt } = useI18n();
  if (!before) return null;
  const change = (now - before) / Math.abs(before);
  const good = invert ? change <= 0 : change >= 0;
  return (
    <span className={clsx('text-[12px] font-medium', good ? 'text-pos' : 'text-neg')}>
      {change >= 0 ? '▲' : '▼'} {fmt.percent(Math.abs(change))} <span className="font-normal text-ink-3">{t('fin.vsLastMonth')}</span>
    </span>
  );
}

export function FinanceOverviewPage() {
  const { t, fmt, locale, dir } = useI18n();
  const ui = useUI();
  const { currentId } = useWorkspace();
  const [month, setMonth] = useState(currentMonth());
  const [addAccount, setAddAccount] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['finance', 'overview', month, currentId],
    queryFn: () => api.get<Overview>(`/api/finance/overview${qs({ month, workspaceId: currentId })}`),
  });

  const trend = useCallback(
    (tk: (n: string) => string) => {
      const s = data?.series ?? [];
      const labels = s.map((m) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m.month}-15T12:00:00Z`)));
      return {
        grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
        legend: { top: 0, right: dir === 'rtl' ? undefined : 0, left: dir === 'rtl' ? 0 : undefined, textStyle: { color: tk('ink-2') }, itemWidth: 10, itemHeight: 10 },
        tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmt.money(Math.round(v * 10 ** currencyDigits(data?.base ?? 'EGP')), data?.base) },
        xAxis: { type: 'category', data: labels, inverse: dir === 'rtl', axisLine: { lineStyle: { color: tk('line-strong') } }, axisLabel: { color: tk('ink-3') } },
        yAxis: {
          type: 'value',
          position: dir === 'rtl' ? 'right' : 'left',
          splitLine: { lineStyle: { color: tk('line') } },
          axisLabel: { color: tk('ink-3'), formatter: (v: number) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(v) },
        },
        series: [
          { name: t('fin.income'), type: 'bar', data: s.map((m) => fromMinor(m.income, data?.base)), itemStyle: { color: tk('pos'), borderRadius: [3, 3, 0, 0] }, barGap: '10%', barMaxWidth: 18 },
          { name: t('fin.expenses'), type: 'bar', data: s.map((m) => fromMinor(m.expenses, data?.base)), itemStyle: { color: tk('neg'), borderRadius: [3, 3, 0, 0] }, barMaxWidth: 18 },
          { name: t('fin.savings'), type: 'line', data: s.map((m) => fromMinor(m.net, data?.base)), smooth: true, symbolSize: 5, lineStyle: { color: tk('accent'), width: 2 }, itemStyle: { color: tk('accent') } },
        ],
      };
    },
    [data, locale, dir, fmt, t],
  );

  const donut = useCallback(
    (tk: (n: string) => string) => ({
      tooltip: { trigger: 'item', valueFormatter: (v: number) => fmt.money(Math.round(v * 10 ** currencyDigits(data?.base ?? 'EGP')), data?.base) },
      series: [
        {
          type: 'pie',
          radius: ['58%', '85%'],
          avoidLabelOverlap: true,
          label: { show: false },
          itemStyle: { borderColor: tk('surface'), borderWidth: 2 },
          data: (data?.categories.items ?? []).map((c) => ({ name: locale === 'ar' && c.nameAr ? c.nameAr : c.name, value: fromMinor(c.total, data?.base), itemStyle: { color: c.color ?? tk('ink-3') } })),
        },
      ],
    }),
    [data, locale, fmt],
  );

  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock error={error ?? 'No data'} onRetry={refetch} />;

  const c = data.current;
  const p = data.previous;
  const noAccounts = data.accounts.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('fin.overview')}
        actions={
          <>
            <MonthNav month={month} onChange={setMonth} />
            <div className="hidden gap-2 md:flex">
              <Button icon={<ArrowUpRight className="size-4 text-neg" />} onClick={() => ui.openTransaction('expense')}>
                {t('quick.expense')}
              </Button>
              <Button icon={<ArrowDownLeft className="size-4 text-pos" />} onClick={() => ui.openTransaction('income')}>
                {t('quick.income')}
              </Button>
              <Button icon={<ArrowLeftRight className="size-4 text-info" />} onClick={() => ui.openTransaction('transfer')}>
                {t('quick.transfer')}
              </Button>
            </div>
          </>
        }
      />

      {noAccounts && (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState
            icon={<Landmark className="size-5" />}
            title={t('acc.empty')}
            body={t('fin.getStarted')}
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAddAccount(true)}>
                {t('fin.addAccount')}
              </Button>
            }
          />
        </div>
      )}

      <MissingRates list={[...new Set([...data.missingRates, ...data.net.missingRates, ...data.categories.missingRates])]} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label={t('fin.income')} value={<Money minor={c.income} currency={data.base} />} extra={<Delta now={c.income} before={p.income} />} />
        <Kpi label={t('fin.expenses')} value={<Money minor={c.expenses} currency={data.base} />} extra={<Delta now={c.expenses} before={p.expenses} invert />} />
        <Kpi label={t('fin.savings')} value={<Money minor={c.net} currency={data.base} colored />} extra={c.savingsRate != null ? <span className="text-[12px] text-ink-3">{t('fin.savingsRate')} {fmt.percent(c.savingsRate)}</span> : null} />
        <Kpi label={t('fin.cash')} value={<Money minor={data.net.liquid} currency={data.base} />} extra={<Link to="/finance/net-worth" className="text-[12px] text-ink-3 hover:underline">{t('fin.netWorth')} <Money minor={data.net.netWorth} currency={data.base} compact /></Link>} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t('fin.trend')} className="lg:col-span-2">
          <Chart option={trend} height={260} ariaLabel={t('fin.trend')} />
        </Panel>
        <Panel title={t('fin.byCategory')}>
          {data.categories.items.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-3">{t('fin.noData')}</p>
          ) : (
            <>
              <Chart option={donut} height={170} ariaLabel={t('fin.byCategory')} />
              <ul className="mt-3 space-y-1.5">
                {data.categories.items.slice(0, 6).map((cat) => (
                  <li key={cat.id}>
                    <Link to={`/finance/transactions${qs({ categoryId: cat.id === 'uncategorized' ? '' : cat.id, from: `${month}-01`, to: monthEnd(month) })}`} className="flex items-center gap-2 text-[13px] hover:underline">
                      <span className="size-2.5 rounded-full" style={{ background: cat.color ?? '#94a3b8' }} />
                      <span className="min-w-0 flex-1 truncate">{locale === 'ar' && cat.nameAr ? cat.nameAr : cat.name}</span>
                      <span className="text-ink-3">{fmt.percent(cat.total / (data.categories.total || 1))}</span>
                      <Money minor={cat.total} currency={data.base} className="shrink-0 text-end" compact />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t('fin.upcoming')} padded={false} className="lg:col-span-2">
          {data.upcoming.length === 0 ? (
            <p className="flex items-center gap-2 p-4 text-[13.5px] text-ink-3">
              <CalendarClock className="size-4" />
              {t('fin.noUpcoming')}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {data.upcoming.slice(0, 10).map((u) => (
                <li key={`${u.kind}:${u.id}`}>
                  <Link to={u.link} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <span className="num w-20 shrink-0 text-[12.5px] text-ink-3">{fmt.date(u.date)}</span>
                    <span className="min-w-0 flex-1 truncate">{u.name}</span>
                    {u.overdue ? <Badge tone="neg">{t('fin.overdue')}</Badge> : u.date === data.today ? <Badge tone="warn">{t('fin.dueToday')}</Badge> : null}
                    <Money minor={u.direction === 'in' ? u.amount : -u.amount} currency={u.currency} colored />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title={t('acc.title')}
          padded={false}
          actions={
            <Link to="/finance/accounts" className="text-[13px] font-medium text-accent hover:underline">
              {t('common.open')}
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {data.accounts.map((a) => (
              <li key={a.id}>
                <Link to={`/finance/accounts/${a.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{a.name}</p>
                    <p className="text-[12px] text-ink-3">{accountTypeLabel(t, a.type)}</p>
                  </div>
                  <Money minor={a.balance} currency={a.currency} colored={a.balance < 0} />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <AccountFormModal open={addAccount} onOpenChange={setAddAccount} />
    </div>
  );
}

function Kpi({ label, value, extra }: { label: string; value: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-surface p-4 shadow-card">
      <p className="text-[12.5px] font-medium text-ink-3">{label}</p>
      <p className="mt-1 truncate text-[clamp(15px,4.4vw,21px)] font-semibold">{value}</p>
      <div className="mt-0.5 min-h-4 truncate">{extra}</div>
    </div>
  );
}
