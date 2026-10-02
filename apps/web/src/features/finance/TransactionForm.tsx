import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea } from '../../components/ui/form';
import { useI18n, type MessageKey } from '../../i18n';
import { api, ApiError } from '../../lib/api';
import { postOrQueue } from '../../lib/outbox';
import { useFormState } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { TagInput } from '../shared/TagEditor';
import { AccountSelect, AmountInput, CategorySelect, FIN_KEYS, todayIso, useAccounts, useCategoryName, type Tx } from './fin-lib';
import { minorToInput } from '@life-erp/shared';

export type TxMode = 'expense' | 'income' | 'transfer' | 'refund' | 'adjustment';
export interface TxDefaults {
  accountId?: string;
  categoryId?: string;
  projectId?: string;
  workspaceId?: string | null;
}
const LAST_ACCOUNT = 'lerp.lastAccount';

function rememberedAccount() {
  try {
    return localStorage.getItem(LAST_ACCOUNT) ?? '';
  } catch {
    return '';
  }
}

/**
 * One form for every kind of money movement. Built for speed on a phone:
 * type → amount → (category chip) → save. Everything else is optional.
 */
export function TransactionFormModal({
  open,
  onOpenChange,
  initialMode = 'expense',
  editing,
  defaults,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialMode?: TxMode;
  editing?: Tx | null;
  defaults?: TxDefaults;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const catName = useCategoryName();
  const { currentId, workspaces } = useWorkspace();
  const { data: accounts = [] } = useAccounts();
  const [mode, setMode] = useState<TxMode>(initialMode);
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dupeAsk, setDupeAsk] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const form = useFormState({
    amount: '',
    toAmount: '',
    accountId: '',
    toAccountId: '',
    categoryId: '',
    payee: '',
    date: todayIso(),
    description: '',
    notes: '',
    direction: 'out' as 'in' | 'out',
    workspaceId: '',
    projectId: '',
    tags: [] as string[],
  });
  const v = form.values;
  const projects = useQuery({
    queryKey: ['projects', 'all', 'open'],
    queryFn: () => api.get<{ id: string; name: string; workspaceId: string | null }[]>('/api/projects?status=open'),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) return;
    form.setErrors({});
    form.setFormError(null);
    if (editing) {
      const isTransfer = editing.type === 'transfer';
      const outLeg = isTransfer && editing.amount > 0 && editing.counterpart ? editing.counterpart : editing;
      const inLeg = isTransfer ? (outLeg.id === editing.id ? editing.counterpart : editing) : null;
      setMode(editing.type);
      setMore(!!(editing.description || editing.notes || editing.tags?.length));
      form.setValues({
        amount: minorToInput(Math.abs(outLeg.amount), outLeg.currency),
        toAmount: inLeg ? minorToInput(Math.abs(inLeg.amount), inLeg.currency) : '',
        accountId: outLeg.accountId,
        toAccountId: inLeg?.accountId ?? '',
        categoryId: editing.categoryId ?? '',
        payee: isTransfer ? '' : (editing.payee ?? ''),
        date: editing.date,
        description: editing.description ?? '',
        notes: editing.notes ?? '',
        direction: editing.amount >= 0 ? 'in' : 'out',
        workspaceId: editing.workspaceId ?? '',
        projectId: editing.projectId ?? '',
        tags: editing.tags ?? [],
      });
    } else {
      setMode(initialMode);
      setMore(false);
      const last = rememberedAccount();
      const acc = defaults?.accountId ?? (accounts.find((a) => a.id === last) ? last : (accounts[0]?.id ?? ''));
      form.setValues({
        amount: '',
        toAmount: '',
        accountId: acc,
        toAccountId: '',
        categoryId: defaults?.categoryId ?? '',
        payee: '',
        date: todayIso(),
        description: '',
        notes: '',
        direction: 'out',
        workspaceId: defaults?.workspaceId ?? currentId ?? '',
        projectId: defaults?.projectId ?? '',
        tags: [],
      });
      if (defaults?.projectId) setMore(true);
      setTimeout(() => amountRef.current?.focus(), 50);
    }
  }, [open, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const account = accounts.find((a) => a.id === v.accountId);
  const toAccount = accounts.find((a) => a.id === v.toAccountId);
  const crossCurrency = mode === 'transfer' && account && toAccount && account.currency !== toAccount.currency;
  const catKind = mode === 'income' ? 'income' : 'expense';

  const frequent = useQuery({
    queryKey: ['finance', 'frequent', catKind],
    queryFn: () => api.get<{ id: string; name: string; nameAr: string | null; color: string | null }[]>(`/api/finance/categories/frequent?kind=${catKind}`),
    enabled: open && (mode === 'expense' || mode === 'income' || mode === 'refund'),
  });

  /** The laptop is unreachable: the entry waits in the phone outbox and syncs later. */
  function queued() {
    toast.info(t('outbox.queued'));
    onOpenChange(false);
  }

  async function save(allowDuplicate = false) {
    setSaving(true);
    form.setFormError(null);
    try {
      if (mode === 'transfer') {
        const body = {
          date: v.date,
          fromAccountId: v.accountId,
          toAccountId: v.toAccountId,
          amount: v.amount,
          toAmount: crossCurrency ? v.toAmount : null,
          description: v.description || null,
          notes: v.notes || null,
          workspaceId: v.workspaceId || null,
          tags: v.tags,
        };
        if (editing) await api.put(`/api/finance/transactions/${editing.id}`, body);
        else if ((await postOrQueue('/api/finance/transfers', body, t('tx.type.transfer'))).queued) return queued();
      } else {
        const body = {
          type: mode,
          date: v.date,
          amount: v.amount,
          direction: v.direction,
          accountId: v.accountId,
          categoryId: v.categoryId || null,
          payee: v.payee || null,
          description: v.description || null,
          notes: v.notes || null,
          workspaceId: v.workspaceId || null,
          projectId: v.projectId || null,
          tags: v.tags,
          allowDuplicate,
        };
        if (editing) await api.put(`/api/finance/transactions/${editing.id}`, body);
        else if ((await postOrQueue('/api/finance/transactions', body, `${t(`tx.type.${mode}` as MessageKey)} ${v.amount}`)).queued) return queued();
      }
      try {
        localStorage.setItem(LAST_ACCOUNT, v.accountId);
      } catch {
        /* ignore */
      }
      await Promise.all(FIN_KEYS.map((k) => qc.invalidateQueries({ queryKey: k })));
      toast.success(t('tx.saved'));
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'possible_duplicate') setDupeAsk(true);
      else form.fail(err);
    } finally {
      setSaving(false);
    }
  }

  const modes: TxMode[] = editing ? [editing.type] : ['expense', 'income', 'transfer', 'refund', 'adjustment'];
  const tone: Record<TxMode, string> = {
    expense: 'bg-neg text-white',
    income: 'bg-pos text-white',
    transfer: 'bg-info text-white',
    refund: 'bg-accent text-accent-ink',
    adjustment: 'bg-ink text-canvas',
  };

  const chips = useMemo(() => (frequent.data ?? []).slice(0, 8), [frequent.data]);

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={editing ? t('tx.edit') : t('tx.new')}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="lg" loading={saving} onClick={() => save()} className="min-w-28 justify-center">
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {!editing && (
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-thin" role="tablist">
              {modes.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => {
                    setMode(m);
                    form.set('categoryId', '');
                  }}
                  className={clsx('shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium', mode === m ? tone[m] : 'bg-surface-2 text-ink-2')}
                >
                  {t(`tx.type.${m}` as MessageKey)}
                </button>
              ))}
            </div>
          )}
          <FormError message={form.formError} />

          <Field label={t('tx.amount')} error={form.errors.amount}>
            <AmountInput ref={amountRef} big value={v.amount} onChange={(e) => form.set('amount', e.target.value)} currency={account?.currency} invalid={!!form.errors.amount} />
          </Field>

          {mode === 'transfer' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('tx.fromAccount')} error={form.errors.fromAccountId}>
                <AccountSelect value={v.accountId} onChange={(id) => form.set('accountId', id)} invalid={!!form.errors.fromAccountId} />
              </Field>
              <Field label={t('tx.toAccount')} error={form.errors.toAccountId}>
                <AccountSelect value={v.toAccountId} onChange={(id) => form.set('toAccountId', id)} exclude={v.accountId} allowEmpty invalid={!!form.errors.toAccountId} />
              </Field>
              {crossCurrency && (
                <Field label={t('tx.toAmount')} hint={t('tx.toAmountHint', { currency: toAccount!.currency })} error={form.errors.toAmount} className="md:col-span-2">
                  <AmountInput value={v.toAmount} onChange={(e) => form.set('toAmount', e.target.value)} currency={toAccount!.currency} invalid={!!form.errors.toAmount} />
                </Field>
              )}
            </div>
          ) : (
            <>
              {mode !== 'adjustment' && (
                <Field label={t('tx.category')} error={form.errors.categoryId}>
                  {chips.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {chips.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => form.set('categoryId', c.id)}
                          className={clsx(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]',
                            v.categoryId === c.id ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-2 hover:bg-surface-2',
                          )}
                        >
                          <span className="size-2 rounded-full" style={{ background: c.color ?? '#94a3b8' }} />
                          {catName(c)}
                        </button>
                      ))}
                    </div>
                  )}
                  <CategorySelect value={v.categoryId} onChange={(id) => form.set('categoryId', id)} kind={catKind} invalid={!!form.errors.categoryId} />
                </Field>
              )}
              {mode === 'adjustment' && (
                <Field label={t('tx.direction')}>
                  <Select value={v.direction} onChange={(e) => form.set('direction', e.target.value as 'in' | 'out')}>
                    <option value="in">{t('tx.increase')}</option>
                    <option value="out">{t('tx.decrease')}</option>
                  </Select>
                </Field>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t('tx.account')} error={form.errors.accountId}>
                  <AccountSelect value={v.accountId} onChange={(id) => form.set('accountId', id)} invalid={!!form.errors.accountId} />
                </Field>
                <Field label={mode === 'income' ? t('tx.payer') : t('tx.payee')} optional>
                  <Input value={v.payee} onChange={(e) => form.set('payee', e.target.value)} />
                </Field>
              </div>
            </>
          )}

          <Field label={t('common.date')} error={form.errors.date}>
            <Input type="date" value={v.date} onChange={(e) => form.set('date', e.target.value)} />
          </Field>

          <button type="button" onClick={() => setMore((m) => !m)} className="flex items-center gap-1 text-[13px] font-medium text-accent">
            <ChevronDown className={clsx('size-4 transition-transform', more && 'rotate-180')} />
            {t('tx.more')}
          </button>
          {more && (
            <div className="space-y-4">
              <Field label={t('tx.description')} optional>
                <Input value={v.description} onChange={(e) => form.set('description', e.target.value)} />
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
              {mode !== 'transfer' && (
                <Field label={t('nav.projects')} optional error={form.errors.projectId}>
                  <Select value={v.projectId} onChange={(e) => form.set('projectId', e.target.value)}>
                    <option value="">—</option>
                    {(projects.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label={t('common.tags')} optional>
                <TagInput value={v.tags} onChange={(tags) => form.set('tags', tags)} />
              </Field>
              <Field label={t('common.notes')} optional>
                <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={2} />
              </Field>
            </div>
          )}
          <button type="submit" className="hidden" />
        </form>
      </Modal>
      <ConfirmDialog
        open={dupeAsk}
        onOpenChange={setDupeAsk}
        title={t('tx.duplicateTitle')}
        body={form.formError ?? 'A transaction with the same date, account, amount and payee already exists.'}
        confirmLabel={t('tx.saveAnyway')}
        danger={false}
        onConfirm={() => {
          setDupeAsk(false);
          void save(true);
        }}
      />
    </>
  );
}
