import { ACCOUNT_TYPES, minorToInput } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowLeft, Pencil, Plus, Scale, Trash2, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock, useToast } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Switch, Textarea, TextField } from '../../components/ui/form';
import { DataRow, PageHeader, Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { accountTypeLabel, AmountInput, FIN_KEYS, Money, todayIso, useAccounts, useCurrencies, type Account } from './fin-lib';
import { TransactionList } from './TransactionsPage';
import { InterestPanel } from './InterestPanel';

export function AccountsPage() {
  const { t, fmt } = useI18n();
  const [showArchived, setShowArchived] = useState(false);
  const { data = [], isLoading, error, refetch } = useAccounts(showArchived);
  const [editing, setEditing] = useState<Account | null | undefined>(undefined);
  const settings = useQuery({ queryKey: ['finance', 'net-worth'], queryFn: () => api.get<{ base: string; netWorth: number; liquid: number; missingRates: string[] }>('/api/finance/net-worth') });

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={refetch} />;

  const groups = ACCOUNT_TYPES.map((type) => ({ type, items: data.filter((a) => a.type === type) })).filter((g) => g.items.length);

  return (
    <div>
      <PageHeader
        title={t('acc.title')}
        subtitle={settings.data ? <span>{t('fin.netWorth')}: <Money minor={settings.data.netWorth} currency={settings.data.base} /> · {t('fin.cash')}: <Money minor={settings.data.liquid} currency={settings.data.base} /></span> : null}
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowArchived((s) => !s)}>
              {t('common.showArchived')}
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
              {t('acc.new')}
            </Button>
          </>
        }
      />
      {data.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Wallet className="size-5" />} title={t('acc.empty')} body={t('fin.getStarted')} action={<Button variant="primary" onClick={() => setEditing(null)}>{t('fin.addAccount')}</Button>} />
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const byCurrency = new Map<string, number>();
            for (const a of g.items) byCurrency.set(a.currency, (byCurrency.get(a.currency) ?? 0) + a.balance);
            return (
              <Panel
                key={g.type}
                title={accountTypeLabel(t, g.type)}
                padded={false}
                actions={
                  <span className="flex gap-3 text-[13px] text-ink-2">
                    {[...byCurrency].map(([cur, sum]) => (
                      <Money key={cur} minor={sum} currency={cur} />
                    ))}
                  </span>
                }
              >
                <ul className="divide-y divide-line">
                  {g.items.map((a) => (
                    <li key={a.id}>
                      <Link to={`/finance/accounts/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color ?? 'var(--accent)' }} />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 truncate font-medium">
                            {a.name}
                            {a.archivedAt && <Badge tone="warn">{t('common.archived')}</Badge>}
                            {a.interest && (
                              <Badge tone="pos" className="font-normal">
                                {t('int.badge', { rate: fmt.percent(a.interest.rate / 100, 2), freq: t(`int.freq.${a.interest.frequency}` as MessageKey) })}
                              </Badge>
                            )}
                          </p>
                          <p className="truncate text-[12.5px] text-ink-3">
                            {[a.institution, a.reference].filter(Boolean).join(' · ')}
                            {a.creditLimit ? ` · ${t('acc.creditLimit')} ${fmt.money(a.creditLimit, a.currency)}` : ''}
                          </p>
                        </div>
                        <Money minor={a.balance} currency={a.currency} colored={a.balance < 0} className="font-semibold" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}
      <AccountFormModal open={editing !== undefined} account={editing ?? undefined} onOpenChange={(o) => !o && setEditing(undefined)} />
    </div>
  );
}

export function AccountFormModal({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account?: Account }) {
  const { t, locale } = useI18n();
  const { workspaces, currentId } = useWorkspace();
  const { data: currencies = [] } = useCurrencies();
  const init = () => ({
    name: account?.name ?? '',
    type: account?.type ?? 'bank',
    currency: account?.currency ?? 'EGP',
    openingBalance: account ? minorToInput(account.openingBalance, account.currency) : '0',
    openingDate: account?.openingDate ?? '',
    institution: account?.institution ?? '',
    reference: account?.reference ?? '',
    creditLimit: account?.creditLimit != null ? minorToInput(account.creditLimit, account.currency) : '',
    workspaceId: account?.workspaceId ?? currentId ?? '',
    includeInNetWorth: account?.includeInNetWorth ?? true,
    notes: account?.notes ?? '',
  });
  const form = useFormState(init());
  useEffect(() => {
    if (open) {
      form.setValues(init());
      form.setErrors({});
      form.setFormError(null);
    }
  }, [open, account?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const save = useAction(
    () => {
      const body = { ...v, openingDate: v.openingDate || null, creditLimit: v.type === 'credit_card' && v.creditLimit ? v.creditLimit : null, workspaceId: v.workspaceId || null };
      return account ? api.put(`/api/finance/accounts/${account.id}`, body) : api.post('/api/finance/accounts', body);
    },
    { invalidate: FIN_KEYS, success: t('common.saved'), silentFieldErrors: true, onSuccess: () => onOpenChange(false) },
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={account ? t('acc.edit') : t('acc.new')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        <TextField label={t('common.name')} value={v.name} onChange={(e) => form.set('name', e.target.value)} error={form.errors.name} autoFocus />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('acc.type')}>
            <Select value={v.type} onChange={(e) => form.set('type', e.target.value)}>
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {accountTypeLabel(t, type)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.currency')} error={form.errors.currency}>
            <Select value={v.currency} onChange={(e) => form.set('currency', e.target.value)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {locale === 'ar' ? c.nameAr : c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('acc.openingBalance')} hint={t('acc.openingBalanceHint')} error={form.errors.openingBalance}>
            <AmountInput value={v.openingBalance} onChange={(e) => form.set('openingBalance', e.target.value)} currency={v.currency} invalid={!!form.errors.openingBalance} />
          </Field>
          <Field label={t('acc.openingDate')} optional error={form.errors.openingDate}>
            <Input type="date" value={v.openingDate} onChange={(e) => form.set('openingDate', e.target.value)} />
          </Field>
          <TextField label={t('acc.institution')} optional value={v.institution} onChange={(e) => form.set('institution', e.target.value)} />
          <TextField label={t('acc.reference')} hint={t('acc.referenceHint')} value={v.reference} onChange={(e) => form.set('reference', e.target.value)} maxLength={60} />
          {v.type === 'credit_card' && (
            <Field label={t('acc.creditLimit')} optional error={form.errors.creditLimit}>
              <AmountInput value={v.creditLimit} onChange={(e) => form.set('creditLimit', e.target.value)} currency={v.currency} />
            </Field>
          )}
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
        <Switch checked={v.includeInNetWorth} onChange={(x) => form.set('includeInNetWorth', x)} label={t('acc.includeNetWorth')} />
        <Field label={t('common.notes')} optional>
          <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

function ReconcileModal({ account, open, onOpenChange }: { account: Account; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(todayIso());
  const form = useFormState({});
  useEffect(() => {
    if (open) {
      setBalance(minorToInput(account.balance, account.currency));
      setDate(todayIso());
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = useAction(() => api.post<{ adjusted: boolean }>(`/api/finance/accounts/${account.id}/reconcile`, { balance, date }), {
    invalidate: FIN_KEYS,
    silentFieldErrors: true,
    onSuccess: (r) => {
      toast.success(r.adjusted ? t('acc.reconciled') : t('acc.alreadyCorrect'));
      onOpenChange(false);
    },
  });
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('acc.reconcileTitle')}
      size="sm"
      footer={
        <Button variant="primary" loading={run.isPending} onClick={() => run.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-2">{t('acc.reconcileHint')}</p>
        <Field label={t('acc.actualBalance')} error={form.errors.balance}>
          <AmountInput big value={balance} onChange={(e) => setBalance(e.target.value)} currency={account.currency} />
        </Field>
        <Field label={t('common.date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function AccountDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [reconcile, setReconcile] = useState(false);
  const [del, setDel] = useState(false);
  const { data: a, isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'accounts', id], queryFn: () => api.get<Account>(`/api/finance/accounts/${id}`) });
  const archive = useAction((archived: boolean) => api.post(`/api/finance/accounts/${id}/archive`, { archived }), { invalidate: FIN_KEYS });
  const remove = useAction(() => api.del(`/api/finance/accounts/${id}`), { invalidate: FIN_KEYS, onSuccess: () => navigate('/finance/accounts') });

  if (isLoading) return <LoadingBlock />;
  if (error || !a) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;

  return (
    <div>
      <PageHeader
        back={
          <Link to="/finance/accounts" className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t('acc.title')}
          </Link>
        }
        title={a.name}
        subtitle={
          <span className="inline-flex items-center gap-2">
            {accountTypeLabel(t, a.type)} {a.institution && `· ${a.institution}`} {a.archivedAt && <Badge tone="warn">{t('common.archived')}</Badge>}
          </span>
        }
        actions={
          <>
            <Button icon={<Scale className="size-4" />} onClick={() => setReconcile(true)} disabled={!!a.archivedAt}>
              {t('acc.reconcile')}
            </Button>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
              {t('common.edit')}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => archive.mutate(!a.archivedAt)} aria-label={a.archivedAt ? t('common.unarchive') : t('common.archive')} title={a.archivedAt ? t('common.unarchive') : t('common.archive')}>
              {a.archivedAt ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setDel(true)} aria-label={t('common.delete')} title={t('acc.deleteHint')}>
              <Trash2 className="size-4 text-neg" />
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title={t('acc.transactions')} padded={false}>
          <TransactionList filter={{ accountId: a.id }} showAccount={false} />
        </Panel>
        <div className="space-y-5">
          <Panel>
            <p className="text-[12.5px] font-medium text-ink-3">{t('acc.balance')}</p>
            <p className="mt-1 text-[26px] font-semibold">
              <Money minor={a.balance} currency={a.currency} colored={a.balance < 0} />
            </p>
            <dl className="mt-3">
              <DataRow label={t('acc.openingBalance')}>
                <Money minor={a.openingBalance} currency={a.currency} />
              </DataRow>
              {a.openingDate && <DataRow label={t('acc.openingDate')}>{fmt.date(a.openingDate)}</DataRow>}
              {a.reference && <DataRow label={t('acc.reference')}>{a.reference}</DataRow>}
              {a.creditLimit != null && (
                <DataRow label={t('acc.creditLimit')}>
                  <Money minor={a.creditLimit} currency={a.currency} />
                </DataRow>
              )}
            </dl>
            {a.notes && <p className="mt-3 text-[13.5px] whitespace-pre-wrap text-ink-2">{a.notes}</p>}
          </Panel>
          <InterestPanel accountId={a.id} currency={a.currency} archived={!!a.archivedAt} />
          <AttachmentsPanel type="account" id={a.id} workspaceId={a.workspaceId} />
        </div>
      </div>
      <AccountFormModal open={edit} onOpenChange={setEdit} account={a} />
      <ReconcileModal open={reconcile} onOpenChange={setReconcile} account={a} />
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={t('common.deleteConfirm', { name: a.name })}
        body={t('acc.deleteHint')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </div>
  );
}
