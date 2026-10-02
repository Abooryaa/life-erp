import { installmentSchedule, minorToInput, toMinor, type Frequency } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock, Check, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Switch, Textarea, TextField } from '../../components/ui/form';
import { DataRow, PageHeader, Panel, Stat } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { AccountSelect, AmountInput, Bar, CategorySelect, FIN_KEYS, Money, todayIso, useCurrencies } from './fin-lib';

interface Payment {
  id: string;
  seq: number;
  dueDate: string;
  amount: number;
  paidDate: string | null;
  paidAmount: number | null;
  transactionId: string | null;
}
interface Installment {
  id: string;
  name: string;
  payee: string | null;
  totalAmount: number;
  downPayment: number;
  interestFees: number;
  currency: string;
  paymentCount: number;
  firstDueDate: string;
  frequency: string;
  accountId: string | null;
  categoryId: string | null;
  workspaceId: string | null;
  remindDaysBefore: number;
  status: 'active' | 'completed' | 'cancelled';
  notes: string | null;
  paidCount: number;
  remainingCount: number;
  paidAmount: number;
  remainingAmount: number;
  monthlyPayment: number;
  nextDue: string | null;
  nextAmount: number | null;
  overdueCount: number;
  endDate: string | null;
  progress: number;
  payments?: Payment[];
}

