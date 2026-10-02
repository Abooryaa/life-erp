import { BUSINESS_ROLES, currencyDigits, fromMinor } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { Chart } from '../../components/Chart';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { Badge, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Select } from '../../components/ui/form';
import { Panel, Stat } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { useUI } from '../../layout/ui-context';
import { MissingRates, Money } from '../finance/fin-lib';
import { TaskRow, usePeople, type Task } from '../life/life-lib';
import { BIZ_KEYS, useOrganizations, type Opportunity, type Project, type Relation } from './biz-lib';
import { ProjectCard, ProjectFormModal } from './ProjectsPage';

interface Overview {
  base: string;
  pnl: {
    month: { income: number; expenses: number; profit: number };
    ytd: { income: number; expenses: number; profit: number; margin: number | null };
    series: { month: string; income: number; expenses: number; net: number }[];
    costs: { items: { id: string; name: string; nameAr: string | null; color: string | null; total: number }[] };
  };
  pipeline: { stats: { openCount: number; openValue: number; weightedValue: number; wonValue: number; winRate: number | null }; byStage: { stageId: string; name: string; kind: string; count: number; value: number }[] };
  nextActions: Opportunity[];
  projects: { open: Project[]; delayed: number; atRisk: number };
  roles: Record<string, number>;
  openTasks: Task[];
  missingRates: string[];
}

