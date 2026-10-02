import { minorToInput } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Chart } from '../../components/Chart';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, NoFieldId, Select, Textarea, TextField } from '../../components/ui/form';
import { PageHeader, Panel, Stat } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { AmountInput, MissingRates, Money } from '../finance/fin-lib';
import { INSIGHT_KEYS, useAxisChart, useMonthLabel } from './insights-lib';

interface Adjustment {
  label: string;
  amount: number;
  kind: 'monthly' | 'once';
  startMonth: number;
  endMonth: number | null;
}

interface Scenario {
  id: string;
  name: string;
  horizonMonths: number;
  monthlyIncome: number | null;
  monthlyExpenses: number | null;
  startBalance: number | null;
  adjustments: Adjustment[];
  notes: string | null;
  baseline: { base: string; monthsWithData: number; monthlyIncome: number; monthlyExpenses: number; startBalance: number; firstMonth: string; missingRates: string[] };
  inputs: { monthlyIncome: number; monthlyExpenses: number; startBalance: number };
  result: {
    months: { index: number; month: string; income: number; expenses: number; net: number; balance: number; items: { label: string; amount: number }[] }[];
    endBalance: number;
    lowest: { month: string; balance: number };
    firstNegative: string | null;
  };
}

export function ScenariosPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['insights', 'scenarios'], queryFn: () => api.get<Scenario[]>('/api/scenarios') });
  const label = useMonthLabel();
  const f = useFormState({ name: '' });
  const create = useAction(() => api.post<Scenario>('/api/scenarios', { name: f.values.name }), { invalidate: INSIGHT_KEYS, silentFieldErrors: true, onSuccess: (s) => navigate(`/scenarios/${s.id}`) });
  return (
    <div>
      <PageHeader
        title={t('sc.title')}
        subtitle={t('sc.subtitle')}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('sc.new')}
          </Button>
        }
      />
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : !data.length ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Sparkles className="size-5" />} title={t('sc.empty')} body={t('sc.emptyBody')} action={<Button variant="primary" onClick={() => setCreating(true)}>{t('sc.new')}</Button>} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((s) => (
            <Link key={s.id} to={`/scenarios/${s.id}`} className="rounded-card border border-line bg-surface p-4 shadow-card hover:border-line-strong">
              <p className="font-semibold">{s.name}</p>
              <p className="text-[12.5px] text-ink-3">{t('sc.months', { n: s.horizonMonths })}</p>
              <div className="mt-3 flex items-end justify-between gap-2">
                <div>
                  <p className="text-[12px] text-ink-3">{t('sc.endBalance')}</p>
                  <Money minor={s.result.endBalance} currency={s.baseline.base} compact colored className="text-[18px] font-semibold" />
                </div>
                {s.result.firstNegative && (
                  <span className="inline-flex items-center gap-1 text-[12px] text-neg">
                    <AlertTriangle className="size-3.5" />
                    {t('sc.negativeIn', { month: label(s.result.firstNegative) })}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title={t('sc.new')}
        size="sm"
        footer={
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate(undefined, { onError: f.fail })}>
            {t('common.create')}
          </Button>
        }
      >
        <TextField label={t('common.name')} value={f.values.name} onChange={(e) => f.set('name', e.target.value)} error={f.errors.name} placeholder={t('sc.namePh')} autoFocus />
      </Modal>
    </div>
  );
}

type AdjForm = { label: string; amount: string; kind: 'monthly' | 'once'; startMonth: string; endMonth: string };

export function ScenarioDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const label = useMonthLabel();
  const [del, setDel] = useState(false);
  const { data: s, isLoading, error, refetch } = useQuery({ queryKey: ['insights', 'scenario', id], queryFn: () => api.get<Scenario>(`/api/scenarios/${id}`) });
  const base = s?.baseline.base ?? 'EGP';
  const form = useFormState({ name: '', horizonMonths: '12', monthlyIncome: '', monthlyExpenses: '', startBalance: '', notes: '', adjustments: [] as AdjForm[] });
  useEffect(() => {
    if (!s) return;
    const m = (x: number | null) => (x == null ? '' : minorToInput(x, base));
    form.setValues({
      name: s.name,
      horizonMonths: String(s.horizonMonths),
      monthlyIncome: m(s.monthlyIncome),
      monthlyExpenses: m(s.monthlyExpenses),
      startBalance: m(s.startBalance),
      notes: s.notes ?? '',
      adjustments: s.adjustments.map((a) => ({ label: a.label, amount: minorToInput(a.amount, base), kind: a.kind, startMonth: String(a.startMonth), endMonth: a.endMonth == null ? '' : String(a.endMonth) })),
    });
  }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const save = useAction(
    () =>
      api.put(`/api/scenarios/${id}`, {
        name: v.name,
        horizonMonths: Number(v.horizonMonths) || 12,
        monthlyIncome: v.monthlyIncome || null,
        monthlyExpenses: v.monthlyExpenses || null,
        startBalance: v.startBalance || null,
        notes: v.notes || null,
        adjustments: v.adjustments.map((a) => ({ label: a.label, amount: a.amount || '0', kind: a.kind, startMonth: Number(a.startMonth) || 1, endMonth: a.kind === 'monthly' && a.endMonth ? Number(a.endMonth) : null })),
      }),
    { invalidate: INSIGHT_KEYS, silentFieldErrors: true, success: t('sc.recalculated') },
  );
  const remove = useAction(() => api.del(`/api/scenarios/${id}`), { invalidate: INSIGHT_KEYS, onSuccess: () => navigate('/scenarios') });
  const months = s?.result.months ?? [];
  const chart = useAxisChart(
    months.map((m) => label(m.month)),
    [
      { name: t('sc.balance'), type: 'line', data: months.map((m) => m.balance), color: 'accent', money: true, area: true },
      { name: t('fin.income'), type: 'bar', data: months.map((m) => m.income), color: 'pos', money: true },
      { name: t('fin.expenses'), type: 'bar', data: months.map((m) => m.expenses), color: 'neg', money: true },
    ],
    base,
    [s, t],
  );
  if (isLoading) return <LoadingBlock />;
  if (error || !s) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;
  const setAdj = (i: number, patch: Partial<AdjForm>) => form.set('adjustments', v.adjustments.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const err = (path: string) => form.errors[path];
  const b = s.baseline;
  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link to="/scenarios" className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t('sc.title')}
          </Link>
        }
        title={s.name}
        subtitle={t('sc.from', { month: label(b.firstMonth), n: s.horizonMonths })}
        actions={
          <Button variant="ghost" size="icon" onClick={() => setDel(true)} aria-label={t('common.delete')}>
            <Trash2 className="size-4 text-neg" />
          </Button>
        }
      />
      <MissingRates list={b.missingRates} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Panel>
          <Stat label={t('sc.startBalance')} value={<Money minor={s.inputs.startBalance} currency={base} compact />} />
        </Panel>
        <Panel>
          <Stat label={t('sc.endBalance')} value={<Money minor={s.result.endBalance} currency={base} compact />} tone={s.result.endBalance >= 0 ? 'pos' : 'neg'} />
        </Panel>
        <Panel>
          <Stat label={t('sc.lowest')} value={<Money minor={s.result.lowest.balance} currency={base} compact />} hint={label(s.result.lowest.month)} tone={s.result.lowest.balance < 0 ? 'neg' : undefined} />
        </Panel>
        <Panel>
          <Stat label={t('sc.monthlyNet')} value={<Money minor={s.inputs.monthlyIncome - s.inputs.monthlyExpenses} currency={base} compact />} hint={t('sc.beforeAdjustments')} />
        </Panel>
      </div>
      {s.result.firstNegative && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-neg/30 bg-neg-soft px-3 py-2 text-[13px] text-neg">
          <AlertTriangle className="size-4 shrink-0" />
          {t('sc.negativeWarning', { month: label(s.result.firstNegative) })}
        </p>
      )}
      <Panel title={t('sc.projection')}>
        <Chart option={chart} height={280} ariaLabel={t('sc.projection')} />
      </Panel>
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title={t('sc.assumptions')}>
          <div className="space-y-4">
            <FormError message={form.formError} />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <TextField label={t('common.name')} value={v.name} onChange={(e) => form.set('name', e.target.value)} error={form.errors.name} />
              <Field label={t('sc.horizon')} error={form.errors.horizonMonths}>
                <Select value={v.horizonMonths} onChange={(e) => form.set('horizonMonths', e.target.value)}>
                  {[3, 6, 12, 18, 24, 36, 60].map((n) => (
                    <option key={n} value={n}>
                      {t('sc.months', { n })}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('sc.monthlyIncome')} hint={t('sc.default', { v: fmt.money(b.monthlyIncome, base) })} error={form.errors.monthlyIncome}>
                <AmountInput value={v.monthlyIncome} onChange={(e) => form.set('monthlyIncome', e.target.value)} currency={base} placeholder={minorToInput(b.monthlyIncome, base)} />
              </Field>
              <Field label={t('sc.monthlyExpenses')} hint={t('sc.default', { v: fmt.money(b.monthlyExpenses, base) })} error={form.errors.monthlyExpenses}>
                <AmountInput value={v.monthlyExpenses} onChange={(e) => form.set('monthlyExpenses', e.target.value)} currency={base} placeholder={minorToInput(b.monthlyExpenses, base)} />
              </Field>
              <Field label={t('sc.startBalance')} hint={t('sc.defaultCash', { v: fmt.money(b.startBalance, base) })} error={form.errors.startBalance}>
                <AmountInput value={v.startBalance} onChange={(e) => form.set('startBalance', e.target.value)} currency={base} placeholder={minorToInput(b.startBalance, base)} />
              </Field>
            </div>
            <p className="text-[12px] text-ink-3">{b.monthsWithData ? t('sc.baselineNote', { n: b.monthsWithData }) : t('sc.noHistory')}</p>
            <div>
              <p className="mb-2 text-[13px] font-medium text-ink-2">{t('sc.changes')}</p>
              <NoFieldId>
                <div className="space-y-2">
                  {v.adjustments.map((a, i) => (
                    <div key={i} className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_64px_64px_auto] gap-2 rounded-lg border border-line p-2">
                      <Input className="col-span-5" value={a.label} onChange={(e) => setAdj(i, { label: e.target.value })} placeholder={t('sc.changeLabel')} aria-label={t('sc.changeLabel')} invalid={!!err(`adjustments.${i}.label`)} />
                      <AmountInput value={a.amount} onChange={(e) => setAdj(i, { amount: e.target.value })} currency={base} aria-label={t('sc.amount')} placeholder="-5000" invalid={!!err(`adjustments.${i}.amount`)} />
                      <Select value={a.kind} onChange={(e) => setAdj(i, { kind: e.target.value as AdjForm['kind'] })} aria-label={t('common.type')}>
                        <option value="monthly">{t('sc.kind.monthly')}</option>
                        <option value="once">{t('sc.kind.once')}</option>
                      </Select>
                      <Input type="number" min={1} max={120} value={a.startMonth} onChange={(e) => setAdj(i, { startMonth: e.target.value })} aria-label={t('sc.startMonth')} title={t('sc.startMonth')} />
                      <Input type="number" min={1} max={120} value={a.endMonth} disabled={a.kind === 'once'} onChange={(e) => setAdj(i, { endMonth: e.target.value })} aria-label={t('sc.endMonth')} title={t('sc.endMonth')} placeholder="∞" invalid={!!err(`adjustments.${i}.endMonth`)} />
                      <Button size="icon-sm" variant="ghost" onClick={() => form.set('adjustments', v.adjustments.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </NoFieldId>
              <p className="mt-1 text-[12px] text-ink-3">{t('sc.changesHint')}</p>
              <Button className="mt-2" size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => form.set('adjustments', [...v.adjustments, { label: '', amount: '', kind: 'monthly', startMonth: '1', endMonth: '' }])}>
                {t('sc.addChange')}
              </Button>
            </div>
            <Field label={t('common.notes')} optional>
              <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={2} />
            </Field>
            <div className="flex justify-end">
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
                {t('sc.recalculate')}
              </Button>
            </div>
          </div>
        </Panel>
        <Panel title={t('sc.monthByMonth')} padded={false}>
          <div className="max-h-[560px] overflow-auto scrollbar-thin">
            <table className="w-full text-[13px] whitespace-nowrap">
              <thead className="sticky top-0 bg-surface text-[12px] text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-start font-medium">{t('sc.month')}</th>
                  <th className="px-3 py-2 text-end font-medium">{t('fin.income')}</th>
                  <th className="px-3 py-2 text-end font-medium">{t('fin.expenses')}</th>
                  <th className="px-3 py-2 text-end font-medium">{t('sc.balance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {months.map((m) => (
                  <tr key={m.month} title={m.items.map((x) => `${x.label}: ${fmt.money(x.amount, base, { sign: true })}`).join('\n') || undefined}>
                    <td className="px-3 py-2">
                      {label(m.month)}
                      {m.items.length > 0 && <span className="ms-1 text-[11px] text-accent">•{m.items.length}</span>}
                    </td>
                    <td className="num px-3 py-2 text-end">{fmt.money(m.income, base, { compact: true })}</td>
                    <td className="num px-3 py-2 text-end">{fmt.money(m.expenses, base, { compact: true })}</td>
                    <td className={clsx('num px-3 py-2 text-end font-medium', m.balance < 0 && 'text-neg')}>{fmt.money(m.balance, base, { compact: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: s.name })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}
