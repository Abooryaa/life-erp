import { ASSET_LIQUIDITY, ASSET_TYPES, CURRENCIES, minorToInput } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Gem, Plus, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Chart } from '../../components/Chart';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock, Spinner } from '../../components/ui/feedback';
import { Field, FormError, Input, NoFieldId, Select, Switch, Textarea, TextField } from '../../components/ui/form';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { AmountInput, MissingRates, Money } from '../finance/fin-lib';
import { localToday } from '../life/TasksPage';
import { useOpenParam } from '../career/career-lib';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { LinksPanel } from '../shared/LinksPanel';
import { INSIGHT_KEYS, useAxisChart } from './insights-lib';

interface NetPosition {
  base: string;
  liquid: number;
  otherAssets: number;
  investments: number;
  physicalAssets: number;
  receivables: number;
  accountLiabilities: number;
  installmentsRemaining: number;
  debtsOwed: number;
  assets: number;
  liabilities: number;
  netWorth: number;
  missingRates: string[];
}

interface Snapshot {
  date: string;
  netWorth: number;
  liquid: number;
  liabilities: number;
}

export interface Asset {
  id: string;
  name: string;
  type: string;
  liquidity: 'liquid' | 'non_liquid';
  workspaceId: string | null;
  currency: string;
  purchaseDate: string | null;
  purchasePrice: number | null;
  quantity: number | null;
  unit: string | null;
  includeInNetWorth: boolean;
  disposedAt: string | null;
  disposedValue: number | null;
  notes: string | null;
  value: number;
  lastValuedOn: string | null;
  gain: number | null;
  gainRatio: number | null;
  valuations?: { id: string; date: string; value: number; note: string | null }[];
}

