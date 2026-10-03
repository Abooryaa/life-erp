import { INTEREST_FREQUENCIES, INTEREST_METHODS } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { Percent, Plus, RefreshCw, Settings2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, Spinner, useToast } from '../../components/ui/feedback';
import { Field, FormError, Input, NoFieldId, Select, Switch } from '../../components/ui/form';
import { DataRow, Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { FIN_KEYS, Money, todayIso, useCategories } from './fin-lib';

interface Interest {
  accountId: string;
  configured: boolean;
  eligible: boolean;
  enabled?: boolean;
  frequency?: 'daily' | 'monthly';
  method?: 'daily_balance' | 'min_balance';
  creditDay?: number;
  categoryId?: string;
  startDate?: string;
  accruedThrough?: string | null;
  currency?: string;
  rates?: { id: string; effectiveFrom: string; annualRate: number }[];
  currentRate?: number;
  earnedThisMonth?: number;
  earnedThisYear?: number;
  earnedTotal?: number;
  pending?: { from: string; to: string; amount: number; creditDate: string } | null;
  estimatedPerMonth?: number;
}

const KEYS = [...FIN_KEYS, ['interest']];

/** Interest earned by an account: settings, rate history, what it earned and what is building up. */
export function InterestPanel({ accountId, currency, archived }: { accountId: string; currency: string; archived: boolean }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const [setup, setSetup] = useState(false);
  const [recalc, setRecalc] = useState(false);
  const [remove, setRemove] = useState(false);
  const { data: i, isLoading } = useQuery({ queryKey: ['interest', accountId], queryFn: () => api.get<Interest>(`/api/finance/accounts/${accountId}/interest`) });
  const rate = useFormState({ effectiveFrom: todayIso(), annualRate: '' });
  const addRate = useAction(() => api.post<Interest & { alreadyCredited: boolean }>(`/api/finance/accounts/${accountId}/interest/rates`, rate.values), {
    invalidate: KEYS,
    silentFieldErrors: true,
    onSuccess: (r) => {
      rate.reset();
      if (r.alreadyCredited) toast.info(t('int.rateBackdated'), { label: t('int.recalculate'), onClick: () => setRecalc(true) });
      else toast.success(t('common.saved'));
    },
  });
  const delRate = useAction((rid: string) => api.del(`/api/finance/accounts/${accountId}/interest/rates/${rid}`), { invalidate: KEYS });
  const doRemove = useAction(() => api.del(`/api/finance/accounts/${accountId}/interest`), { invalidate: KEYS, onSuccess: () => setRemove(false) });

  if (isLoading || !i) return null;
  if (!i.eligible) return null;
  if (!i.configured) {
    return (
      <Panel>
        <div className="flex items-start gap-3">
          <Percent className="mt-0.5 size-5 shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t('int.none')}</p>
            <p className="text-[12.5px] text-ink-3">{t('int.noneHint')}</p>
          </div>
        </div>
        <Button className="mt-3" size="sm" icon={<Plus className="size-4" />} onClick={() => setSetup(true)} disabled={archived}>
          {t('int.setup')}
        </Button>
        {setup && <InterestModal accountId={accountId} onClose={() => setSetup(false)} />}
      </Panel>
    );
  }
  const cur = i.currency ?? currency;
  return (
    <Panel
      title={t('int.title')}
      actions={
        <Button size="icon-sm" variant="ghost" onClick={() => setSetup(true)} aria-label={t('int.settings')} title={t('int.settings')}>
          <Settings2 className="size-4" />
        </Button>
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="num text-[24px] font-semibold">{fmt.percent((i.currentRate ?? 0) / 100, 2)}</p>
        {i.enabled ? <Badge tone="pos">{t(`int.freq.${i.frequency}` as MessageKey)}</Badge> : <Badge tone="warn">{t('auto.paused')}</Badge>}
      </div>
      <p className="text-[12px] text-ink-3">{t('int.yearlyRate')}</p>
      <dl className="mt-3">
        {i.pending && i.enabled && (
          <DataRow label={t('int.building', { date: fmt.date(i.pending.creditDate) })}>
            <Money minor={i.pending.amount} currency={cur} />
          </DataRow>
        )}
        <DataRow label={t('int.thisMonth')}>
          <Money minor={i.earnedThisMonth ?? 0} currency={cur} />
        </DataRow>
        <DataRow label={t('int.thisYear')}>
          <Money minor={i.earnedThisYear ?? 0} currency={cur} />
        </DataRow>
        <DataRow label={t('int.perMonth')}>
          <span className="text-ink-3">≈ </span>
          <Money minor={i.estimatedPerMonth ?? 0} currency={cur} />
        </DataRow>
        <DataRow label={t('int.creditedThrough')}>{i.accruedThrough ? fmt.date(i.accruedThrough) : '—'}</DataRow>
        {i.frequency === 'monthly' && (
          <DataRow label={t('int.method')}>{t(`int.method.${i.method}` as MessageKey)}</DataRow>
        )}
      </dl>

      <div className="mt-4">
        <p className="mb-1.5 text-[12.5px] font-medium text-ink-3">{t('int.rates')}</p>
        <NoFieldId>
          <ul className="space-y-1">
            {i.rates?.map((r, idx) => (
              <li key={r.id} className="flex items-center gap-2 text-[13px]">
                <span className="num w-24 shrink-0 text-ink-3">{fmt.date(r.effectiveFrom)}</span>
                <span className="num flex-1 font-medium">{fmt.percent(r.annualRate / 100, 2)}</span>
                {idx > 0 && (
                  <Button size="icon-sm" variant="ghost" onClick={() => delRate.mutate(r.id)} aria-label={t('common.remove')}>
                    <X className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_80px_auto] gap-1.5">
            <Input type="date" value={rate.values.effectiveFrom} onChange={(e) => rate.set('effectiveFrom', e.target.value)} aria-label={t('int.from')} invalid={!!rate.errors.effectiveFrom} />
            <Input inputMode="decimal" value={rate.values.annualRate} onChange={(e) => rate.set('annualRate', e.target.value)} placeholder="%" aria-label={t('int.rate')} invalid={!!rate.errors.annualRate} />
            <Button size="sm" onClick={() => addRate.mutate(undefined, { onError: rate.fail })} loading={addRate.isPending} disabled={!rate.values.annualRate}>
              {t('common.add')}
            </Button>
          </div>
          {(rate.errors.effectiveFrom || rate.errors.annualRate) && <p className="mt-1 text-[12px] text-neg">{rate.errors.effectiveFrom ?? rate.errors.annualRate}</p>}
          <p className="mt-1 text-[11.5px] text-ink-3">{t('int.ratesHint')}</p>
        </NoFieldId>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => setRecalc(true)}>
          {t('int.recalculate')}
        </Button>
        <Button size="sm" variant="ghost" className="text-neg" onClick={() => setRemove(true)}>
          {t('int.remove')}
        </Button>
      </div>
      {setup && <InterestModal accountId={accountId} existing={i} onClose={() => setSetup(false)} />}
      {recalc && <RecalcModal accountId={accountId} startDate={i.startDate!} onClose={() => setRecalc(false)} />}
      <ConfirmDialog open={remove} onOpenChange={setRemove} title={t('int.removeTitle')} body={t('int.removeBody')} confirmLabel={t('int.remove')} loading={doRemove.isPending} onConfirm={() => doRemove.mutate(undefined)} />
    </Panel>
  );
}

function InterestModal({ accountId, existing, onClose }: { accountId: string; existing?: Interest; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { data: cats = [] } = useCategories();
  const form = useFormState({
    enabled: existing?.enabled ?? true,
    frequency: existing?.frequency ?? ('monthly' as 'daily' | 'monthly'),
    method: existing?.method ?? ('daily_balance' as 'daily_balance' | 'min_balance'),
    creditDay: String(existing?.creditDay ?? 31),
    categoryId: existing?.categoryId ?? '',
    startDate: existing?.startDate ?? todayIso(),
    annualRate: '',
  });
  useEffect(() => form.setErrors({}), []); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const save = useAction(
    () =>
      api.put(`/api/finance/accounts/${accountId}/interest`, {
        enabled: v.enabled,
        frequency: v.frequency,
        method: v.method,
        creditDay: Number(v.creditDay),
        categoryId: v.categoryId || null,
        startDate: v.startDate,
        annualRate: existing ? undefined : v.annualRate,
      }),
    { invalidate: KEYS, success: t('common.saved'), silentFieldErrors: true, onSuccess: onClose },
  );
  const incomeCats = cats.filter((c) => c.kind === 'income' && !c.archivedAt);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={existing ? t('int.settings') : t('int.setup')}
      description={t('int.setupHint')}
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        <Field label={t('int.howCredited')}>
          <div className="grid grid-cols-2 gap-2">
            {INTEREST_FREQUENCIES.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={v.frequency === f}
                onClick={() => form.set('frequency', f)}
                className={v.frequency === f ? 'rounded-lg border border-accent bg-accent-soft p-2.5 text-start' : 'rounded-lg border border-line p-2.5 text-start hover:bg-surface-2'}
              >
                <span className="block text-[13.5px] font-medium">{t(`int.freq.${f}` as MessageKey)}</span>
                <span className="block text-[12px] text-ink-3">{t(`int.freq.${f}.hint` as MessageKey)}</span>
              </button>
            ))}
          </div>
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          {!existing && (
            <Field label={t('int.rate')} hint={t('int.rateHint')} error={form.errors.annualRate}>
              <div className="relative" dir="ltr">
                <Input inputMode="decimal" value={v.annualRate} onChange={(e) => form.set('annualRate', e.target.value)} invalid={!!form.errors.annualRate} placeholder="22.5" autoFocus />
                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-ink-3">%</span>
              </div>
            </Field>
          )}
          <Field label={t('int.startDate')} hint={t('int.startHint')} error={form.errors.startDate}>
            <Input type="date" value={v.startDate} onChange={(e) => form.set('startDate', e.target.value)} invalid={!!form.errors.startDate} />
          </Field>
          {v.frequency === 'monthly' && (
            <>
              <Field label={t('int.creditDay')} hint={t('int.creditDayHint')} error={form.errors.creditDay}>
                <Input type="number" min={1} max={31} value={v.creditDay} onChange={(e) => form.set('creditDay', e.target.value)} />
              </Field>
              <Field label={t('int.method')}>
                <Select value={v.method} onChange={(e) => form.set('method', e.target.value as 'daily_balance')}>
                  {INTEREST_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`int.method.${m}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <Field label={t('tx.category')} hint={t('int.categoryHint')} error={form.errors.categoryId}>
            <Select value={v.categoryId} onChange={(e) => form.set('categoryId', e.target.value)}>
              <option value="">{t('int.bankInterest')}</option>
              {incomeCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === 'ar' && c.nameAr ? c.nameAr : c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {existing && <Switch checked={v.enabled} onChange={(x) => form.set('enabled', x)} label={t('int.active')} description={t('int.activeHint')} />}
        <p className="text-[12px] text-ink-3">{t('int.howItWorks')}</p>
      </div>
    </Modal>
  );
}

function RecalcModal({ accountId, startDate, onClose }: { accountId: string; startDate: string; onClose: () => void }) {
  const { t } = useI18n();
  const [from, setFrom] = useState(startDate);
  const run = useAction(() => api.post<{ removed: number; credited: number }>(`/api/finance/accounts/${accountId}/interest/recalculate`, { from }), {
    invalidate: KEYS,
    success: (r) => t('int.recalculated', { removed: r.removed, credited: r.credited }),
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('int.recalculate')}
      description={t('int.recalcHint')}
      size="sm"
      footer={
        <Button variant="primary" loading={run.isPending} onClick={() => run.mutate(undefined)} icon={run.isPending ? <Spinner className="size-4" /> : undefined}>
          {t('int.recalculate')}
        </Button>
      }
    >
      <Field label={t('int.recalcFrom')}>
        <Input type="date" value={from} min={startDate} onChange={(e) => setFrom(e.target.value)} />
      </Field>
    </Modal>
  );
}