/** The home page of one business: P&L, pipeline, projects, contacts by role and open work. */
export function BusinessOverview({ workspaceId }: { workspaceId: string }) {
  const { t, fmt, locale, dir } = useI18n();
  const ui = useUI();
  const [newProject, setNewProject] = useState(false);
  const [addRel, setAddRel] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['business', workspaceId], queryFn: () => api.get<Overview>(`/api/business/${workspaceId}/overview`) });
  const relations = useQuery({ queryKey: ['relations', workspaceId], queryFn: () => api.get<Relation[]>(`/api/relations?workspaceId=${workspaceId}`) });
  const removeRel = useAction((id: string) => api.del(`/api/relations/${id}`), { invalidate: BIZ_KEYS });
  const trend = useCallback(
    (tk: (n: string) => string) => {
      const s = data?.pnl.series ?? [];
      const digits = currencyDigits(data?.base ?? 'EGP');
      return {
        grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
        legend: { top: 0, textStyle: { color: tk('ink-2') }, itemWidth: 10, itemHeight: 10 },
        tooltip: { trigger: 'axis', valueFormatter: (v: number) => fmt.money(Math.round(v * 10 ** digits), data?.base) },
        xAxis: {
          type: 'category',
          inverse: dir === 'rtl',
          data: s.map((m) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m.month}-15T12:00:00Z`))),
          axisLabel: { color: tk('ink-3') },
          axisLine: { lineStyle: { color: tk('line-strong') } },
        },
        yAxis: { type: 'value', position: dir === 'rtl' ? 'right' : 'left', splitLine: { lineStyle: { color: tk('line') } }, axisLabel: { color: tk('ink-3'), formatter: (v: number) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(v) } },
        series: [
          { name: t('fin.income'), type: 'bar', barMaxWidth: 16, data: s.map((m) => fromMinor(m.income, data?.base)), itemStyle: { color: tk('pos'), borderRadius: [3, 3, 0, 0] } },
          { name: t('fin.expenses'), type: 'bar', barMaxWidth: 16, data: s.map((m) => fromMinor(m.expenses, data?.base)), itemStyle: { color: tk('neg'), borderRadius: [3, 3, 0, 0] } },
          { name: t('biz.profit'), type: 'line', smooth: true, data: s.map((m) => fromMinor(m.net, data?.base)), lineStyle: { color: tk('accent') }, itemStyle: { color: tk('accent') } },
        ],
      };
    },
    [data, locale, dir, fmt, t],
  );
  if (isLoading || !data) return <LoadingBlock />;
  const p = data.pnl;
  const maxStage = Math.max(1, ...data.pipeline.byStage.filter((s) => s.kind === 'open').map((s) => s.value));
  return (
    <div className="space-y-5">
      <MissingRates list={data.missingRates} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Panel>
          <Stat label={`${t('fin.income')} · ${t('biz.thisMonth')}`} value={<Money minor={p.month.income} currency={data.base} compact />} hint={`${t('biz.ytd')}: ${fmt.money(p.ytd.income, data.base, { compact: true })}`} />
        </Panel>
        <Panel>
          <Stat label={`${t('fin.expenses')} · ${t('biz.thisMonth')}`} value={<Money minor={p.month.expenses} currency={data.base} compact />} hint={`${t('biz.ytd')}: ${fmt.money(p.ytd.expenses, data.base, { compact: true })}`} />
        </Panel>
        <Panel>
          <Stat
            label={`${t('biz.profit')} · ${t('biz.ytd')}`}
            value={<Money minor={p.ytd.profit} currency={data.base} compact />}
            tone={p.ytd.profit >= 0 ? 'pos' : 'neg'}
            hint={p.ytd.margin == null ? undefined : `${t('biz.margin')} ${fmt.percent(p.ytd.margin)}`}
          />
        </Panel>
        <Panel>
          <Stat
            label={t('opp.weighted')}
            value={<Money minor={data.pipeline.stats.weightedValue} currency={data.base} compact />}
            hint={`${t('opp.openValue')}: ${fmt.money(data.pipeline.stats.openValue, data.base, { compact: true })}`}
          />
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title={t('biz.trend')} className="xl:col-span-2">
          <Chart option={trend} height={240} ariaLabel={t('biz.trend')} />
        </Panel>
        <Panel
          title={t('opp.title')}
          actions={
            <Link to="/pipeline" className="text-[13px] font-medium text-accent hover:underline">
              {t('common.open')}
            </Link>
          }
        >
          <ul className="space-y-2">
            {data.pipeline.byStage
              .filter((s) => s.kind === 'open')
              .map((s) => (
                <li key={s.stageId} className="text-[13px]">
                  <div className="flex justify-between">
                    <span>
                      {s.name} <span className="text-ink-3">· {s.count}</span>
                    </span>
                    <Money minor={s.value} currency={data.base} compact className="text-ink-2" />
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(s.value / maxStage) * 100}%` }} />
                  </div>
                </li>
              ))}
          </ul>
          <p className="mt-3 text-[12.5px] text-ink-3">
            {t('opp.winRate')}: {data.pipeline.stats.winRate == null ? '—' : fmt.percent(data.pipeline.stats.winRate)} · {t('opp.wonValue')}: {fmt.money(data.pipeline.stats.wonValue, data.base, { compact: true })}
          </p>
        </Panel>
      </div>

      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            {t('biz.openProjects')}
            {data.projects.delayed > 0 && <Badge tone="neg">{t('biz.delayed', { n: data.projects.delayed })}</Badge>}
            {data.projects.atRisk > 0 && <Badge tone="warn">{t('biz.atRisk', { n: data.projects.atRisk })}</Badge>}
          </span>
        }
        padded={data.projects.open.length === 0}
        actions={
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setNewProject(true)}>
            {t('prj.new')}
          </Button>
        }
      >
        {data.projects.open.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t('prj.empty')}</p>
        ) : (
          <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
            {data.projects.open.map((x) => (
              <ProjectCard key={x.id} p={x} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title={t('rel.title')}
          padded={false}
          actions={
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAddRel(true)}>
              {t('common.add')}
            </Button>
          }
        >
          {(relations.data ?? []).length === 0 ? (
            <p className="p-4 text-[13px] text-ink-3">{t('rel.empty')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {relations.data!.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Link to={r.kind === 'person' ? `/people/${r.personId}` : `/companies/${r.organizationId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    {r.name}
                  </Link>
                  <Badge tone={r.role === 'client' ? 'pos' : r.role === 'lead' || r.role === 'prospect' ? 'accent' : 'neutral'}>{t(`rel.role.${r.role}` as MessageKey)}</Badge>
                  <Button size="icon-sm" variant="ghost" onClick={() => removeRel.mutate(r.id)} aria-label={t('common.remove')}>
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="space-y-5">
          {data.nextActions.length > 0 && (
            <Panel title={t('opp.needsAction')} padded={false}>
              <ul className="divide-y divide-line">
                {data.nextActions.map((o) => (
                  <li key={o.id}>
                    <Link to={`/pipeline?open=${o.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{o.nextAction ?? o.title}</span>
                        <span className="block truncate text-[12px] text-ink-3">{o.title}</span>
                      </span>
                      <span className="num text-[12.5px] text-warn">{o.nextActionDate && fmt.date(o.nextActionDate)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel
            title={t('biz.openTasks')}
            padded={false}
            actions={
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => ui.openTask({ defaults: { workspaceId, status: 'planned' } })}>
                {t('quick.task')}
              </Button>
            }
          >
            {data.openTasks.length === 0 ? (
              <p className="p-4 text-[13px] text-ink-3">—</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.openTasks.map((x) => (
                  <TaskRow key={x.id} task={x} onOpen={(task) => ui.openTask({ id: task.id })} showWorkspace={false} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      <ProjectFormModal open={newProject} onOpenChange={setNewProject} defaultWorkspaceId={workspaceId} />
      <AddRelationModal open={addRel} onOpenChange={setAddRel} workspaceId={workspaceId} />
    </div>
  );
}

function AddRelationModal({ open, onOpenChange, workspaceId }: { open: boolean; onOpenChange: (o: boolean) => void; workspaceId: string }) {
  const { t } = useI18n();
  const { data: people = [] } = usePeople();
  const { data: orgs = [] } = useOrganizations();
  const form = useFormState({ who: '', role: 'client' });
  const save = useAction(
    () => {
      const [kind, id] = form.values.who.split(':');
      return api.post('/api/relations', { workspaceId, role: form.values.role, personId: kind === 'p' ? id : null, organizationId: kind === 'o' ? id : null });
    },
    {
      invalidate: BIZ_KEYS,
      success: t('common.saved'),
      silentFieldErrors: true,
      onSuccess: () => {
        form.reset();
        onOpenChange(false);
      },
    },
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('rel.add')}
      size="sm"
      footer={
        <Button variant="primary" loading={save.isPending} disabled={!form.values.who} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.add')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError ?? form.errors.personId} />
        <Field label={t('rel.who')}>
          <Select value={form.values.who} onChange={(e) => form.set('who', e.target.value)}>
            <option value="">—</option>
            <optgroup label={t('rel.person')}>
              {people.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.fullName}
                </option>
              ))}
            </optgroup>
            <optgroup label={t('rel.company')}>
              {orgs.map((o) => (
                <option key={o.id} value={`o:${o.id}`}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
        <Field label={t('rel.role')}>
          <Select value={form.values.role} onChange={(e) => form.set('role', e.target.value)}>
            {BUSINESS_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`rel.role.${r}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
