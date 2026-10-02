import { minorToInput, monthEnd } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, PiggyBank, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, Dot, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, NoFieldId, Select, Textarea, TextField } from '../../components/ui/form';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState, useSettings } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { AmountInput, Bar, CategorySelect, currentMonth, FIN_KEYS, MissingRates, Money, MonthNav, useCategoryName } from './fin-lib';

interface Line {
  id: string;
  categoryId: string;
  amount: number;
  name: string;
  nameAr: string | null;
  color: string | null;
  budget: number;
  actual: number;
  remaining: number;
  used: number;
  projected: number;
  status: 'ok' | 'warning' | 'over';
}
interface Report {
  budget: { id: string; name: string; workspaceId: string | null; startMonth: string; endMonth: string | null };
  month: string;
  active: boolean;
  currency: string;
  lines: Line[];
  total: Omit<Line, 'id' | 'categoryId' | 'amount' | 'name' | 'nameAr' | 'color'>;
  missingRates: string[];
}
interface BudgetRow {
  id: string;
  name: string;
  workspaceId: string | null;
  startMonth: string;
  endMonth: string | null;
  notes: string | null;
  report: Report;
}

const tone = (s: Line['status']) => (s === 'over' ? 'neg' : s === 'warning' ? 'warn' : 'pos') as 'neg' | 'warn' | 'pos';

function StatusBadge({ status }: { status: Line['status'] }) {
  const { t } = useI18n();
  return <Badge tone={tone(status)}>{status === 'over' ? t('bud.over') : status === 'warning' ? t('bud.warning') : t('bud.ok')}</Badge>;
}

export function BudgetsPage() {
  const { t, fmt } = useI18n();
  const { byId } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'budgets'], queryFn: () => api.get<BudgetRow[]>('/api/finance/budgets') });
  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={refetch} />;
  return (
    <div>
      <PageHeader
        title={t('bud.title')}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('bud.new')}
          </Button>
        }
      />
      {data.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<PiggyBank className="size-5" />} title={t('bud.empty')} body={t('bud.emptyBody')} action={<Button variant="primary" onClick={() => setCreating(true)}>{t('bud.new')}</Button>} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((b) => {
            const r = b.report;
            const ws = byId(b.workspaceId);
            return (
              <Link key={b.id} to={`/finance/budgets/${b.id}`} className="rounded-card border border-line bg-surface p-4 shadow-card hover:border-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{b.name}</p>
                    <p className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
                      {ws && <Dot color={ws.color} />}
                      {ws?.name ?? t('ws.all')}
                    </p>
                  </div>
                  {r.active ? <StatusBadge status={r.total.status} /> : <Badge>{t('bud.inactive')}</Badge>}
                </div>
                <div className="mt-3 flex items-baseline justify-between text-[13px]">
                  <span>
                    <Money minor={r.total.actual} currency={r.currency} className="text-[17px] font-semibold" /> <span className="text-ink-3">/ {fmt.money(r.total.budget, r.currency)}</span>
                  </span>
                  <span className="text-ink-3">{fmt.percent(Number.isFinite(r.total.used) ? r.total.used : 1)}</span>
                </div>
                <div className="mt-2">
                  <Bar ratio={r.total.used} tone={tone(r.total.status)} />
                </div>
                <ul className="mt-3 space-y-1">
                  {r.lines.slice(0, 4).map((l) => (
                    <li key={l.id} className="flex items-center gap-2 text-[12.5px]">
                      <span className="size-2 rounded-full" style={{ background: l.color ?? '#94a3b8' }} />
                      <span className="min-w-0 flex-1 truncate text-ink-2">{l.name}</span>
                      <span className={clsx('num', l.status === 'over' && 'text-neg')}>{fmt.percent(Number.isFinite(l.used) ? l.used : 1)}</span>
                    </li>
                  ))}
                </ul>
              </Link>
            );
          })}
        </div>
      )}
      <BudgetFormModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}

export function BudgetDetailPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const catName = useCategoryName();
  const [month, setMonth] = useState(currentMonth());
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const { data: r, isLoading, error, refetch } = useQuery({ queryKey: ['finance', 'budgets', id, month], queryFn: () => api.get<Report>(`/api/finance/budgets/${id}/report?month=${month}`) });
  const remove = useAction(() => api.del(`/api/finance/budgets/${id}`), { invalidate: FIN_KEYS, onSuccess: () => navigate('/finance/budgets') });
  if (isLoading) return <LoadingBlock />;
  if (error || !r) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;
  const cols = 'grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-3 md:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))]';
  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link to="/finance/budgets" className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t('bud.title')}
          </Link>
        }
        title={r.budget.name}
        actions={
          <>
            <MonthNav month={month} onChange={setMonth} />
            <Button icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
              {t('common.edit')}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setDel(true)} aria-label={t('common.delete')}>
              <Trash2 className="size-4 text-neg" />
            </Button>
          </>
        }
      />
      <MissingRates list={r.missingRates} />
      {!r.active && <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">{t('bud.inactive')}</p>}
      <Panel padded={false}>
        <div className={`${cols} border-b border-line bg-surface-2 px-4 py-2 text-[11.5px] font-semibold text-ink-3 uppercase`}>
          <span>{t('tx.category')}</span>
          <span className="text-end">{t('bud.budget')}</span>
          <span className="text-end">{t('bud.actual')}</span>
          <span className="text-end">{t('bud.remaining')}</span>
          <span className="text-end">{t('bud.used')}</span>
          <span className="hidden text-end md:block">{t('bud.projected')}</span>
        </div>
        <ul className="divide-y divide-line">
          {r.lines.map((l) => (
            <li key={l.id} className="px-4 py-3">
              <div className={`${cols} items-center text-[13.5px]`}>
                <Link to={`/finance/transactions?categoryId=${l.categoryId}&from=${month}-01&to=${monthEnd(month)}`} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: l.color ?? '#94a3b8' }} />
                  <span className="truncate">{catName(l)}</span>
                </Link>
                <Money minor={l.budget} currency={r.currency} className="text-end" compact />
                <Money minor={l.actual} currency={r.currency} className="text-end" compact />
                <Money minor={l.remaining} currency={r.currency} className="text-end" colored compact />
                <span className={clsx('num text-end', l.status === 'over' && 'font-semibold text-neg')}>{Number.isFinite(l.used) ? `${Math.round(l.used * 100)}%` : '—'}</span>
                <Money minor={l.projected} currency={r.currency} className={clsx('hidden text-end md:block', l.projected > l.budget && 'text-warn')} compact />
              </div>
              <div className="mt-2">
                <Bar ratio={l.used} tone={tone(l.status)} />
              </div>
            </li>
          ))}
        </ul>
        <div className={`${cols} border-t border-line-strong px-4 py-3 text-[13.5px] font-semibold`}>
          <span>{t('bud.total')}</span>
          <Money minor={r.total.budget} currency={r.currency} className="text-end" compact />
          <Money minor={r.total.actual} currency={r.currency} className="text-end" compact />
          <Money minor={r.total.remaining} currency={r.currency} className="text-end" colored compact />
          <span className="num text-end">{Number.isFinite(r.total.used) ? `${Math.round(r.total.used * 100)}%` : '—'}</span>
          <Money minor={r.total.projected} currency={r.currency} className="hidden text-end md:block" compact />
        </div>
      </Panel>
      <BudgetFormModal open={edit} onOpenChange={setEdit} budgetId={id} />
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: r.budget.name })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}

