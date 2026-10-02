import { goalForecast, minorToInput, toMinor } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Target, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea, TextField } from '../../components/ui/form';
import { DataRow, PageHeader, Panel, Stat } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { AmountInput, Bar, FIN_KEYS, MissingRates, Money, todayIso, useAccounts, useCurrencies } from './fin-lib';

interface Forecast {
  remaining: number;
  progress: number;
  monthsToTarget: number | null;
  eta: string | null;
  requiredMonthly: number | null;
  monthsToDeadline: number | null;
  onTrack: boolean | null;
  achieved: boolean;
}
interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currency: string;
  deadline: string | null;
  priority: number;
  mode: 'accounts' | 'manual';
  monthlyTarget: number | null;
  startingAmount: number;
  workspaceId: string | null;
  color: string | null;
  status: 'active' | 'achieved' | 'paused';
  notes: string | null;
  current: number;
  monthlyRate: number;
  accountIds: string[];
  forecast: Forecast;
  plannedForecast: Forecast | null;
  missingRates: string[];
  contributions?: { id: string; date: string; amount: number; note: string | null }[];
}

function StatusBadge({ g }: { g: Goal }) {
  const { t } = useI18n();
  if (g.status === 'achieved' || g.forecast.achieved) return <Badge tone="pos">{t('goal.achieved')}</Badge>;
  if (g.status === 'paused') return <Badge>{t('goal.paused')}</Badge>;
  if (g.forecast.onTrack === true) return <Badge tone="pos">{t('goal.onTrack')}</Badge>;
  if (g.forecast.onTrack === false) return <Badge tone="warn">{t('goal.behind')}</Badge>;
  return null;
}

export function GoalsPage() {
  const { t, fmt } = useI18n();
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'goals'], queryFn: () => api.get<{ goals: Goal[]; averageSavings: { base: string; average: number } }>('/api/finance/goals') });
  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock error={error ?? 'No data'} onRetry={refetch} />;
  return (
    <div>
      <PageHeader
        title={t('goal.title')}
        subtitle={t('goal.avgSavings', { amount: fmt.money(data.averageSavings.average, data.averageSavings.base) })}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('goal.new')}
          </Button>
        }
      />
      {data.goals.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Target className="size-5" />} title={t('goal.empty')} body={t('goal.emptyBody')} action={<Button variant="primary" onClick={() => setCreating(true)}>{t('goal.new')}</Button>} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.goals.map((g) => (
            <Link key={g.id} to={`/finance/goals/${g.id}`} className="rounded-card border border-line bg-surface p-4 shadow-card hover:border-line-strong">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{g.name}</p>
                <StatusBadge g={g} />
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <Money minor={g.current} currency={g.currency} className="text-[18px] font-semibold" />
                <span className="text-[12.5px] text-ink-3">/ {fmt.money(g.targetAmount, g.currency)}</span>
              </div>
              <div className="mt-2">
                <Bar ratio={g.forecast.progress} tone={g.forecast.achieved ? 'pos' : g.forecast.onTrack === false ? 'warn' : 'accent'} />
              </div>
              <p className="mt-2 text-[12.5px] text-ink-3">
                {g.forecast.eta ? `${t('goal.eta')} ${fmt.date(g.forecast.eta)}` : g.forecast.achieved ? t('goal.achieved') : '—'}
                {g.deadline ? ` · ${t('goal.deadline')} ${fmt.date(g.deadline)}` : ''}
              </p>
            </Link>
          ))}
        </div>
      )}
      <GoalFormModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}

