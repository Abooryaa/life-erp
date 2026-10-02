import { minorToInput } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { HandCoins, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea, TextField } from '../../components/ui/form';
import { DataRow, PageHeader } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { AccountSelect, AmountInput, Bar, FIN_KEYS, Money, todayIso, useCurrencies } from './fin-lib';

interface Debt {
  id: string;
  direction: 'i_owe' | 'owed_to_me';
  counterparty: string;
  principal: number;
  currency: string;
  startDate: string;
  dueDate: string | null;
  workspaceId: string | null;
  status: 'open' | 'settled';
  notes: string | null;
  paid: number;
  remaining: number;
  payments: { id: string; date: string; amount: number; note: string | null; transactionId: string | null }[];
}

export function DebtsPage() {
  const { t, fmt } = useI18n();
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');
  const [editing, setEditing] = useState<Debt | null | undefined>(undefined);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'debts'], queryFn: () => api.get<Debt[]>('/api/finance/debts') });
  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={refetch} />;
  const sum = (dir: Debt['direction']) => {
    const m = new Map<string, number>();
    for (const d of data.filter((x) => x.direction === dir && x.status === 'open')) m.set(d.currency, (m.get(d.currency) ?? 0) + d.remaining);
    return [...m];
  };
  const today = todayIso();
  const open = data.find((d) => d.id === openId) ?? null;
  return (
    <div>
      <PageHeader
        title={t('debt.title')}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
            {t('debt.new')}
          </Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3">
        {(['i_owe', 'owed_to_me'] as const).map((dir) => (
          <div key={dir} className="rounded-card border border-line bg-surface p-4 shadow-card">
            <p className="text-[12.5px] font-medium text-ink-3">{dir === 'i_owe' ? t('debt.totalOwe') : t('debt.totalOwed')}</p>
            <div className="mt-1 text-[19px] font-semibold">
              {sum(dir).length ? sum(dir).map(([c, v]) => <Money key={c} minor={v} currency={c} className={`me-3 ${dir === 'i_owe' ? 'text-neg' : 'text-pos'}`} />) : '—'}
            </div>
          </div>
        ))}
      </div>
      {data.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<HandCoins className="size-5" />} title={t('debt.empty')} body={t('debt.emptyBody')} />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {data.map((d) => (
            <li key={d.id}>
              <button onClick={() => setParams({ open: d.id })} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    {d.counterparty}
                    <Badge tone={d.direction === 'i_owe' ? 'neg' : 'pos'}>{t(`debt.${d.direction}`)}</Badge>
                    {d.status === 'settled' && <Badge>{t('debt.settled')}</Badge>}
                    {d.status === 'open' && d.dueDate && d.dueDate < today && <Badge tone="warn">{t('fin.overdue')}</Badge>}
                  </p>
                  <p className="text-[12.5px] text-ink-3">
                    {fmt.date(d.startDate)}
                    {d.dueDate ? ` → ${fmt.date(d.dueDate)}` : ''}
                  </p>
                  <div className="mt-2 max-w-xs">
                    <Bar ratio={d.principal ? d.paid / d.principal : 1} tone={d.direction === 'i_owe' ? 'warn' : 'pos'} />
                  </div>
                </div>
                <div className="text-end">
                  <Money minor={d.remaining} currency={d.currency} className="font-semibold" />
                  <p className="text-[12px] text-ink-3">
                    / <Money minor={d.principal} currency={d.currency} />
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <DebtFormModal debt={editing} onClose={() => setEditing(undefined)} />
      <DebtDetail debt={open} onClose={() => setParams({})} onEdit={(d) => setEditing(d)} />
    </div>
  );
}

function DebtFormModal({ debt, onClose }: { debt: Debt | null | undefined; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { workspaces, currentId } = useWorkspace();
  const { data: currencies = [] } = useCurrencies();
  const open = debt !== undefined;
  const init = () => ({
    direction: debt?.direction ?? ('i_owe' as Debt['direction']),
    counterparty: debt?.counterparty ?? '',
    principal: debt ? minorToInput(debt.principal, debt.currency) : '',
    currency: debt?.currency ?? 'EGP',
    startDate: debt?.startDate ?? todayIso(),
    dueDate: debt?.dueDate ?? '',
    workspaceId: debt?.workspaceId ?? currentId ?? '',
    notes: debt?.notes ?? '',
  });
  const form = useFormState(init());
  useEffect(() => {
    if (open) {
      form.setValues(init());
      form.setErrors({});
      form.setFormError(null);
    }
  }, [open, debt?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const save = useAction(
    () => {
      const body = { ...v, dueDate: v.dueDate || null, workspaceId: v.workspaceId || null };
      return debt ? api.put(`/api/finance/debts/${debt.id}`, body) : api.post('/api/finance/debts', body);
    },
    { invalidate: FIN_KEYS, success: t('common.saved'), silentFieldErrors: true, onSuccess: onClose },
  );
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={debt ? t('debt.edit') : t('debt.new')}
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        <Field label={t('debt.direction')}>
          <div className="grid grid-cols-2 gap-2">
            {(['i_owe', 'owed_to_me'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => form.set('direction', d)}
                className={`rounded-lg border px-3 py-2 font-medium ${v.direction === d ? (d === 'i_owe' ? 'border-neg bg-neg-soft text-neg' : 'border-pos bg-pos-soft text-pos') : 'border-line text-ink-2'}`}
              >
                {t(`debt.${d}`)}
              </button>
            ))}
          </div>
        </Field>
        <TextField label={t('debt.counterparty')} value={v.counterparty} onChange={(e) => form.set('counterparty', e.target.value)} error={form.errors.counterparty} />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('debt.principal')} error={form.errors.principal}>
            <AmountInput value={v.principal} onChange={(e) => form.set('principal', e.target.value)} currency={v.currency} invalid={!!form.errors.principal} />
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
          <Field label={t('debt.startDate')} error={form.errors.startDate}>
            <Input type="date" value={v.startDate} onChange={(e) => form.set('startDate', e.target.value)} />
          </Field>
          <Field label={t('debt.dueDate')} optional error={form.errors.dueDate}>
            <Input type="date" value={v.dueDate} onChange={(e) => form.set('dueDate', e.target.value)} />
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
        <Field label={t('common.notes')} optional>
          <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

function DebtDetail({ debt, onClose, onEdit }: { debt: Debt | null; onClose: () => void; onEdit: (d: Debt) => void }) {
  const { t, fmt } = useI18n();
  const [del, setDel] = useState(false);
  const form = useFormState({ date: todayIso(), amount: '', accountId: '', note: '' });
  useEffect(() => {
    if (debt) form.setValues({ date: todayIso(), amount: debt.remaining ? minorToInput(debt.remaining, debt.currency) : '', accountId: '', note: '' });
  }, [debt?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pay = useAction(() => api.post(`/api/finance/debts/${debt!.id}/payments`, { ...form.values, accountId: form.values.accountId || null, note: form.values.note || null }), {
    invalidate: FIN_KEYS,
    silentFieldErrors: true,
    success: t('common.saved'),
  });
  const delPay = useAction((pid: string) => api.del(`/api/finance/debts/${debt!.id}/payments/${pid}`), { invalidate: FIN_KEYS });
  const remove = useAction(() => api.del(`/api/finance/debts/${debt!.id}`), {
    invalidate: FIN_KEYS,
    onSuccess: () => {
      setDel(false);
      onClose();
    },
  });
  return (
    <Modal open={!!debt} onOpenChange={(o) => !o && onClose()} title={debt?.counterparty ?? ''} size="lg">
      {debt && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <Badge tone={debt.direction === 'i_owe' ? 'neg' : 'pos'}>{t(`debt.${debt.direction}`)}</Badge>
              <p className="mt-1 text-[26px] font-semibold">
                <Money minor={debt.remaining} currency={debt.currency} />
              </p>
              <p className="text-ink-3">
                {t('debt.principal')}: <Money minor={debt.principal} currency={debt.currency} />
              </p>
            </div>
            <div className="flex gap-2">
              <Button icon={<Pencil className="size-4" />} onClick={() => onEdit(debt)}>
                {t('common.edit')}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setDel(true)} aria-label={t('common.delete')}>
                <Trash2 className="size-4 text-neg" />
              </Button>
            </div>
          </div>
          <dl>
            <DataRow label={t('debt.startDate')}>{fmt.date(debt.startDate)}</DataRow>
            {debt.dueDate && <DataRow label={t('debt.dueDate')}>{fmt.date(debt.dueDate)}</DataRow>}
          </dl>
          {debt.notes && <p className="text-[13.5px] whitespace-pre-wrap text-ink-2">{debt.notes}</p>}
          {debt.status === 'open' && (
            <form
              className="space-y-3 rounded-lg border border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                pay.mutate(undefined, { onError: form.fail });
              }}
            >
              <p className="font-medium">{t('debt.addPayment')}</p>
              <FormError message={form.formError} />
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={t('tx.amount')} error={form.errors.amount}>
                  <AmountInput value={form.values.amount} onChange={(e) => form.set('amount', e.target.value)} currency={debt.currency} invalid={!!form.errors.amount} />
                </Field>
                <Field label={t('common.date')}>
                  <Input type="date" value={form.values.date} onChange={(e) => form.set('date', e.target.value)} />
                </Field>
                <Field label={t('debt.paymentAccount')} hint={t('debt.paymentAccountHint')} error={form.errors.accountId} className="md:col-span-2">
                  <AccountSelect value={form.values.accountId} onChange={(id) => form.set('accountId', id)} allowEmpty />
                </Field>
              </div>
              <Button type="submit" variant="primary" loading={pay.isPending}>
                {t('common.save')}
              </Button>
            </form>
          )}
          <div>
            <p className="mb-2 font-medium">{t('debt.history')}</p>
            {debt.payments.length === 0 ? (
              <p className="text-[13px] text-ink-3">—</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {debt.payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="num flex-1">{fmt.date(p.date)}</span>
                    <Money minor={p.amount} currency={debt.currency} />
                    <Button size="icon-sm" variant="ghost" onClick={() => delPay.mutate(p.id)} aria-label={t('common.delete')}>
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <AttachmentsPanel type="debt" id={debt.id} workspaceId={debt.workspaceId} />
        </div>
      )}
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: debt?.counterparty ?? '' })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}