function BudgetFormModal({ open, onOpenChange, budgetId }: { open: boolean; onOpenChange: (o: boolean) => void; budgetId?: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const base = useSettings().data?.baseCurrency ?? 'EGP';
  const { workspaces, currentId } = useWorkspace();
  const existing = useQuery({
    queryKey: ['finance', 'budget-def', budgetId],
    queryFn: () => api.get<{ name: string; workspaceId: string | null; startMonth: string; endMonth: string | null; notes: string | null; lines: { categoryId: string; amount: number }[] }>(`/api/finance/budgets/${budgetId}`),
    enabled: open && !!budgetId,
  });
  const form = useFormState({ name: '', workspaceId: '', startMonth: currentMonth(), endMonth: '', notes: '', lines: [{ categoryId: '', amount: '' }] as { categoryId: string; amount: string }[] });
  useEffect(() => {
    if (!open) return;
    form.setErrors({});
    form.setFormError(null);
    const b = existing.data;
    if (budgetId && b) {
      form.setValues({ name: b.name, workspaceId: b.workspaceId ?? '', startMonth: b.startMonth, endMonth: b.endMonth ?? '', notes: b.notes ?? '', lines: b.lines.map((l) => ({ categoryId: l.categoryId, amount: minorToInput(l.amount, base) })) });
    } else if (!budgetId) {
      form.setValues({ name: '', workspaceId: currentId ?? '', startMonth: currentMonth(), endMonth: '', notes: '', lines: [{ categoryId: '', amount: '' }] });
    }
  }, [open, existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const save = useAction(
    () => {
      const body = { ...v, workspaceId: v.workspaceId || null, endMonth: v.endMonth || null, lines: v.lines.filter((l) => l.categoryId || l.amount) };
      return budgetId ? api.put<{ id: string }>(`/api/finance/budgets/${budgetId}`, body) : api.post<{ id: string }>('/api/finance/budgets', body);
    },
    {
      invalidate: FIN_KEYS,
      success: t('common.saved'),
      silentFieldErrors: true,
      onSuccess: (r) => {
        onOpenChange(false);
        if (!budgetId) navigate(`/finance/budgets/${r.id}`);
      },
    },
  );
  const setLine = (i: number, patch: Partial<{ categoryId: string; amount: string }>) => form.set('lines', v.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={budgetId ? t('bud.edit') : t('bud.new')}
      size="lg"
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError ?? form.errors.lines} />
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label={t('common.name')} value={v.name} onChange={(e) => form.set('name', e.target.value)} error={form.errors.name} />
          <Field label={t('common.workspace')}>
            <Select value={v.workspaceId} onChange={(e) => form.set('workspaceId', e.target.value)}>
              <option value="">{t('ws.all')}</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('bud.startMonth')} error={form.errors.startMonth}>
            <Input type="month" value={v.startMonth} onChange={(e) => form.set('startMonth', e.target.value)} />
          </Field>
          <Field label={t('bud.endMonth')} hint={t('bud.endHint')} error={form.errors.endMonth}>
            <Input type="month" value={v.endMonth} onChange={(e) => form.set('endMonth', e.target.value)} />
          </Field>
        </div>
        <Field label={t('bud.lines')} hint={t('bud.currencyHint', { currency: base })}>
          <NoFieldId>
          <div className="space-y-2">
            {v.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_130px_auto] gap-2">
                <CategorySelect value={l.categoryId} onChange={(id) => setLine(i, { categoryId: id })} kind="expense" invalid={!!form.errors[`lines.${i}.categoryId`]} />
                <AmountInput value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} currency={base} invalid={!!form.errors[`lines.${i}.amount`]} />
                <Button size="icon" variant="ghost" onClick={() => form.set('lines', v.lines.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => form.set('lines', [...v.lines, { categoryId: '', amount: '' }])}>
              {t('bud.addLine')}
            </Button>
          </div>
          </NoFieldId>
        </Field>
        <Field label={t('common.notes')} optional>
          <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
