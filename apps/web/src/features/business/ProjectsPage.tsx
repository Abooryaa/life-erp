import { CURRENCIES, minorToInput, PROJECT_STATUSES } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Check, FolderKanban, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, Dot, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea, TextField } from '../../components/ui/form';
import { DataRow, PageHeader, Panel, Stat } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { useUI } from '../../layout/ui-context';
import { AmountInput, Bar, MissingRates, Money } from '../finance/fin-lib';
import { TransactionList } from '../finance/TransactionsPage';
import { LIFE_KEYS, TaskRow, useGoals, usePeople, type Task } from '../life/life-lib';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { LinksPanel } from '../shared/LinksPanel';
import { EntityTags } from '../shared/TagEditor';
import { BIZ_KEYS, ProjectHealthBadge, useOrganizations, type Project } from './biz-lib';

const healthTone = (h: Project['health']) => (h === 'delayed' || h === 'over_budget' ? 'neg' : h === 'at_risk' ? 'warn' : h === 'done' ? 'pos' : 'accent') as 'neg' | 'warn' | 'pos' | 'accent';

export function ProjectCard({ p }: { p: Project }) {
  const { t, fmt } = useI18n();
  const { byId } = useWorkspace();
  const ws = byId(p.workspaceId);
  return (
    <Link to={`/projects/${p.id}`} className="flex flex-col rounded-card border border-line bg-surface p-4 shadow-card hover:border-line-strong">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{p.name}</p>
          <p className="flex items-center gap-1.5 truncate text-[12.5px] text-ink-3">
            {ws ? (
              <>
                <Dot color={ws.color} />
                {ws.name}
              </>
            ) : (
              t('prj.personal')
            )}
            {p.clientName && ` · ${p.clientName}`}
          </p>
        </div>
        <ProjectHealthBadge health={p.health} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1">
          <Bar ratio={p.progress ?? 0} tone={healthTone(p.health)} />
        </div>
        <span className="num text-[12px] text-ink-3">{p.progress == null ? '—' : fmt.percent(p.progress)}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <p className="text-ink-3">{t('prj.revenue')}</p>
          <Money minor={p.revenue} currency={p.currency} compact className="font-medium" />
        </div>
        <div>
          <p className="text-ink-3">{t('prj.spent')}</p>
          <Money minor={p.spent} currency={p.currency} compact className="font-medium" />
        </div>
        <div>
          <p className="text-ink-3">{t('prj.profit')}</p>
          <Money minor={p.profit} currency={p.currency} compact colored className="font-medium" />
        </div>
      </div>
      {p.deadline && <p className="mt-2 text-[12px] text-ink-3">{t('goals.deadline')}: {fmt.date(p.deadline)}</p>}
    </Link>
  );
}

