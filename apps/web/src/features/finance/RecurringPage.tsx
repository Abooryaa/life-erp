import { FREQUENCIES, minorToInput } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Pause, Pencil, Play, Plus, Repeat, SkipForward, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Switch, Textarea, TextField } from '../../components/ui/form';
import { PageHeader } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState, useSettings } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { AccountSelect, AmountInput, CategorySelect, FIN_KEYS, Money, todayIso, useAccounts, useCategoryName } from './fin-lib';

interface Rule {
  id: string;
  name: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  payee: string | null;
  workspaceId: string | null;
  frequency: string;
  interval: number;
  startDate: string;
  endDate: string | null;
  nextDue: string | null;
  autoPost: boolean;
  remindDaysBefore: number;
  active: boolean;
  notes: string | null;
  accountName: string;
  categoryName: string | null;
  categoryNameAr: string | null;
}

const MONTHLY_FACTOR: Record<string, number> = { daily: 30.44, weekly: 4.345, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

export function RecurringPage() {
  const { t, fmt } = useI18n();
  const catName = useCategoryName();
  const base = useSettings().data?.baseCurrency ?? 'EGP';
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'recurring'], queryFn: () => api.get<Rule[]>('/api/finance/recurring') });
  const [editing, setEditing] = useState<Rule | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const post = useAction((id: string) => api.post(`/api/finance/recurring/${id}/post`, {}), { invalidate: FIN_KEYS, success: t('rec.recorded') });
  const skip = useAction((id: string) => api.post(`/api/finance/recurring/${id}/skip`), { invalidate: FIN_KEYS });
  const toggle = useAction((r: Rule) => api.post(`/api/finance/recurring/${r.id}/active`, { active: !r.active }), { invalidate: FIN_KEYS });
  const del = useAction((id: string) => api.del(`/api/finance/recurring/${id}`), { invalidate: FIN_KEYS, onSuccess: () => setDeleting(null) });

  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={refetch} />;

  const today = todayIso();
  const monthlyOut = data.filter((r) => r.active && r.type === 'expense' && r.currency === base).reduce((s, r) => s + (r.amount * MONTHLY_FACTOR[r.frequency]) / r.interval, 0);
  const monthlyIn = data.filter((r) => r.active && r.type === 'income' && r.currency === base).reduce((s, r) => s + (r.amount * MONTHLY_FACTOR[r.frequency]) / r.interval, 0);

  return (
    <div>
      <PageHeader
        title={t('rec.title')}
        subtitle={
          data.length ? (
            <span>
              {t('rec.monthlyTotal')}: <Money minor={Math.round(monthlyIn)} currency={base} className="text-pos" /> / <Money minor={-Math.round(monthlyOut)} currency={base} className="text-neg" />
            </span>
          ) : null
        }
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>
            {t('rec.new')}
          </Button>
        }
      />
      {data.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Repeat className="size-5" />} title={t('rec.empty')} body={t('rec.emptyBody')} action={<Button variant="primary" onClick={() => setEditing(null)}>{t('rec.new')}</Button>} />
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">
          {data.map((r) => {
            const overdue = r.active && r.nextDue && r.nextDue < today;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {r.name}
                    {!r.active && <Badge tone="warn">{t('rec.paused')}</Badge>}
                    {!r.nextDue && <Badge>{t('rec.ended')}</Badge>}
                    {r.autoPost && <Badge tone="info">{t('rec.auto')}</Badge>}
                    {overdue && <Badge tone="neg">{t('fin.overdue')}</Badge>}
                  </p>
                  <p className="text-[12.5px] text-ink-3">
                    {t(`rec.freq.${r.frequency}` as MessageKey)}
                    {r.interval > 1 ? ` ×${r.interval}` : ''} · {r.accountName}
                    {r.categoryName ? ` · ${catName({ name: r.categoryName, nameAr: r.categoryNameAr })}` : ''}
                    {r.nextDue ? ` · ${t('rec.nextDue')}: ${fmt.date(r.nextDue)}` : ''}
                  </p>
                </div>
                <Money minor={r.type === 'income' ? r.amount : -r.amount} currency={r.currency} colored={r.type !== 'transfer'} className="font-semibold" />
                <div className="flex gap-1">
                  {r.active && r.nextDue && (
                    <>
                      <Button size="sm" icon={<CheckCircle2 className="size-4" />} loading={post.isPending && post.variables === r.id} onClick={() => post.mutate(r.id)}>
                        {t('rec.record')}
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => skip.mutate(r.id)} aria-label={t('rec.skip')} title={t('rec.skip')}>
                        <SkipForward className="size-4" />
                      </Button>
                    </>
                  )}
                  <Button size="icon-sm" variant="ghost" onClick={() => toggle.mutate(r)} aria-label={r.active ? t('rec.pause') : t('rec.resume')} title={r.active ? t('rec.pause') : t('rec.resume')}>
                    {r.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => setEditing(r)} aria-label={t('common.edit')}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button size="icon-sm" variant="ghost" onClick={() => setDeleting(r)} aria-label={t('common.delete')}>
                    <Trash2 className="size-4 text-neg" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <RecurringFormModal rule={editing} onClose={() => setEditing(undefined)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('common.deleteConfirm', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </div>
  );
}

function RecurringFormModal({ rule, onClose }: { rule: Rule | null | undefined; onClose: () => void }) {
  const { t } = useI18n();
  const { workspaces, currentId } = useWorkspace();
  const { data: accounts = [] } = useAccounts();
  const open = rule !== undefined;
  const init = () => ({
    name: rule?.name ?? '',
    type: (rule?.type ?? 'expense') as Rule['type'],
    amount: rule ? minorToInput(rule.amount, rule.currency) : '',
    accountId: rule?.accountId ?? accounts[0]?.id ?? '',
    toAccountId: rule?.toAccountId ?? '',
    categoryId: rule?.categoryId ?? '',
    payee: rule?.payee ?? '',
    workspaceId: rule?.workspaceId ?? currentId ?? '',
    frequency: rule?.frequency ?? 'monthly',
    interval: String(rule?.interval ?? 1),
    startDate: rule?.startDate ?? todayIso(),
    endDate: rule?.endDate ?? '',
    autoPost: rule?.autoPost ?? false,
    remindDaysBefore: String(rule?.remindDaysBefore ?? 3),
    notes: rule?.notes ?? '',
  });
  const form = useFormState(init());
  useEffect(() => {
    if (open) {
      form.setValues(init());
      form.setErrors({});
      form.setFormError(null);
    }
  }, [open, rule?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const save = useAction(
    () => {
      const body = {
        ...v,
        interval: Number(v.interval),
        remindDaysBefore: Number(v.remindDaysBefore),
        toAccountId: v.type === 'transfer' ? v.toAccountId || null : null,
        categoryId: v.type === 'transfer' ? null : v.categoryId || null,
        endDate: v.endDate || null,
        workspaceId: v.workspaceId || null,
        payee: v.payee || null,
      };
      return rule ? api.put(`/api/finance/recurring/${rule.id}`, body) : api.post('/api/finance/recurring', body);
    },
    { invalidate: FIN_KEYS, success: t('common.saved'), silentFieldErrors: true, onSuccess: onClose },
  );
  const acc = accounts.find((a) => a.id === v.accountId);
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={rule ? t('rec.edit') : t('rec.new')}
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
          <Field label={t('tx.type')}>
            <Select value={v.type} onChange={(e) => form.set('type', e.target.value as Rule['type'])}>
              <option value="expense">{t('tx.type.expense')}</option>
              <option value="income">{t('tx.type.income')}</option>
              <option value="transfer">{t('tx.type.transfer')}</option>
            </Select>
          </Field>
          <Field label={t('tx.amount')} error={form.errors.amount}>
            <AmountInput value={v.amount} onChange={(e) => form.set('amount', e.target.value)} currency={acc?.currency} invalid={!!form.errors.amount} />
          </Field>
          <Field label={v.type === 'transfer' ? t('tx.fromAccount') : t('tx.account')} error={form.errors.accountId}>
            <AccountSelect value={v.accountId} onChange={(id) => form.set('accountId', id)} />
          </Field>
          {v.type === 'transfer' ? (
            <Field label={t('tx.toAccount')} error={form.errors.toAccountId}>
              <AccountSelect value={v.toAccountId} onChange={(id) => form.set('toAccountId', id)} exclude={v.accountId} allowEmpty invalid={!!form.errors.toAccountId} />
            </Field>
          ) : (
            <Field label={t('tx.category')} error={form.errors.categoryId}>
              <CategorySelect value={v.categoryId} onChange={(id) => form.set('categoryId', id)} kind={v.type} invalid={!!form.errors.categoryId} />
            </Field>
          )}
          <Field label={t('rec.frequency')}>
            <Select value={v.frequency} onChange={(e) => form.set('frequency', e.target.value)}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t(`rec.freq.${f}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('rec.every')} error={form.errors.interval}>
            <Input type="number" min={1} value={v.interval} onChange={(e) => form.set('interval', e.target.value)} />
          </Field>
          <Field label={t('rec.startDate')} error={form.errors.startDate}>
            <Input type="date" value={v.startDate} onChange={(e) => form.set('startDate', e.target.value)} />
          </Field>
          <Field label={t('rec.endDate')} optional error={form.errors.endDate}>
            <Input type="date" value={v.endDate} onChange={(e) => form.set('endDate', e.target.value)} />
          </Field>
          {v.type !== 'transfer' && (
            <Field label={t('tx.payee')} optional>
              <Input value={v.payee} onChange={(e) => form.set('payee', e.target.value)} />
            </Field>
          )}
          <Field label={t('rec.remindDays')}>
            <Input type="number" min={0} max={60} value={v.remindDaysBefore} onChange={(e) => form.set('remindDaysBefore', e.target.value)} />
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
        <Switch checked={v.autoPost} onChange={(x) => form.set('autoPost', x)} label={t('rec.autoPost')} description={t('rec.autoPostHint')} />
        <Field label={t('common.notes')} optional>
          <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
