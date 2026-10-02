import { CURRENCIES, minorToInput } from '@life-erp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, FolderKanban, Plus, Settings2, Trash2, TrendingUp } from 'lucide-react';
import { useEffect, useState, type DragEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { EmptyState, LoadingBlock, Spinner, useToast } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea, TextField } from '../../components/ui/form';
import { PageHeader } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { AmountInput, Money } from '../finance/fin-lib';
import { usePeople } from '../life/life-lib';
import { LinksPanel } from '../shared/LinksPanel';
import { TagInput } from '../shared/TagEditor';
import { BIZ_KEYS, BusinessSelect, useBusinessChoice, useOrganizations, type Opportunity, type Pipeline, type Stage } from './biz-lib';

interface Analytics {
  base: string;
  stats: { openCount: number; openValue: number; weightedValue: number; wonCount: number; wonValue: number; lostCount: number; winRate: number | null; avgWonDeal: number | null };
  byStage: { stageId: string; name: string; kind: string; count: number; value: number }[];
}

export function PipelinePage() {
  const { t, fmt } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { businessId, setBusinessId, businesses } = useBusinessChoice();
  const [editing, setEditing] = useState<{ id?: string; stageId?: string } | null>(null);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const pipes = useQuery({ queryKey: ['pipelines', businessId], queryFn: () => api.get<Pipeline[]>(`/api/pipelines?workspaceId=${businessId}`), enabled: !!businessId });
  const pipeline = pipes.data?.[0];
  const opps = useQuery({
    queryKey: ['opportunities', businessId],
    queryFn: () => api.get<Opportunity[]>(`/api/opportunities${qs({ workspaceId: businessId })}`),
    enabled: !!businessId,
  });
  const stats = useQuery({ queryKey: ['opportunities', 'analytics', businessId], queryFn: () => api.get<Analytics>(`/api/pipelines/analytics?workspaceId=${businessId}`), enabled: !!businessId });

  useEffect(() => {
    const open = params.get('open');
    if (!open) return;
    setEditing({ id: open });
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete('open');
      return n;
    }, { replace: true });
  }, [params.get('open')]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = async (id: string, stageId: string) => {
    try {
      await api.post(`/api/opportunities/${id}/move`, { stageId });
      await Promise.all(BIZ_KEYS.map((k) => qc.invalidateQueries({ queryKey: k })));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (!businesses.length) return <EmptyState icon={<TrendingUp className="size-5" />} title={t('opp.chooseBusiness')} />;
  const s = stats.data?.stats;
  return (
    <div>
      <PageHeader
        title={t('opp.title')}
        subtitle={t('opp.dragHint')}
        actions={
          <>
            <BusinessSelect value={businessId} onChange={setBusinessId} />
            <Button icon={<Settings2 className="size-4" />} onClick={() => setStagesOpen(true)} disabled={!pipeline}>
              {t('opp.editStages')}
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({})}>
              {t('opp.new')}
            </Button>
          </>
        }
      />
      {s && stats.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            [t('opp.openValue'), <Money key="o" minor={s.openValue} currency={stats.data.base} compact />, `${s.openCount}`],
            [t('opp.weighted'), <Money key="w" minor={s.weightedValue} currency={stats.data.base} compact />, null],
            [t('opp.wonValue'), <Money key="v" minor={s.wonValue} currency={stats.data.base} compact className="text-pos" />, `${s.wonCount}`],
            [t('opp.winRate'), s.winRate == null ? '—' : fmt.percent(s.winRate), `${s.wonCount}/${s.wonCount + s.lostCount}`],
            [t('opp.avgDeal'), s.avgWonDeal == null ? '—' : <Money key="a" minor={s.avgWonDeal} currency={stats.data.base} compact />, null],
          ].map(([label, value, hint], i) => (
            <div key={i} className="rounded-card border border-line bg-surface p-3 shadow-card">
              <p className="text-[12px] text-ink-3">{label}</p>
              <p className="mt-0.5 text-[18px] font-semibold">{value}</p>
              {hint && <p className="text-[12px] text-ink-3">{hint}</p>}
            </div>
          ))}
        </div>
      )}
      {pipes.isLoading || opps.isLoading ? (
        <LoadingBlock />
      ) : !pipeline ? null : (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 scrollbar-thin md:mx-0 md:px-0">
          {pipeline.stages.map((st) => {
            const items = (opps.data ?? []).filter((o) => o.stageId === st.id);
            const total = items.reduce((sum, o) => sum + o.value, 0);
            return (
              <section
                key={st.id}
                onDragOver={(e: DragEvent) => {
                  e.preventDefault();
                  setOver(st.id);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  setOver(null);
                  const id = e.dataTransfer.getData('text/opp');
                  if (id) void move(id, st.id);
                }}
                className={clsx(
                  'flex w-64 shrink-0 flex-col rounded-card border bg-surface-2/60',
                  over === st.id ? 'border-accent' : 'border-line',
                  st.kind === 'won' && 'bg-pos-soft/40',
                  st.kind === 'lost' && 'bg-neg-soft/30',
                )}
              >
                <header className="px-3 pt-2.5 pb-1">
                  <p className="flex items-center justify-between text-[12.5px] font-semibold text-ink-2 uppercase">
                    {st.name}
                    <span className="text-ink-3">{items.length}</span>
                  </p>
                  <p className="text-[11.5px] text-ink-3">
                    {st.kind === 'open' ? `${st.probability}% · ` : ''}
                    {items.length ? fmt.money(total, items[0].currency, { compact: true }) : ''}
                  </p>
                </header>
                <ul className="flex min-h-28 flex-col gap-2 p-2">
                  {items.map((o) => (
                    <li
                      key={o.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/opp', o.id)}
                      onClick={() => setEditing({ id: o.id })}
                      className="cursor-pointer rounded-lg border border-line bg-surface p-2.5 shadow-card hover:border-line-strong"
                    >
                      <p className="text-[13.5px] font-medium">{o.title}</p>
                      <p className="truncate text-[12px] text-ink-3">{o.organizationName ?? o.personName ?? '—'}</p>
                      <div className="mt-1.5 flex items-center justify-between">
                        <Money minor={o.value} currency={o.currency} compact className="text-[12.5px] font-semibold" />
                        {o.nextActionDate && <span className={clsx('text-[11.5px]', o.kind === 'open' && o.nextActionDate <= new Date().toISOString().slice(0, 10) ? 'text-warn' : 'text-ink-3')}>{fmt.date(o.nextActionDate)}</span>}
                      </div>
                    </li>
                  ))}
                  <button onClick={() => setEditing({ stageId: st.id })} className="rounded-lg px-2 py-1.5 text-start text-[12.5px] text-ink-3 hover:bg-surface hover:text-ink">
                    + {t('opp.new')}
                  </button>
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {editing && pipeline && (
        <OpportunityModal key={editing.id ?? 'new'} businessId={businessId} pipeline={pipeline} oppId={editing.id} defaultStageId={editing.stageId} onClose={() => setEditing(null)} />
      )}
      {stagesOpen && pipeline && <StagesModal pipeline={pipeline} onClose={() => setStagesOpen(false)} />}
    </div>
  );
}

export function OpportunityModal({ businessId, pipeline, oppId, defaultStageId, onClose }: { businessId: string; pipeline: Pipeline; oppId?: string; defaultStageId?: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [del, setDel] = useState(false);
  const { data: people = [] } = usePeople();
  const { data: orgs = [] } = useOrganizations();
  const existing = useQuery({ queryKey: ['opportunities', 'one', oppId], queryFn: () => api.get<Opportunity>(`/api/opportunities/${oppId}`), enabled: !!oppId });
  const form = useFormState({
    title: '',
    stageId: defaultStageId ?? pipeline.stages[0]?.id ?? '',
    personId: '',
    organizationId: '',
    value: '',
    currency: 'EGP',
    probability: '',
    expectedClose: '',
    owner: '',
    source: '',
    nextAction: '',
    nextActionDate: '',
    lostReason: '',
    notes: '',
    tags: [] as string[],
  });
  useEffect(() => {
    const o = existing.data;
    if (o)
      form.setValues({
        title: o.title,
        stageId: o.stageId,
        personId: o.personId ?? '',
        organizationId: o.organizationId ?? '',
        value: minorToInput(o.value, o.currency),
        currency: o.currency,
        probability: o.probability == null ? '' : String(o.probability),
        expectedClose: o.expectedClose ?? '',
        owner: o.owner ?? '',
        source: o.source ?? '',
        nextAction: o.nextAction ?? '',
        nextActionDate: o.nextActionDate ?? '',
        lostReason: o.lostReason ?? '',
        notes: o.notes ?? '',
        tags: o.tags,
      });
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const stage = pipeline.stages.find((s) => s.id === v.stageId);
  const body = () => ({
    ...v,
    workspaceId: businessId,
    pipelineId: pipeline.id,
    personId: v.personId || null,
    organizationId: v.organizationId || null,
    value: v.value || '0',
    probability: v.probability === '' ? null : Number(v.probability),
    expectedClose: v.expectedClose || null,
    nextActionDate: v.nextActionDate || null,
    owner: v.owner || null,
    source: v.source || null,
    nextAction: v.nextAction || null,
    lostReason: v.lostReason || null,
    notes: v.notes || null,
  });
  const save = useAction(() => (oppId ? api.put(`/api/opportunities/${oppId}`, body()) : api.post('/api/opportunities', body())), {
    invalidate: BIZ_KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: onClose,
  });
  const toProject = useAction(() => api.post<{ id: string }>(`/api/opportunities/${oppId}/project`), {
    invalidate: BIZ_KEYS,
    success: t('opp.projectCreated'),
    onSuccess: (p) => navigate(`/projects/${p.id}`),
  });
  const remove = useAction(() => api.del(`/api/opportunities/${oppId}`), { invalidate: BIZ_KEYS, onSuccess: onClose });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={oppId ? t('opp.edit') : t('opp.new')}
      size="lg"
      footer={
        <>
          {oppId && (
            <Button variant="ghost" icon={<Trash2 className="size-4 text-neg" />} onClick={() => setDel(true)} className="me-auto">
              {t('common.delete')}
            </Button>
          )}
          {oppId && existing.data?.kind === 'won' && (
            <Button icon={<FolderKanban className="size-4" />} loading={toProject.isPending} onClick={() => toProject.mutate(undefined)}>
              {t('opp.createProject')}
            </Button>
          )}
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {oppId && existing.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <FormError message={form.formError} />
          <TextField label={t('common.name')} value={v.title} onChange={(e) => form.set('title', e.target.value)} error={form.errors.title} autoFocus={!oppId} />
          <Field label={t('opp.stage')}>
            <div className="flex flex-wrap gap-1.5">
              {pipeline.stages.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => form.set('stageId', st.id)}
                  className={clsx(
                    'rounded-full px-3 py-1 text-[12.5px] font-medium',
                    v.stageId === st.id ? (st.kind === 'won' ? 'bg-pos text-white' : st.kind === 'lost' ? 'bg-neg text-white' : 'bg-ink text-canvas') : 'bg-surface-2 text-ink-2',
                  )}
                >
                  {st.name}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('opp.value')} error={form.errors.value}>
              <AmountInput value={v.value} onChange={(e) => form.set('value', e.target.value)} currency={v.currency} invalid={!!form.errors.value} />
            </Field>
            <Field label={t('common.currency')}>
              <Select value={v.currency} onChange={(e) => form.set('currency', e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name[locale]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('opp.client')} optional>
              <Select value={v.personId} onChange={(e) => form.set('personId', e.target.value)}>
                <option value="">—</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('opp.company')} optional>
              <Select value={v.organizationId} onChange={(e) => form.set('organizationId', e.target.value)}>
                <option value="">—</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('opp.probability')} hint={t('opp.probabilityHint')} error={form.errors.probability}>
              <Input type="number" min={0} max={100} value={v.probability} placeholder={stage ? String(stage.probability) : ''} onChange={(e) => form.set('probability', e.target.value)} />
            </Field>
            <Field label={t('opp.expectedClose')} optional>
              <Input type="date" value={v.expectedClose} onChange={(e) => form.set('expectedClose', e.target.value)} />
            </Field>
            <TextField label={t('opp.nextAction')} optional value={v.nextAction} onChange={(e) => form.set('nextAction', e.target.value)} />
            <Field label={t('opp.nextActionDate')} optional>
              <Input type="date" value={v.nextActionDate} onChange={(e) => form.set('nextActionDate', e.target.value)} />
            </Field>
            <TextField label={t('opp.source')} optional value={v.source} onChange={(e) => form.set('source', e.target.value)} />
            <TextField label={t('opp.owner')} optional value={v.owner} onChange={(e) => form.set('owner', e.target.value)} />
          </div>
          {stage?.kind === 'lost' && <TextField label={t('opp.lostReason')} value={v.lostReason} onChange={(e) => form.set('lostReason', e.target.value)} />}
          <Field label={t('common.tags')} optional>
            <TagInput value={v.tags} onChange={(tags) => form.set('tags', tags)} />
          </Field>
          <Field label={t('common.notes')} optional>
            <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={3} />
          </Field>
          {oppId && <LinksPanel type="opportunity" id={oppId} />}
        </div>
      )}
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: v.title })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}

function StagesModal({ pipeline, onClose }: { pipeline: Pipeline; onClose: () => void }) {
  const { t } = useI18n();
  const [stages, setStages] = useState<Partial<Stage>[]>(pipeline.stages);
  const form = useFormState({});
  const save = useAction(() => api.put(`/api/pipelines/${pipeline.id}`, { stages }), { invalidate: BIZ_KEYS, success: t('common.saved'), silentFieldErrors: true, onSuccess: onClose });
  const set = (i: number, patch: Partial<Stage>) => setStages((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const swap = (i: number, j: number) =>
    setStages((s) => {
      if (j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('opp.stagesTitle')}
      size="lg"
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-2">
        <FormError message={form.formError ?? form.errors.stages} />
        {stages.map((s, i) => (
          <div key={s.id ?? `new-${i}`} className="grid grid-cols-[minmax(0,1fr)_80px_110px_auto] items-center gap-2">
            <Input value={s.name ?? ''} onChange={(e) => set(i, { name: e.target.value })} aria-label={t('common.name')} />
            <Input type="number" min={0} max={100} value={s.probability ?? 0} onChange={(e) => set(i, { probability: Number(e.target.value) })} aria-label={t('opp.probability')} />
            <Select value={s.kind ?? 'open'} onChange={(e) => set(i, { kind: e.target.value as Stage['kind'] })} aria-label={t('common.type')}>
              {(['open', 'won', 'lost'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`opp.kind.${k}` as MessageKey)}
                </option>
              ))}
            </Select>
            <div className="flex">
              <Button size="icon-sm" variant="ghost" onClick={() => swap(i, i - 1)} aria-label="Up">
                <ArrowUp className="size-4" />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => swap(i, i + 1)} aria-label="Down">
                <ArrowDown className="size-4" />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => setStages((x) => x.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                <Trash2 className="size-4 text-neg" />
              </Button>
            </div>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setStages((s) => [...s.slice(0, -2), { name: '', probability: 50, kind: 'open' }, ...s.slice(-2)])}>
          {t('opp.addStage')}
        </Button>
      </div>
    </Modal>
  );
}