export function NetWorthPage() {
  const { t, fmt } = useI18n();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [showSold, setShowSold] = useState(false);
  const nw = useQuery({ queryKey: ['insights', 'net-worth'], queryFn: () => api.get<{ now: NetPosition; history: Snapshot[] }>('/api/net-worth') });
  const assets = useQuery({ queryKey: ['insights', 'assets', showSold], queryFn: () => api.get<Asset[]>(`/api/assets${showSold ? '?disposed=1' : ''}`) });
  useOpenParam((id) => setEditing(id));
  const h = nw.data?.history ?? [];
  const base = nw.data?.now.base ?? 'EGP';
  const chart = useAxisChart(
    h.map((s) => fmt.date(s.date)),
    [
      { name: t('nw.netWorth'), type: 'line', data: h.map((s) => s.netWorth), color: 'accent', money: true, area: true },
      { name: t('fin.cash'), type: 'line', data: h.map((s) => s.liquid), color: 'pos', money: true },
    ],
    base,
    [h, t],
  );

  if (nw.isLoading) return <LoadingBlock />;
  if (nw.error || !nw.data) return <ErrorBlock error={nw.error ?? 'No data'} onRetry={nw.refetch} />;
  const n = nw.data.now;
  const row = (label: string, v: number, sign: 1 | -1 = 1) =>
    v ? (
      <li className="flex items-center justify-between gap-3 py-1.5 text-[13.5px]">
        <span className="min-w-0 text-ink-2">{label}</span>
        <Money minor={sign * v} currency={n.base} className="shrink-0 whitespace-nowrap" />
      </li>
    ) : null;
  return (
    <div className="space-y-5">
      <PageHeader
        title={t('nw.title')}
        subtitle={t('nw.subtitle')}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            {t('nw.addAsset')}
          </Button>
        }
      />
      <MissingRates list={n.missingRates} />
      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Panel>
          <p className="text-[12.5px] font-medium text-ink-3">{t('nw.netWorth')}</p>
          <p className={clsx('num mt-0.5 text-[24px] font-semibold break-words', n.netWorth < 0 && 'text-neg')}>
            <Money minor={n.netWorth} currency={n.base} />
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <p className="text-[12px] text-ink-3">{t('nw.assets')}</p>
              <Money minor={n.assets} currency={n.base} compact className="font-semibold text-pos" />
            </div>
            <div>
              <p className="text-[12px] text-ink-3">{t('nw.liabilities')}</p>
              <Money minor={n.liabilities} currency={n.base} compact className="font-semibold text-neg" />
            </div>
          </div>
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {row(t('nw.cash'), n.liquid)}
            {row(t('nw.investments'), n.investments)}
            {row(t('nw.physical'), n.physicalAssets)}
            {row(t('nw.otherAccounts'), n.otherAssets)}
            {row(t('fin.receivables'), n.receivables)}
            {row(t('nw.cardsLoans'), n.accountLiabilities, -1)}
            {row(t('nw.installments'), n.installmentsRemaining, -1)}
            {row(t('nw.debts'), n.debtsOwed, -1)}
          </ul>
        </Panel>
        <Panel title={t('nw.history')}>
          {h.length < 2 ? <p className="py-10 text-center text-[13px] text-ink-3">{t('nw.historyEmpty')}</p> : <Chart option={chart} height={280} ariaLabel={t('nw.history')} />}
        </Panel>
      </div>
      <Panel
        title={t('nw.assetsTitle')}
        padded={false}
        actions={
          <Button size="sm" variant={showSold ? 'subtle' : 'ghost'} onClick={() => setShowSold((x) => !x)}>
            {t('nw.showSold')}
          </Button>
        }
      >
        {assets.isLoading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : !assets.data?.length ? (
          <EmptyState icon={<Gem className="size-5" />} title={t('nw.assetsEmpty')} body={t('nw.assetsEmptyBody')} action={<Button variant="primary" onClick={() => setEditing('new')}>{t('nw.addAsset')}</Button>} />
        ) : (
          <ul className="divide-y divide-line">
            {assets.data.map((a) => (
              <li key={a.id}>
                <button onClick={() => setEditing(a.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-surface-2/60">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {a.name}
                      {a.disposedAt && <Badge className="ms-2">{t('nw.sold')}</Badge>}
                      {!a.includeInNetWorth && <Badge className="ms-2">{t('nw.excluded')}</Badge>}
                    </p>
                    <p className="truncate text-[12px] text-ink-3">
                      {t(`nw.type.${a.type}` as MessageKey)} · {t(`nw.liq.${a.liquidity}` as MessageKey)}
                      {a.quantity != null && ` · ${fmt.number(a.quantity)} ${a.unit ?? ''}`}
                      {a.lastValuedOn && ` · ${t('nw.valuedOn', { date: fmt.date(a.lastValuedOn) })}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <Money minor={a.disposedAt ? (a.disposedValue ?? 0) : a.value} currency={a.currency} className="font-semibold" />
                    {a.gain != null && (
                      <p className={clsx('text-[12px]', a.gain >= 0 ? 'text-pos' : 'text-neg')}>
                        {fmt.money(a.gain, a.currency, { sign: true, compact: true })}
                        {a.gainRatio != null && ` (${fmt.percent(a.gainRatio)})`}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {editing && <AssetModal assetId={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function AssetModal({ assetId, onClose }: { assetId?: string; onClose: () => void }) {
  const { t, fmt, locale } = useI18n();
  const { workspaces } = useWorkspace();
  const [del, setDel] = useState(false);
  const [selling, setSelling] = useState(false);
  const existing = useQuery({ queryKey: ['insights', 'asset', assetId], queryFn: () => api.get<Asset>(`/api/assets/${assetId}`), enabled: !!assetId });
  const form = useFormState({
    name: '',
    type: 'real_estate',
    liquidity: 'non_liquid',
    workspaceId: '',
    currency: 'EGP',
    purchaseDate: '',
    purchasePrice: '',
    quantity: '',
    unit: '',
    includeInNetWorth: true,
    notes: '',
    currentValue: '',
    valuationDate: localToday(),
  });
  useEffect(() => {
    const a = existing.data;
    if (a)
      form.setValues((v) => ({
        ...v,
        name: a.name,
        type: a.type,
        liquidity: a.liquidity,
        workspaceId: a.workspaceId ?? '',
        currency: a.currency,
        purchaseDate: a.purchaseDate ?? '',
        purchasePrice: a.purchasePrice == null ? '' : minorToInput(a.purchasePrice, a.currency),
        quantity: a.quantity == null ? '' : String(a.quantity),
        unit: a.unit ?? '',
        includeInNetWorth: a.includeInNetWorth,
        notes: a.notes ?? '',
      }));
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const pickType = (type: string) => {
    form.set('type', type);
    // Sensible default; you can still change it.
    form.set('liquidity', ['gold', 'stocks', 'fund', 'crypto'].includes(type) ? 'liquid' : 'non_liquid');
  };
  const body = () => {
    const b: Record<string, unknown> = {
      name: v.name,
      type: v.type,
      liquidity: v.liquidity,
      workspaceId: v.workspaceId || null,
      currency: v.currency,
      purchaseDate: v.purchaseDate || null,
      purchasePrice: v.purchasePrice || null,
      quantity: v.quantity === '' ? null : Number(v.quantity),
      unit: v.unit || null,
      includeInNetWorth: v.includeInNetWorth,
      notes: v.notes || null,
    };
    if (!assetId) Object.assign(b, { currentValue: v.currentValue || undefined, valuationDate: v.valuationDate || undefined });
    return b;
  };
  const save = useAction(() => (assetId ? api.put(`/api/assets/${assetId}`, body()) : api.post('/api/assets', body())), {
    invalidate: INSIGHT_KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: onClose,
  });
  const remove = useAction(() => api.del(`/api/assets/${assetId}`), { invalidate: INSIGHT_KEYS, onSuccess: onClose });
  const undoSale = useAction(() => api.del(`/api/assets/${assetId}/dispose`), { invalidate: INSIGHT_KEYS });
  const a = existing.data;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={assetId ? (a?.name ?? t('nw.asset')) : t('nw.addAsset')}
      size="lg"
      footer={
        <>
          {assetId && (
            <Button variant="ghost" icon={<Trash2 className="size-4 text-neg" />} onClick={() => setDel(true)} className="me-auto">
              {t('common.delete')}
            </Button>
          )}
          {a && !a.disposedAt && <Button onClick={() => setSelling(true)}>{t('nw.markSold')}</Button>}
          {a?.disposedAt && (
            <Button icon={<Undo2 className="size-4" />} loading={undoSale.isPending} onClick={() => undoSale.mutate(undefined)}>
              {t('nw.undoSold')}
            </Button>
          )}
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {assetId && existing.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <FormError message={form.formError} />
          {a?.disposedAt && (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
              {t('nw.soldOn', { date: fmt.date(a.disposedAt) })} <Money minor={a.disposedValue ?? 0} currency={a.currency} />
            </p>
          )}
          <TextField label={t('common.name')} value={v.name} onChange={(e) => form.set('name', e.target.value)} error={form.errors.name} autoFocus={!assetId} placeholder={t('nw.namePh')} />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t('common.type')}>
              <Select value={v.type} onChange={(e) => pickType(e.target.value)}>
                {ASSET_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`nw.type.${x}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('nw.liquidity')} hint={t('nw.liquidityHint')}>
              <Select value={v.liquidity} onChange={(e) => form.set('liquidity', e.target.value)}>
                {ASSET_LIQUIDITY.map((x) => (
                  <option key={x} value={x}>
                    {t(`nw.liq.${x}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.currency')}>
              <Select value={v.currency} onChange={(e) => form.set('currency', e.target.value)} disabled={!!assetId}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name[locale]}
                  </option>
                ))}
              </Select>
            </Field>
            {!assetId && (
              <>
                <Field label={t('nw.currentValue')} error={form.errors.currentValue}>
                  <AmountInput value={v.currentValue} onChange={(e) => form.set('currentValue', e.target.value)} currency={v.currency} invalid={!!form.errors.currentValue} />
                </Field>
                <Field label={t('nw.valuationDate')}>
                  <Input type="date" value={v.valuationDate} onChange={(e) => form.set('valuationDate', e.target.value)} />
                </Field>
                <div className="hidden md:block" />
              </>
            )}
            <Field label={t('nw.purchaseDate')} optional error={form.errors.purchaseDate}>
              <Input type="date" value={v.purchaseDate} onChange={(e) => form.set('purchaseDate', e.target.value)} invalid={!!form.errors.purchaseDate} />
            </Field>
            <Field label={t('nw.purchasePrice')} optional error={form.errors.purchasePrice}>
              <AmountInput value={v.purchasePrice} onChange={(e) => form.set('purchasePrice', e.target.value)} currency={v.currency} />
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
            <Field label={t('nw.quantity')} optional error={form.errors.quantity}>
              <Input type="number" min={0} step="any" value={v.quantity} onChange={(e) => form.set('quantity', e.target.value)} />
            </Field>
            <TextField label={t('nw.unit')} optional value={v.unit} onChange={(e) => form.set('unit', e.target.value)} placeholder={t('nw.unitPh')} />
          </div>
          <Switch checked={v.includeInNetWorth} onChange={(x) => form.set('includeInNetWorth', x)} label={t('nw.include')} description={t('nw.includeHint')} />
          <Field label={t('common.notes')} optional>
            <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={2} />
          </Field>
          {a && <Valuations asset={a} />}
          {a && (
            <>
              <AttachmentsPanel type="asset" id={a.id} workspaceId={a.workspaceId} />
              <LinksPanel type="asset" id={a.id} />
            </>
          )}
        </div>
      )}
      {selling && a && <SellModal asset={a} onClose={() => setSelling(false)} />}
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: v.name })} body={t('nw.deleteBody')} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}

function Valuations({ asset }: { asset: Asset }) {
  const { t, fmt } = useI18n();
  const f = useFormState({ date: localToday(), value: '', note: '' });
  const add = useAction(() => api.post(`/api/assets/${asset.id}/valuations`, { ...f.values, note: f.values.note || null }), {
    invalidate: INSIGHT_KEYS,
    silentFieldErrors: true,
    onSuccess: () => f.reset(),
  });
  const remove = useAction((vid: string) => api.del(`/api/assets/${asset.id}/valuations/${vid}`), { invalidate: INSIGHT_KEYS });
  const vals = asset.valuations ?? [];
  return (
    <Panel title={t('nw.valuations')} padded={false}>
      <NoFieldId>
        <ul className="divide-y divide-line">
          {vals.map((x) => (
            <li key={x.id} className="flex items-center gap-3 px-4 py-2">
              <span className="num w-24 shrink-0 text-[12.5px] text-ink-3">{fmt.date(x.date)}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">{x.note}</span>
              <Money minor={x.value} currency={asset.currency} className="font-medium" />
              <Button size="icon-sm" variant="ghost" onClick={() => remove.mutate(x.id)} disabled={vals.length <= 1} aria-label={t('common.delete')}>
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        {!asset.disposedAt && (
          <div className="grid grid-cols-2 gap-2 border-t border-line p-3 md:grid-cols-[140px_160px_minmax(0,1fr)_auto]">
            <Input type="date" value={f.values.date} onChange={(e) => f.set('date', e.target.value)} aria-label={t('common.date')} invalid={!!f.errors.date} />
            <AmountInput value={f.values.value} onChange={(e) => f.set('value', e.target.value)} currency={asset.currency} aria-label={t('nw.value')} placeholder={t('nw.value')} invalid={!!f.errors.value} />
            <Input value={f.values.note} onChange={(e) => f.set('note', e.target.value)} placeholder={t('nw.valuationNote')} aria-label={t('common.notes')} />
            <Button variant="primary" icon={<Plus className="size-4" />} loading={add.isPending} onClick={() => add.mutate(undefined, { onError: f.fail })}>
              {t('nw.revalue')}
            </Button>
          </div>
        )}
      </NoFieldId>
    </Panel>
  );
}

function SellModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { t } = useI18n();
  const f = useFormState({ date: localToday(), value: minorToInput(asset.value, asset.currency) });
  const sell = useAction(() => api.post(`/api/assets/${asset.id}/dispose`, f.values), { invalidate: INSIGHT_KEYS, silentFieldErrors: true, success: t('common.saved'), onSuccess: onClose });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('nw.markSold')}
      description={t('nw.sellHint')}
      size="sm"
      footer={
        <Button variant="primary" loading={sell.isPending} onClick={() => sell.mutate(undefined, { onError: f.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={f.formError} />
        <Field label={t('common.date')} error={f.errors.date}>
          <Input type="date" value={f.values.date} onChange={(e) => f.set('date', e.target.value)} />
        </Field>
        <Field label={t('nw.soldFor')} error={f.errors.value}>
          <AmountInput value={f.values.value} onChange={(e) => f.set('value', e.target.value)} currency={asset.currency} />
        </Field>
      </div>
    </Modal>
  );
}
