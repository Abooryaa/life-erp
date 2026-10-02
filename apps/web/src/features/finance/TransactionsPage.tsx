import { TRANSACTION_TYPES } from '@life-erp/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Pencil, Plus, Receipt, RotateCcw, Scale, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock, Spinner } from '../../components/ui/feedback';
import { Input, Select } from '../../components/ui/form';
import { DataRow, PageHeader } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useAction, useDebounced } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { useUI } from '../../layout/ui-context';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { LinksPanel } from '../shared/LinksPanel';
import { EntityTags, TagList } from '../shared/TagEditor';
import { CategorySelect, FIN_KEYS, Money, useAccounts, useCategoryName, type Tx } from './fin-lib';

interface TxPage {
  items: Tx[];
  total: number;
  totals: { currency: string; income: number; expenses: number }[];
}

const PAGE = 100;

const TYPE_ICON = { income: ArrowDownLeft, expense: ArrowUpRight, transfer: ArrowLeftRight, refund: RotateCcw, adjustment: Scale };
const TYPE_TONE = { income: 'bg-pos-soft text-pos', expense: 'bg-neg-soft text-neg', transfer: 'bg-info-soft text-info', refund: 'bg-accent-soft text-accent', adjustment: 'bg-surface-2 text-ink-2' };

export interface TxFilter {
  from?: string;
  to?: string;
  accountId?: string;
  categoryId?: string;
  type?: string;
  q?: string;
  tag?: string;
  workspaceId?: string | null;
  projectId?: string;
}