export function GoalDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [extra, setExtra] = useState('');
  const { data: g, isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'goals', id], queryFn: () => api.get<Goal>(`/api/finance/goals/${id}`) });
  const contrib = useFormState({ date: todayIso(), amount: '', note: '' });
  const add = useAction(() => api.post(`/api/finance/goals/${id}/contributions`, { ...contrib.values, note: contrib.values.note || null }), {
    invalidate: FIN_KEYS,
    silentFieldErrors: true,
    onSuccess: () => contrib.set('amount', ''),
  });
  const delC = useAction((cid: string) => api.del(`/api/finance/goals/${id}/contributions/${cid}`), { invalidate: FIN_KEYS });
  const status = useAction((s: string) => api.post(`/api/finance/goals/${id}/status`, { status: s }), { invalidate: FIN_KEYS });
  const remove = useAction(() => api.del(`/api/finance/goals/${id}`), { invalidate: FIN_KEYS, onSuccess: () => navigate('/finance/goals') });

  // What-if runs locally with the same shared formula the server uses — nothing is saved.
  const scenario = useMemo(() => {
    if (!g) return null;
    const extraMinor = toMinor(extra || '0', g.currency);
    if (!extraMinor || extraMinor <= 0) return null;
    return goalForecast({ target: g.targetAmount, current: g.current, monthlyRate: g.monthlyRate, extraMonthly: extraMinor, today: todayIso(), deadline: g.deadline });
  }, [g, extra]);

  if (isLoading) return <LoadingBlock />;
  if (error || !g) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;
  const f = g.forecast;
  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link to="/finance/goals" className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t('goal.title')}
          </Link>
        }
        title={g.name}
        subtitle={<StatusBadge g={g} />}
        actions={
          <>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
              {t('common.edit')}
            </Button>
            {g.status === 'active' ? <Button onClick={() => status.mutate('paused')}>{t('rec.pause')}</Button> : <Button onClick={() => status.mutate('active')}>{t('rec.resume')}</Button>}
            <Button variant="ghost" size="icon" onClick={() => setDel(true)} aria-label={t('common.delete')}>
              <Trash2 className="size-4 text-neg" />
            </Button>
          </>
        }
      />
      <MissingRates list={g.missingRates} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Panel>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label={t('goal.current')} value={<Money minor={g.current} currency={g.currency} />} hint={fmt.percent(f.progress)} />
              <Stat label={t('goal.remaining')} value={<Money minor={f.remaining} currency={g.currency} />} />
              <Stat label={t('goal.rate')} value={<Money minor={g.monthlyRate} currency={g.currency} compact />} hint="/ 3 months" />
              <Stat label={t('goal.target')} value={<Money minor={g.targetAmount} currency={g.currency} />} hint={g.deadline ? fmt.date(g.deadline) : undefined} />
            </div>
            <div className="mt-4">
              <Bar ratio={f.progress} tone={f.achieved ? 'pos' : f.onTrack === false ? 'warn' : 'accent'} />
            </div>
            <div className="mt-4 space-y-2 text-[13.5px]">
              {f.achieved ? (
                <p className="font-medium text-pos">{t('goal.achieved')}</p>
              ) : f.eta ? (
                <p>
                  {t('goal.eta')} <strong>{t('goal.monthsLeft', { n: f.monthsToTarget ?? 0, date: fmt.date(f.eta) })}</strong>
                </p>
              ) : (
                <p className="text-warn">{t('goal.etaNever')}</p>
              )}
              {f.requiredMonthly != null && !f.achieved && (
                <p>
                  {t('goal.required')}: <Money minor={f.requiredMonthly} currency={g.currency} className="font-semibold" />
                </p>
              )}
              {g.plannedForecast && g.plannedForecast.eta && (
                <p className="text-ink-2">
                  {t('goal.planned', { amount: fmt.money(g.monthlyTarget ?? 0, g.currency) })}: {t('goal.monthsLeft', { n: g.plannedForecast.monthsToTarget ?? 0, date: fmt.date(g.plannedForecast.eta) })}
                </p>
              )}
            </div>
          </Panel>
          <Panel title={t('goal.whatIf')}>
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('goal.extraMonthly')} className="w-56">
                <AmountInput value={extra} onChange={(e) => setExtra(e.target.value)} currency={g.currency} />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {[1000, 2500, 5000, 10000].map((x) => (
                  <Button key={x} size="sm" variant="subtle" onClick={() => setExtra(String(x))}>
                    +{fmt.number(x)}
                  </Button>
                ))}
              </div>
            </div>
            <p className="mt-3 text-[13.5px]">
              {scenario?.eta ? (
                <span className="font-medium text-accent">
                  {t('goal.scenarioResult', {
                    n: scenario.monthsToTarget ?? 0,
                    date: fmt.date(scenario.eta),
                    diff: f.monthsToTarget != null && scenario.monthsToTarget != null ? f.monthsToTarget - scenario.monthsToTarget : '—',
                  })}
                </span>
              ) : (
                <span className="text-ink-3">{t('goal.scenarioNever')}</span>
              )}
            </p>
            <p className="mt-1 text-[12px] text-ink-3">{t('goal.scenarioNote')}</p>
          </Panel>
        </div>
        <div className="space-y-5">
          {g.mode === 'manual' && (
            <Panel title={t('goal.contributions')} padded={false}>
              <form
                className="space-y-2 border-b border-line p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  add.mutate(undefined, { onError: contrib.fail });
                }}
              >
                <FormError message={contrib.formError} />
                <div className="grid grid-cols-2 gap-2">
                  <AmountInput value={contrib.values.amount} onChange={(e) => contrib.set('amount', e.target.value)} currency={g.currency} invalid={!!contrib.errors.amount} />
                  <Input type="date" value={contrib.values.date} onChange={(e) => contrib.set('date', e.target.value)} />
                </div>
                <p className="text-[12px] text-ink-3">{t('goal.contributionHint')}</p>
                <Button type="submit" size="sm" variant="primary" loading={add.isPending}>
                  {t('goal.addContribution')}
                </Button>
              </form>
              <ul className="divide-y divide-line">
                {[...(g.contributions ?? [])].reverse().map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="num flex-1 text-[13px]">{fmt.date(c.date)}</span>
                    <Money minor={c.amount} currency={g.currency} colored />
                    <Button size="icon-sm" variant="ghost" onClick={() => delC.mutate(c.id)} aria-label={t('common.delete')}>
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel>
            <dl>
              <DataRow label={t('goal.mode')}>{t(`goal.mode.${g.mode}` as MessageKey)}</DataRow>
              <DataRow label={t('goal.priority')}>{t(`goal.priority.${g.priority}` as MessageKey)}</DataRow>
              {g.startingAmount > 0 && (
                <DataRow label={t('goal.startingAmount')}>
                  <Money minor={g.startingAmount} currency={g.currency} />
                </DataRow>
              )}
            </dl>
            {g.notes && <p className="mt-3 text-[13.5px] whitespace-pre-wrap text-ink-2">{g.notes}</p>}
          </Panel>
        </div>
      </div>
      <GoalFormModal open={edit} onOpenChange={setEdit} goal={g} />
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: g.name })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}