export function ProjectsPage() {
  const { t } = useI18n();
  const { currentId } = useWorkspace();
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['projects', 'list', filter, currentId],
    queryFn: () => api.get<Project[]>(`/api/projects${qs({ status: filter === 'open' ? 'open' : '', workspaceId: currentId })}`),
  });
  return (
    <div>
      <PageHeader
        title={t('prj.title')}
        actions={
          <>
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
              {(['open', 'all'] as const).map((f) => (
                <Button key={f} size="sm" variant={filter === f ? 'subtle' : 'ghost'} onClick={() => setFilter(f)}>
                  {f === 'open' ? t('prj.filterOpen') : t('prj.filterAll')}
                </Button>
              ))}
            </div>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              {t('prj.new')}
            </Button>
          </>
        }
      />
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : data.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<FolderKanban className="size-5" />} title={t('prj.empty')} body={t('prj.emptyBody')} action={<Button variant="primary" onClick={() => setCreating(true)}>{t('prj.new')}</Button>} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
      <ProjectFormModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const ui = useUI();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: ['projects', id], queryFn: () => api.get<Project>(`/api/projects/${id}`) });
  const tasks = useQuery({ queryKey: ['tasks', 'project', id], queryFn: () => api.get<Task[]>(`/api/tasks${qs({ projectId: id, view: 'all' })}`) });
  const ms = useFormState({ title: '', dueDate: '', amount: '' });
  const addMs = useAction(() => api.post(`/api/projects/${id}/milestones`, { title: ms.values.title, dueDate: ms.values.dueDate || null, amount: ms.values.amount || null }), {
    invalidate: BIZ_KEYS,
    silentFieldErrors: true,
    onSuccess: () => ms.reset(),
  });
  const toggleMs = useAction((m: { id: string; done: boolean }) => api.put(`/api/projects/${id}/milestones/${m.id}`, { done: !m.done }), { invalidate: BIZ_KEYS });
  const delMs = useAction((mid: string) => api.del(`/api/projects/${id}/milestones/${mid}`), { invalidate: BIZ_KEYS });
  const remove = useAction(() => api.del(`/api/projects/${id}`), { invalidate: BIZ_KEYS, onSuccess: () => navigate('/projects') });

  if (isLoading) return <LoadingBlock />;
  if (error || !p) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;
  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link to="/projects" className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t('prj.title')}
          </Link>
        }
        title={p.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge>{t(`prj.status.${p.status}` as MessageKey)}</Badge>
            <ProjectHealthBadge health={p.health} />
            {p.clientName}
          </span>
        }
        actions={
          <>
            <Button icon={<ArrowDownLeft className="size-4 text-pos" />} onClick={() => ui.openTransaction('income', null, { projectId: p.id, workspaceId: p.workspaceId })}>
              {t('prj.recordIncome')}
            </Button>
            <Button icon={<ArrowUpRight className="size-4 text-neg" />} onClick={() => ui.openTransaction('expense', null, { projectId: p.id, workspaceId: p.workspaceId })}>
              {t('prj.recordExpense')}
            </Button>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
              {t('common.edit')}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setDel(true)} aria-label={t('common.delete')}>
              <Trash2 className="size-4 text-neg" />
            </Button>
          </>
        }
      />
      <MissingRates list={p.missingRates} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Panel>
          <Stat label={t('prj.progress')} value={p.progress == null ? '—' : fmt.percent(p.progress)} hint={p.timeElapsed != null ? t('prj.timeElapsed', { p: fmt.percent(p.timeElapsed) }) : undefined} />
        </Panel>
        <Panel>
          <Stat label={t('prj.revenue')} value={<Money minor={p.revenue} currency={p.currency} compact />} hint={p.contractValue ? `/ ${fmt.money(p.contractValue, p.currency, { compact: true })}` : undefined} />
        </Panel>
        <Panel>
          <Stat label={t('prj.spent')} value={<Money minor={p.spent} currency={p.currency} compact />} hint={p.budget ? `/ ${fmt.money(p.budget, p.currency, { compact: true })}` : undefined} tone={p.health === 'over_budget' ? 'neg' : undefined} />
        </Panel>
        <Panel>
          <Stat label={t('prj.profit')} value={<Money minor={p.profit} currency={p.currency} compact />} tone={p.profit >= 0 ? 'pos' : 'neg'} />
        </Panel>
      </div>
      {p.budget != null && p.budgetUsed != null && (
        <div>
          <Bar ratio={p.budgetUsed} tone={p.budgetUsed > 1 ? 'neg' : p.budgetUsed > 0.8 ? 'warn' : 'accent'} />
          <p className="mt-1 text-[12px] text-ink-3">
            {t('prj.remaining')}: <Money minor={p.budgetRemaining ?? 0} currency={p.currency} colored />
          </p>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Panel title={t('prj.milestones')} padded={false}>
            <ul className="divide-y divide-line">
              {p.milestones?.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <button
                    onClick={() => toggleMs.mutate(m)}
                    className={clsx('flex size-5 shrink-0 items-center justify-center rounded border-2', m.done ? 'border-pos bg-pos text-white' : 'border-line-strong')}
                    aria-label={m.done ? t('task.reopen') : t('task.complete')}
                  >
                    {m.done && <Check className="size-3" strokeWidth={3} />}
                  </button>
                  <span className={clsx('min-w-0 flex-1 truncate', m.done && 'text-ink-3 line-through')}>{m.title}</span>
                  {m.amount != null && <Money minor={m.amount} currency={p.currency} className="text-[12.5px]" />}
                  {m.dueDate && <span className={clsx('num text-[12.5px]', !m.done && m.dueDate < new Date().toISOString().slice(0, 10) ? 'text-neg' : 'text-ink-3')}>{fmt.date(m.dueDate)}</span>}
                  <Button size="icon-sm" variant="ghost" onClick={() => delMs.mutate(m.id)} aria-label={t('common.delete')}>
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <form
              className="grid grid-cols-[minmax(0,1fr)_140px] gap-2 border-t border-line p-3 md:grid-cols-[minmax(0,1fr)_150px_140px_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                addMs.mutate(undefined, { onError: ms.fail });
              }}
            >
              <Input placeholder={t('prj.addMilestone')} value={ms.values.title} onChange={(e) => ms.set('title', e.target.value)} aria-label={t('prj.addMilestone')} invalid={!!ms.errors.title} />
              <Input type="date" value={ms.values.dueDate} onChange={(e) => ms.set('dueDate', e.target.value)} aria-label={t('task.dueDate')} />
              <AmountInput value={ms.values.amount} onChange={(e) => ms.set('amount', e.target.value)} currency={p.currency} placeholder={t('prj.milestoneAmount')} />
              <Button type="submit" variant="primary" loading={addMs.isPending} icon={<Plus className="size-4" />}>
                {t('common.add')}
              </Button>
            </form>
          </Panel>
          <Panel
            title={t('prj.tasks')}
            padded={false}
            actions={
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => ui.openTask({ defaults: { status: 'planned', workspaceId: p.workspaceId ?? undefined, projectId: p.id } })}>
                {t('quick.task')}
              </Button>
            }
          >
            {(tasks.data ?? []).filter((x) => x.status !== 'cancelled').length === 0 ? (
              <p className="p-4 text-[13px] text-ink-3">—</p>
            ) : (
              <ul className="divide-y divide-line">
                {tasks.data!.filter((x) => x.status !== 'cancelled').map((x) => (
                  <TaskRow key={x.id} task={x} onOpen={(task) => ui.openTask({ id: task.id })} showWorkspace={false} />
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={t('prj.money')} padded={false}>
            <TransactionList filter={{ projectId: p.id }} />
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel>
            <dl>
              <DataRow label={t('goals.startDate')}>{p.startDate ? fmt.date(p.startDate) : '—'}</DataRow>
              <DataRow label={t('goals.deadline')}>{p.deadline ? fmt.date(p.deadline) : '—'}</DataRow>
              <DataRow label={t('prj.contractValue')}>{p.contractValue ? <Money minor={p.contractValue} currency={p.currency} /> : '—'}</DataRow>
              <DataRow label={t('prj.budget')}>{p.budget ? <Money minor={p.budget} currency={p.currency} /> : '—'}</DataRow>
              {p.owner && <DataRow label={t('opp.owner')}>{p.owner}</DataRow>}
            </dl>
            {p.description && <p className="mt-3 text-[13.5px] whitespace-pre-wrap text-ink-2">{p.description}</p>}
            <div className="mt-4">
              <EntityTags type="project" id={p.id} tags={p.tags} invalidate={[['projects']]} />
            </div>
          </Panel>
          <AttachmentsPanel type="project" id={p.id} workspaceId={p.workspaceId} />
          <LinksPanel type="project" id={p.id} />
        </div>
      </div>
      <ProjectFormModal open={edit} onOpenChange={setEdit} project={p} />
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: p.name })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}

export function ProjectFormModal({ open, onOpenChange, project, defaultWorkspaceId }: { open: boolean; onOpenChange: (o: boolean) => void; project?: Project; defaultWorkspaceId?: string }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { workspaces, currentId } = useWorkspace();
  const { data: people = [] } = usePeople();
  const { data: orgs = [] } = useOrganizations();
  const { data: goals = [] } = useGoals();
  const init = () => ({
    name: project?.name ?? '',
    description: project?.description ?? '',
    workspaceId: project?.workspaceId ?? defaultWorkspaceId ?? currentId ?? '',
    personId: project?.personId ?? '',
    organizationId: project?.organizationId ?? '',
    goalId: project?.goalId ?? '',
    status: project?.status ?? 'planning',
    priority: String(project?.priority ?? 3),
    owner: project?.owner ?? '',
    startDate: project?.startDate ?? '',
    deadline: project?.deadline ?? '',
    currency: project?.currency ?? 'EGP',
    budget: project?.budget != null ? minorToInput(project.budget, project.currency) : '',
    contractValue: project?.contractValue != null ? minorToInput(project.contractValue, project.currency) : '',
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
  const save = useAction(
    () => {
      const body = {
        ...v,
        priority: Number(v.priority),
        workspaceId: v.workspaceId || null,
        personId: v.personId || null,
        organizationId: v.organizationId || null,
        goalId: v.goalId || null,
        owner: v.owner || null,
        startDate: v.startDate || null,
        deadline: v.deadline || null,
        budget: v.budget || null,
        contractValue: v.contractValue || null,
        description: v.description || null,
      };
      return project ? api.put<Project>(`/api/projects/${project.id}`, body) : api.post<Project>('/api/projects', body);
    },
    {
      invalidate: [...BIZ_KEYS, ...LIFE_KEYS],
      success: t('common.saved'),
      silentFieldErrors: true,
      onSuccess: (r) => {
        onOpenChange(false);
        if (!project) navigate(`/projects/${r.id}`);
      },
    },
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={project ? t('prj.edit') : t('prj.new')}
      size="lg"
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        <TextField label={t('common.name')} value={v.name} onChange={(e) => form.set('name', e.target.value)} error={form.errors.name} autoFocus />
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('common.workspace')}>
            <Select value={v.workspaceId} onChange={(e) => form.set('workspaceId', e.target.value)}>
              <option value="">{t('prj.personal')}</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('prj.status')}>
            <Select value={v.status} onChange={(e) => form.set('status', e.target.value as Project['status'])}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`prj.status.${s}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('task.priority')}>
            <Select value={v.priority} onChange={(e) => form.set('priority', e.target.value)}>
              {[1, 2, 3, 4].map((x) => (
                <option key={x} value={x}>
                  {t(`task.priority.${x}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('opp.client')} optional>
            <Select value={v.personId} onChange={(e) => form.set('personId', e.target.value)}>
              <option value="">—</option>
              {people.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('opp.company')} optional>
            <Select value={v.organizationId} onChange={(e) => form.set('organizationId', e.target.value)}>
              <option value="">—</option>
              {orgs.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('task.goal')} optional>
            <Select value={v.goalId} onChange={(e) => form.set('goalId', e.target.value)}>
              <option value="">—</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('goals.startDate')} optional>
            <Input type="date" value={v.startDate} onChange={(e) => form.set('startDate', e.target.value)} />
          </Field>
          <Field label={t('goals.deadline')} optional error={form.errors.deadline}>
            <Input type="date" value={v.deadline} onChange={(e) => form.set('deadline', e.target.value)} />
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
          <Field label={t('prj.contractValue')} optional error={form.errors.contractValue}>
            <AmountInput value={v.contractValue} onChange={(e) => form.set('contractValue', e.target.value)} currency={v.currency} />
          </Field>
          <Field label={t('prj.budget')} optional error={form.errors.budget}>
            <AmountInput value={v.budget} onChange={(e) => form.set('budget', e.target.value)} currency={v.currency} />
          </Field>
          <TextField label={t('opp.owner')} optional value={v.owner} onChange={(e) => form.set('owner', e.target.value)} />
        </div>
        <Field label={t('common.description')} optional>
          <Textarea value={v.description} onChange={(e) => form.set('description', e.target.value)} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}