/** Reusable, paginated transaction list grouped by day. */
export function TransactionList({ filter, showAccount = true }: { filter: TxFilter; showAccount?: boolean }) {
  const { t, fmt } = useI18n();
  const catName = useCategoryName();
  const [, setParams] = useSearchParams();
  const q = useInfiniteQuery({
    queryKey: ['finance', 'transactions', filter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.get<TxPage>(`/api/finance/transactions${qs({ ...filter, limit: PAGE, offset: pageParam })}`),
    getNextPageParam: (last, pages) => (pages.length * PAGE < last.total ? pages.length * PAGE : undefined),
  });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} onRetry={q.refetch} />;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (!items.length) return <EmptyState icon={<Receipt className="size-5" />} title={t('tx.empty')} body={t('tx.emptyBody')} />;
  const days = new Map<string, Tx[]>();
  for (const tx of items) days.set(tx.date, [...(days.get(tx.date) ?? []), tx]);
  const first = q.data!.pages[0];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2 text-[12.5px] text-ink-3">
        <span>{t('tx.count', { n: first.total })}</span>
        {first.totals.map((tt) => (
          <span key={tt.currency} className="flex gap-3">
            <span>
              {t('fin.income')} <Money minor={tt.income} currency={tt.currency} className="text-pos" />
            </span>
            <span>
              {t('fin.expenses')} <Money minor={tt.expenses} currency={tt.currency} className="text-neg" />
            </span>
          </span>
        ))}
      </div>
      {[...days].map(([day, txs]) => (
        <section key={day}>
          <h3 className="sticky top-14 z-10 flex justify-between bg-surface-2/95 px-4 py-1.5 text-[12px] font-semibold text-ink-3 backdrop-blur">
            <span>
              {fmt.weekday(day, 'short')} · {fmt.date(day)}
            </span>
          </h3>
          <ul className="divide-y divide-line">
            {txs.map((tx) => {
              const Icon = TYPE_ICON[tx.type];
              const title = tx.type === 'transfer' ? (tx.amount < 0 ? `→ ${tx.payee ?? ''}` : `← ${tx.payee ?? ''}`) : tx.payee || tx.description || catName({ name: tx.categoryName, nameAr: tx.categoryNameAr }) || t(`tx.type.${tx.type}` as MessageKey);
              return (
                <li key={tx.id}>
                  <button
                    onClick={() =>
                      setParams((p) => {
                        const n = new URLSearchParams(p);
                        n.set('open', tx.id);
                        return n;
                      })
                    }
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-2"
                  >
                    <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-full', TYPE_TONE[tx.type])}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{title}</p>
                      <p className="flex flex-wrap items-center gap-x-2 truncate text-[12.5px] text-ink-3">
                        {tx.categoryName && (
                          <span className="inline-flex items-center gap-1">
                            <span className="size-2 rounded-full" style={{ background: tx.categoryColor ?? '#94a3b8' }} />
                            {catName({ name: tx.categoryName, nameAr: tx.categoryNameAr })}
                          </span>
                        )}
                        {showAccount && <span>{tx.accountName}</span>}
                        <TagList tags={tx.tags} />
                      </p>
                    </div>
                    <Money minor={tx.amount} currency={tx.currency} colored={tx.type !== 'transfer'} className="font-semibold" sign />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {q.hasNextPage && (
        <div className="flex justify-center p-4">
          <Button loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            {t('common.loadMore')}
          </Button>
        </div>
      )}
      <TransactionDetail />
    </div>
  );
}

function TransactionDetail() {
  const { t, fmt } = useI18n();
  const ui = useUI();
  const catName = useCategoryName();
  const { byId } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const id = params.get('open');
  const [deleting, setDeleting] = useState(false);
  const close = () =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete('open');
      return n;
    });
  const { data: tx, isLoading } = useQuery({ queryKey: ['finance', 'transaction', id], queryFn: () => api.get<Tx & { categoryName?: string }>(`/api/finance/transactions/${id}`), enabled: !!id });
  const accounts = useAccounts(true).data ?? [];
  const cats = useQuery({ queryKey: ['finance', 'categories', { includeArchived: true }], queryFn: () => api.get<{ id: string; name: string; nameAr: string | null }[]>('/api/finance/categories?archived=1'), enabled: !!id });
  const del = useAction(() => api.del(`/api/finance/transactions/${id}`), {
    invalidate: FIN_KEYS,
    onSuccess: () => {
      setDeleting(false);
      close();
    },
  });
  const acc = accounts.find((a) => a.id === tx?.accountId);
  const other = tx?.counterpart ? accounts.find((a) => a.id === tx.counterpart!.accountId) : undefined;
  const cat = cats.data?.find((c) => c.id === tx?.categoryId);
  const ws = byId(tx?.workspaceId);
  return (
    <Modal open={!!id} onOpenChange={(o) => !o && close()} title={tx ? t(`tx.type.${tx.type}` as MessageKey) : '…'} size="lg">
      {isLoading || !tx ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[28px] font-semibold">
                <Money minor={tx.amount} currency={tx.currency} colored={tx.type !== 'transfer'} sign />
              </p>
              <p className="text-ink-3">{fmt.longDate(tx.date)}</p>
            </div>
            <div className="flex gap-2">
              <Button
                icon={<Pencil className="size-4" />}
                onClick={() => {
                  close();
                  ui.openTransaction(tx.type, tx);
                }}
              >
                {t('common.edit')}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setDeleting(true)} aria-label={t('common.delete')}>
                <Trash2 className="size-4 text-neg" />
              </Button>
            </div>
          </div>
          <dl>
            {tx.type === 'transfer' ? (
              <DataRow label={t('tx.type.transfer')}>{tx.amount < 0 ? t('tx.transferBetween', { from: acc?.name ?? '', to: other?.name ?? '' }) : t('tx.transferBetween', { from: other?.name ?? '', to: acc?.name ?? '' })}</DataRow>
            ) : (
              <>
                <DataRow label={t('tx.account')}>{acc?.name}</DataRow>
                <DataRow label={t('tx.category')}>{cat ? catName(cat) : '—'}</DataRow>
                {tx.payee && <DataRow label={t('tx.payee')}>{tx.payee}</DataRow>}
              </>
            )}
            {tx.counterpart && tx.counterpart.currency !== tx.currency && (
              <DataRow label={t('tx.toAmount')}>
                <Money minor={tx.counterpart.amount} currency={tx.counterpart.currency} />
              </DataRow>
            )}
            {tx.description && <DataRow label={t('tx.description')}>{tx.description}</DataRow>}
            {ws && <DataRow label={t('common.workspace')}>{ws.name}</DataRow>}
          </dl>
          <div className="flex flex-wrap gap-2">
            {tx.recurringId && <Badge tone="info">{t('tx.recurringLink')}</Badge>}
            {tx.installmentPaymentId && <Badge tone="info">{t('tx.installmentLink')}</Badge>}
            {tx.debtPaymentId && <Badge tone="info">{t('tx.debtLink')}</Badge>}
          </div>
          {tx.notes && <p className="text-[13.5px] whitespace-pre-wrap text-ink-2">{tx.notes}</p>}
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink-2">{t('common.tags')}</p>
            <EntityTags type="transaction" id={tx.id} tags={tx.tags} invalidate={[['finance']]} />
          </div>
          <AttachmentsPanel type="transaction" id={tx.id} workspaceId={tx.workspaceId} />
          <LinksPanel type="transaction" id={tx.id} />
        </div>
      )}
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={t('common.delete')} body={t('common.cannotUndo')} confirmLabel={t('common.delete')} loading={del.isPending} onConfirm={() => del.mutate(undefined)} />
    </Modal>
  );
}

export function TransactionsPage() {
  const { t } = useI18n();
  const ui = useUI();
  const { currentId } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const { data: accounts = [] } = useAccounts();
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(q.trim(), 250);
  const set = (k: string, v: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (v) n.set(k, v);
      else n.delete(k);
      return n;
    }, { replace: true });
  const filter: TxFilter = {
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    accountId: params.get('accountId') ?? undefined,
    categoryId: params.get('categoryId') ?? undefined,
    type: params.get('type') ?? undefined,
    tag: params.get('tag') ?? undefined,
    q: dq || undefined,
    workspaceId: currentId,
  };
  return (
    <div>
      <PageHeader
        title={t('tx.title')}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => ui.openTransaction('expense')}>
            {t('tx.new')}
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 md:flex md:flex-wrap">
        <Input className="col-span-2 md:w-56" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="md:w-44" value={filter.accountId ?? ''} onChange={(e) => set('accountId', e.target.value)} aria-label={t('tx.account')}>
          <option value="">{t('tx.allAccounts')}</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <div className="md:w-48">
          <CategorySelect value={filter.categoryId ?? ''} onChange={(id) => set('categoryId', id)} emptyLabel={t('tx.allCategories')} />
        </div>
        <Select className="md:w-36" value={filter.type ?? ''} onChange={(e) => set('type', e.target.value)} aria-label={t('tx.type')}>
          <option value="">{t('tx.allTypes')}</option>
          {TRANSACTION_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(`tx.type.${ty}` as MessageKey)}
            </option>
          ))}
        </Select>
        <Input type="date" className="md:w-40" value={filter.from ?? ''} onChange={(e) => set('from', e.target.value)} aria-label={t('tx.from')} title={t('tx.from')} />
        <Input type="date" className="md:w-40" value={filter.to ?? ''} onChange={(e) => set('to', e.target.value)} aria-label={t('tx.to')} title={t('tx.to')} />
        {filter.tag && (
          <Button variant="subtle" onClick={() => set('tag', '')}>
            #{filter.tag} ✕
          </Button>
        )}
      </div>
      {/* No overflow-hidden here: it would break the sticky day headers. */}
      <div className="rounded-card border border-line bg-surface shadow-card">
        <TransactionList filter={filter} />
      </div>
    </div>
  );
}