function GoalFormModal({ open, onOpenChange, goal }: { open: boolean; onOpenChange: (o: boolean) => void; goal?: Goal }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { workspaces, currentId } = useWorkspace();
  const { data: currencies = [] } = useCurrencies();
  const { data: accounts = [] } = useAccounts();
  const init = () => ({
    name: goal?.name ?? '',
    targetAmount: goal ? minorToInput(goal.targetAmount, goal.currency) : '',
    currency: goal?.currency ?? 'EGP',
    deadline: goal?.deadline ?? '',
    priority: String(goal?.priority ?? 2),
    mode: goal?.mode ?? ('manual' as Goal['mode']),
    accountIds: goal?.accountIds ?? ([] as string[]),
    monthlyTarget: goal?.monthlyTarget != null ? minorToInput(goal.monthlyTarget, goal.currency) : '',
    startingAmount: goal ? minorToInput(goal.startingAmount, goal.currency) : '0',
    workspaceId: goal?.workspaceId ?? currentId ?? '',
    notes: goal?.notes ?? '',
  });
  const form = useFormState(init());
  useEffect(() => {
    if (open) {
      form.setValues(init());
      form.setErrors({});
      form.setFormError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const save = useAction(
    () => {
      const body = { ...v, priority: Number(v.priority), deadline: v.deadline || null, monthlyTarget: v.monthlyTarget || null, workspaceId: v.workspaceId || null };
      return goal ? api.put<Goal>(`/api/finance/goals/${goal.id}`, body) : api.post<Goal>('/api/finance/goals', body);
    },
    {
      invalidate: FIN_KEYS,
      success: t('common.saved'),
      silentFieldErrors: true,
      onSuccess: (r) => {
        onOpenChange(false);
        if (!goal) navigate(`/finance/goals/${r.id}`);
      },
    },
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={goal ? t('goal.edit') : t('goal.new')}
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        <TextField label={t('common.name')} value={v.name} onChange={(e) => form.set('name', e.target.value)} error={form.errors.name} autoFocus />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('goal.target')} error={form.errors.targetAmount}>
            <AmountInput value={v.targetAmount} onChange={(e) => form.set('targetAmount', e.target.value)} currency={v.currency} invalid={!!form.errors.targetAmount} />
          </Field>
          <Field label={t('common.currency')}>
            <Select value={v.currency} onChange={(e) => form.set('currency', e.target.value)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {locale === 'ar' ? c.nameAr : c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('goal.deadline')} optional error={form.errors.deadline}>
            <Input type="date" value={v.deadline} onChange={(e) => form.set('deadline', e.target.value)} />
          </Field>
          <Field label={t('goal.priority')}>
            <Select value={v.priority} onChange={(e) => form.set('priority', e.target.value)}>
              {[1, 2, 3].map((p) => (
                <option key={p} value={p}>
                  {t(`goal.priority.${p}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('goal.monthlyTarget')} optional error={form.errors.monthlyTarget}>
            <AmountInput value={v.monthlyTarget} onChange={(e) => form.set('monthlyTarget', e.target.value)} currency={v.currency} />
          </Field>
          <Field label={t('common.workspace')} optional>
            <Select value={v.workspaceId} onChange={(e) => form.set('workspaceId', e.target.value)}>
              <option value="">{t('common.noWorkspace')}</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('goal.mode')}>
          <Select value={v.mode} onChange={(e) => form.set('mode', e.target.value as Goal['mode'])}>
            <option value="manual">{t('goal.mode.manual')}</option>
            <option value="accounts">{t('goal.mode.accounts')}</option>
          </Select>
        </Field>
        {v.mode === 'manual' ? (
          <Field label={t('goal.startingAmount')} error={form.errors.startingAmount}>
            <AmountInput value={v.startingAmount} onChange={(e) => form.set('startingAmount', e.target.value)} currency={v.currency} />
          </Field>
        ) : (
          <Field label={t('goal.accounts')} error={form.errors.accountIds}>
            <div className="space-y-1.5 rounded-lg border border-line p-2">
              {accounts.map((a) => (
                <label key={a.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={v.accountIds.includes(a.id)}
                    onChange={(e) => form.set('accountIds', e.target.checked ? [...v.accountIds, a.id] : v.accountIds.filter((x) => x !== a.id))}
                    className="size-4 accent-[var(--accent)]"
                  />
                  <span className="flex-1">{a.name}</span>
                  <Money minor={a.balance} currency={a.currency} className="text-[12.5px] text-ink-3" />
                </label>
              ))}
            </div>
          </Field>
        )}
        <Field label={t('common.notes')} optional>
          <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