export function InstallmentsPage() {
  const { t, fmt } = useI18n();
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'installments'], queryFn: () => api.get<Installment[]>('/api/finance/installments') });
  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={refetch} />;
  const active = data.filter((i) => i.status === 'active');
  const byCurrency = new Map<string, number>();
  for (const i of active) byCurrency.set(i.currency, (byCurrency.get(i.currency) ?? 0) + i.remainingAmount);
  return (
    <div>
      <PageHeader
        title={t('inst.title')}
        subtitle={
          byCurrency.size ? (
            <span>
              {t('inst.obligations')}:{' '}
              {[...byCurrency].map(([c, v]) => (
                <Money key={c} minor={v} currency={c} className="me-2" />
              ))}
            </span>
          ) : null
        }
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('inst.new')}
          </Button>
        }
      />
      {data.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<CalendarClock className="size-5" />} title={t('inst.empty')} body={t('inst.emptyBody')} action={<Button variant="primary" onClick={() => setCreating(true)}>{t('inst.new')}</Button>} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((i) => (
            <Link key={i.id} to={`/finance/installments/${i.id}`} className="rounded-card border border-line bg-surface p-4 shadow-card hover:border-line-strong">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{i.name}</p>
                  <p className="truncate text-[12.5px] text-ink-3">{i.payee}</p>
                </div>
                {i.overdueCount > 0 ? <Badge tone="neg">{t('fin.overdue')}</Badge> : <Badge tone={i.status === 'active' ? 'info' : 'neutral'}>{t(`inst.status.${i.status}` as MessageKey)}</Badge>}
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <Money minor={i.monthlyPayment} currency={i.currency} className="text-[18px] font-semibold" />
                <span className="text-[12.5px] text-ink-3">{t('inst.perPayment')}</span>
              </div>
              <div className="mt-3">
                <Bar ratio={i.progress} tone={i.overdueCount ? 'neg' : 'accent'} />
              </div>
              <div className="mt-2 flex justify-between text-[12.5px] text-ink-3">
                <span>
                  {i.paidCount}/{i.paymentCount}
                </span>
                <span>
                  {t('inst.remaining')} <Money minor={i.remainingAmount} currency={i.currency} />
                </span>
              </div>
              {i.nextDue && <p className="mt-1 text-[12.5px] text-ink-2">{t('inst.next', { date: fmt.date(i.nextDue) })}</p>}
            </Link>
          ))}
        </div>
      )}
      <InstallmentFormModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function InstallmentFormModal({ open, onOpenChange, inst }: { open: boolean; onOpenChange: (o: boolean) => void; inst?: Installment }) {
  const { t, fmt, locale } = useI18n();
  const navigate = useNavigate();
  const { workspaces, currentId } = useWorkspace();
  const { data: currencies = [] } = useCurrencies();
  const init = () => ({
    name: inst?.name ?? '',
    payee: inst?.payee ?? '',
    totalAmount: inst ? minorToInput(inst.totalAmount, inst.currency) : '',
    downPayment: inst ? minorToInput(inst.downPayment, inst.currency) : '0',
    interestFees: inst ? minorToInput(inst.interestFees, inst.currency) : '0',
    paymentCount: String(inst?.paymentCount ?? 12),
    firstDueDate: inst?.firstDueDate ?? todayIso(),
    frequency: inst?.frequency ?? 'monthly',
    currency: inst?.currency ?? 'EGP',
    accountId: inst?.accountId ?? '',
    categoryId: inst?.categoryId ?? '',
    workspaceId: inst?.workspaceId ?? currentId ?? '',
    remindDaysBefore: String(inst?.remindDaysBefore ?? 3),
    notes: inst?.notes ?? '',
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
  const preview = useMemo(() => {
    const total = toMinor(v.totalAmount || '0', v.currency) ?? 0;
    const down = toMinor(v.downPayment || '0', v.currency) ?? 0;
    const n = Number(v.paymentCount);
    if (!total || !n || down >= total || !/^\d{4}-\d{2}-\d{2}$/.test(v.firstDueDate)) return null;
    return installmentSchedule(total - down, n, v.firstDueDate, v.frequency as Frequency);
  }, [v.totalAmount, v.downPayment, v.paymentCount, v.firstDueDate, v.frequency, v.currency]);
  const save = useAction(
    () => {
      const body = { ...v, paymentCount: Number(v.paymentCount), remindDaysBefore: Number(v.remindDaysBefore), accountId: v.accountId || null, categoryId: v.categoryId || null, workspaceId: v.workspaceId || null, payee: v.payee || null };
      return inst ? api.put<Installment>(`/api/finance/installments/${inst.id}`, body) : api.post<Installment>('/api/finance/installments', body);
    },
    {
      invalidate: FIN_KEYS,
      success: t('common.saved'),
      silentFieldErrors: true,
      onSuccess: (r) => {
        onOpenChange(false);
        if (!inst) navigate(`/finance/installments/${r.id}`);
      },
    },
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={inst ? t('inst.edit') : t('inst.new')}
      size="lg"
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label={t('common.name')} value={v.name} onChange={(e) => form.set('name', e.target.value)} error={form.errors.name} autoFocus />
          <TextField label={t('tx.payee')} optional value={v.payee} onChange={(e) => form.set('payee', e.target.value)} />
          <Field label={t('common.currency')}>
            <Select value={v.currency} onChange={(e) => form.set('currency', e.target.value)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {locale === 'ar' ? c.nameAr : c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('inst.total')} hint={t('inst.totalHint')} error={form.errors.totalAmount}>
            <AmountInput value={v.totalAmount} onChange={(e) => form.set('totalAmount', e.target.value)} currency={v.currency} invalid={!!form.errors.totalAmount} />
          </Field>
          <Field label={t('inst.downPayment')} error={form.errors.downPayment}>
            <AmountInput value={v.downPayment} onChange={(e) => form.set('downPayment', e.target.value)} currency={v.currency} invalid={!!form.errors.downPayment} />
          </Field>
          <Field label={t('inst.interestFees')} optional error={form.errors.interestFees}>
            <AmountInput value={v.interestFees} onChange={(e) => form.set('interestFees', e.target.value)} currency={v.currency} />
          </Field>
          <Field label={t('inst.count')} error={form.errors.paymentCount}>
            <Input type="number" min={1} max={600} value={v.paymentCount} onChange={(e) => form.set('paymentCount', e.target.value)} />
          </Field>
          <Field label={t('rec.frequency')}>
            <Select value={v.frequency} onChange={(e) => form.set('frequency', e.target.value)}>
              {['monthly', 'quarterly', 'weekly', 'yearly'].map((f) => (
                <option key={f} value={f}>
                  {t(`rec.freq.${f}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('inst.firstDue')} error={form.errors.firstDueDate}>
            <Input type="date" value={v.firstDueDate} onChange={(e) => form.set('firstDueDate', e.target.value)} />
          </Field>
          <Field label={t('inst.payFrom')} optional error={form.errors.accountId}>
            <AccountSelect value={v.accountId} onChange={(id) => form.set('accountId', id)} allowEmpty />
          </Field>
          <Field label={t('tx.category')} error={form.errors.categoryId}>
            <CategorySelect value={v.categoryId} onChange={(id) => form.set('categoryId', id)} kind="expense" />
          </Field>
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
        {preview && (
          <div className="rounded-lg bg-surface-2 p-3 text-[13px]">
            <p className="font-medium">{t('inst.preview')}</p>
            <p className="text-ink-2">
              {preview.length} × <Money minor={preview[0].amount} currency={v.currency} /> · {fmt.date(preview[0].dueDate)} → {fmt.date(preview[preview.length - 1].dueDate)}
            </p>
          </div>
        )}
        <Field label={t('common.notes')} optional>
          <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

export function InstallmentDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [paying, setPaying] = useState<Payment | null>(null);
  const { data: i, isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'installments', id], queryFn: () => api.get<Installment>(`/api/finance/installments/${id}`) });
  const unpay = useAction((pid: string) => api.post(`/api/finance/installments/${id}/payments/${pid}/unpay`), { invalidate: FIN_KEYS });
  const cancel = useAction((status: string) => api.post(`/api/finance/installments/${id}/status`, { status }), { invalidate: FIN_KEYS });
  const remove = useAction(() => api.del(`/api/finance/installments/${id}`), { invalidate: FIN_KEYS, onSuccess: () => navigate('/finance/installments') });
  if (isLoading) return <LoadingBlock />;
  if (error || !i) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;
  const today = todayIso();
  return (
    <div>
      <PageHeader
        back={
          <Link to="/finance/installments" className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t('inst.title')}
          </Link>
        }
        title={i.name}
        subtitle={
          <span className="inline-flex items-center gap-2">
            {i.payee} <Badge tone={i.status === 'active' ? 'info' : 'neutral'}>{t(`inst.status.${i.status}` as MessageKey)}</Badge>
          </span>
        }
        actions={
          <>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
              {t('common.edit')}
            </Button>
            {i.status === 'active' && <Button onClick={() => cancel.mutate('cancelled')}>{t('inst.cancel')}</Button>}
            <Button variant="ghost" size="icon" onClick={() => setDel(true)} aria-label={t('common.delete')}>
              <Trash2 className="size-4 text-neg" />
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title={t('inst.payments')} padded={false}>
          <ul className="divide-y divide-line">
            {i.payments?.map((p) => {
              const overdue = !p.paidDate && p.dueDate < today;
              return (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="num w-10 text-[12.5px] text-ink-3">{p.seq}</span>
                  <div className="min-w-0 flex-1">
                    <p className="num">{fmt.date(p.dueDate)}</p>
                    {p.paidDate && <p className="text-[12px] text-pos">{t('inst.paid')} · {fmt.date(p.paidDate)}</p>}
                    {overdue && <p className="text-[12px] text-neg">{t('fin.overdue')}</p>}
                  </div>
                  <Money minor={p.paidAmount ?? p.amount} currency={i.currency} className={p.paidDate ? 'text-ink-3' : 'font-semibold'} />
                  {p.paidDate ? (
                    <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => unpay.mutate(p.id)}>
                      {t('inst.undo')}
                    </Button>
                  ) : (
                    <Button size="sm" variant={overdue ? 'primary' : 'secondary'} icon={<Check className="size-4" />} onClick={() => setPaying(p)} disabled={i.status !== 'active'}>
                      {t('inst.pay')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
        <div className="space-y-5">
          <Panel>
            <div className="grid grid-cols-2 gap-4">
              <Stat label={t('inst.remaining')} value={<Money minor={i.remainingAmount} currency={i.currency} />} hint={t('inst.remainingPayments', { n: i.remainingCount })} />
              <Stat label={t('inst.paid')} value={<Money minor={i.paidAmount} currency={i.currency} />} hint={`${i.paidCount}/${i.paymentCount}`} />
            </div>
            <div className="mt-4">
              <Bar ratio={i.progress} />
            </div>
            <dl className="mt-3">
              <DataRow label={t('inst.total')}>
                <Money minor={i.totalAmount} currency={i.currency} />
              </DataRow>
              <DataRow label={t('inst.downPayment')}>
                <Money minor={i.downPayment} currency={i.currency} />
              </DataRow>
              {i.interestFees > 0 && (
                <DataRow label={t('inst.interestFees')}>
                  <Money minor={i.interestFees} currency={i.currency} />
                </DataRow>
              )}
              <DataRow label={t('inst.perPayment')}>
                <Money minor={i.monthlyPayment} currency={i.currency} />
              </DataRow>
              {i.endDate && <DataRow label={t('rec.endDate')}>{fmt.date(i.endDate)}</DataRow>}
            </dl>
            {i.notes && <p className="mt-3 text-[13.5px] whitespace-pre-wrap text-ink-2">{i.notes}</p>}
          </Panel>
          <AttachmentsPanel type="installment" id={i.id} workspaceId={i.workspaceId} />
        </div>
      </div>
      <InstallmentFormModal open={edit} onOpenChange={setEdit} inst={i} />
      <PayModal inst={i} payment={paying} onClose={() => setPaying(null)} />
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: i.name })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}

function PayModal({ inst, payment, onClose }: { inst: Installment; payment: Payment | null; onClose: () => void }) {
  const { t } = useI18n();
  const form = useFormState({ date: todayIso(), accountId: '', amount: '', recordTransaction: true });
  useEffect(() => {
    if (payment) form.setValues({ date: todayIso(), accountId: inst.accountId ?? '', amount: minorToInput(payment.amount, inst.currency), recordTransaction: true });
  }, [payment?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pay = useAction(
    () => api.post(`/api/finance/installments/${inst.id}/payments/${payment!.id}/pay`, { ...form.values, accountId: form.values.accountId || null }),
    { invalidate: FIN_KEYS, silentFieldErrors: true, success: t('common.saved'), onSuccess: onClose },
  );
  return (
    <Modal
      open={!!payment}
      onOpenChange={(o) => !o && onClose()}
      title={t('inst.payTitle', { n: payment?.seq ?? 0 })}
      size="sm"
      footer={
        <Button variant="primary" loading={pay.isPending} onClick={() => pay.mutate(undefined, { onError: form.fail })}>
          {t('inst.markPaid')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        <Field label={t('tx.amount')} error={form.errors.amount}>
          <AmountInput value={form.values.amount} onChange={(e) => form.set('amount', e.target.value)} currency={inst.currency} />
        </Field>
        <Field label={t('common.date')}>
          <Input type="date" value={form.values.date} onChange={(e) => form.set('date', e.target.value)} />
        </Field>
        <Switch checked={form.values.recordTransaction} onChange={(x) => form.set('recordTransaction', x)} label={t('inst.recordTx')} />
        {form.values.recordTransaction && (
          <Field label={t('inst.payFrom')} error={form.errors.accountId}>
            <AccountSelect value={form.values.accountId} onChange={(id) => form.set('accountId', id)} allowEmpty invalid={!!form.errors.accountId} />
          </Field>
        )}
        {form.errors.categoryId && <p className="text-[13px] text-neg">{form.errors.categoryId}</p>}
      </div>
    </Modal>
  );
}
