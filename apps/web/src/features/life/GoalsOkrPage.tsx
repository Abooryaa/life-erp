import { GOAL_LEVELS, GOAL_METRICS, LIFE_AREAS } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, ChevronRight, Pencil, Plus, Target, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock, type Tone } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea, TextField } from '../../components/ui/form';
import { DataRow, PageHeader, Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { useUI } from '../../layout/ui-context';
import { Bar } from '../finance/fin-lib';
import { LinksPanel } from '../shared/LinksPanel';
import { LIFE_KEYS, TaskRow, useGoals, type Goal, type Task } from './life-lib';
import { localToday } from './TasksPage';

const HEALTH_TONE: Record<string, Tone> = { on_track: 'pos', achieved: 'pos', at_risk: 'warn', behind: 'neg', overdue: 'neg', no_deadline: 'neutral' };
const barTone = (h: Goal['health']) => (h === 'behind' || h === 'overdue' ? 'neg' : h === 'at_risk' ? 'warn' : h === 'achieved' ? 'pos' : 'accent') as 'neg' | 'warn' | 'pos' | 'accent';

export function HealthBadge({ goal }: { goal: Pick<Goal, 'health' | 'status'> }) {
  const { t } = useI18n();
  if (goal.status !== 'active' && goal.status !== 'achieved') return <Badge>{t(`goals.status.${goal.status}` as MessageKey)}</Badge>;
  if (!goal.health || goal.health === 'no_deadline') return null;
  return <Badge tone={HEALTH_TONE[goal.health]}>{t(`goals.health.${goal.health}` as MessageKey)}</Badge>;
}

function GoalNode({ goal, all, depth }: { goal: Goal; all: Goal[]; depth: number }) {
  const { t, fmt } = useI18n();
  const kids = all.filter((g) => g.parentId === goal.id);
  return (
    <li>
      <Link to={`/goals/${goal.id}`} className="flex items-center gap-3 py-2.5 pe-4 hover:bg-surface-2" style={{ paddingInlineStart: 16 + depth * 22 }}>
        {depth > 0 && <ChevronRight className="size-3.5 shrink-0 text-ink-3 rtl:rotate-180" />}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className={clsx('truncate', depth === 0 ? 'font-semibold' : 'font-medium')}>{goal.title}</span>
            <span className="text-[11.5px] text-ink-3 uppercase">{t(`goals.level.${goal.level}` as MessageKey)}</span>
            <HealthBadge goal={goal} />
          </p>
          {goal.progress != null && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="max-w-56 flex-1">
                <Bar ratio={goal.progress} tone={barTone(goal.health)} />
              </div>
              <span className="num text-[12px] text-ink-3">{fmt.percent(goal.progress)}</span>
            </div>
          )}
        </div>
        {goal.deadline && <span className="num shrink-0 text-[12.5px] text-ink-3">{fmt.date(goal.deadline)}</span>}
      </Link>
      {kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <GoalNode key={k.id} goal={k} all={all} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function GoalsOkrPage() {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const { currentId } = useWorkspace();
  const { data = [], isLoading, error, refetch } = useGoals();
  if (isLoading) return <LoadingBlock />;
  if (error) return <ErrorBlock error={error} onRetry={refetch} />;
  const visible = data.filter((g) => (showInactive || g.status === 'active' || g.status === 'achieved') && (!currentId || !g.workspaceId || g.workspaceId === currentId));
  const ids = new Set(visible.map((g) => g.id));
  const roots = visible.filter((g) => !g.parentId || !ids.has(g.parentId));
  return (
    <div>
      <PageHeader
        title={t('goals.title')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowInactive((s) => !s)}>
              {t('common.showArchived')}
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              {t('goals.new')}
            </Button>
          </>
        }
      />
      {roots.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Target className="size-5" />} title={t('goals.empty')} body={t('goals.emptyBody')} action={<Button variant="primary" onClick={() => setCreating(true)}>{t('goals.new')}</Button>} />
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface shadow-card">
          {roots.map((g) => (
            <GoalNode key={g.id} goal={g} all={visible} depth={0} />
          ))}
        </ul>
      )}
      <GoalFormModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}

interface GoalDetail extends Goal {
  children: Goal[];
  parent: Goal | null;
  checkins: { id: string; date: string; value: number; note: string | null }[];
  tags: string[];
}

export function GoalDetailOkrPage() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const ui = useUI();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [addSub, setAddSub] = useState(false);
  const [del, setDel] = useState(false);
  const { data: g, isLoading, error, refetch } = useQuery({ queryKey: ['goals', id], queryFn: () => api.get<GoalDetail>(`/api/goals/${id}`) });
  const tasks = useQuery({ queryKey: ['tasks', 'goal', id], queryFn: () => api.get<Task[]>(`/api/tasks${qs({ goalId: id, view: 'all' })}`) });
  const checkin = useFormState({ date: localToday(), value: '', note: '' });
  const addCheckin = useAction(() => api.post(`/api/goals/${id}/checkins`, { ...checkin.values, note: checkin.values.note || null }), {
    invalidate: LIFE_KEYS,
    silentFieldErrors: true,
    onSuccess: () => checkin.set('value', ''),
  });
  const delCheckin = useAction((cid: string) => api.del(`/api/goals/${id}/checkins/${cid}`), { invalidate: LIFE_KEYS });
  const setStatus = useAction((status: string) => api.put(`/api/goals/${id}`, { status }), { invalidate: LIFE_KEYS });
  const remove = useAction(() => api.del(`/api/goals/${id}`), { invalidate: LIFE_KEYS, onSuccess: () => navigate('/goals') });
  if (isLoading) return <LoadingBlock />;
  if (error || !g) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;
  const fmtVal = (n: number | null) => (n == null ? '—' : `${fmt.number(n)}${g.unit ? ` ${g.unit}` : ''}`);
  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link to={g.parent ? `/goals/${g.parent.id}` : '/goals'} className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {g.parent?.title ?? t('goals.title')}
          </Link>
        }
        title={g.title}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {t(`goals.level.${g.level}` as MessageKey)}
            {g.area && `· ${t(`area.${g.area}` as MessageKey)}`}
            <HealthBadge goal={g} />
          </span>
        }
        actions={
          <>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
              {t('common.edit')}
            </Button>
            {g.status === 'active' ? (
              <Button onClick={() => setStatus.mutate('achieved')}>{t('goals.status.achieved')}</Button>
            ) : (
              <Button onClick={() => setStatus.mutate('active')}>{t('goals.status.active')}</Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => setDel(true)} aria-label={t('common.delete')}>
              <X className="size-4 text-neg" />
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Panel>
            <div className="flex items-end justify-between gap-3">
              <p className="text-[28px] font-semibold">{g.progress == null ? '—' : fmt.percent(g.progress)}</p>
              <p className="text-[13px] text-ink-3">
                {g.metric === 'numeric' && `${fmtVal(g.currentValue)} / ${fmtVal(g.targetValue)}`}
                {g.metric === 'tasks' && t('goals.tasksDone', { done: g.tasksDone, total: g.tasksTotal })}
              </p>
            </div>
            {g.progress != null && (
              <div className="mt-2">
                <Bar ratio={g.progress} tone={barTone(g.health)} />
              </div>
            )}
            {g.description && <p className="mt-4 text-[13.5px] whitespace-pre-wrap text-ink-2">{g.description}</p>}
          </Panel>
          {g.metric === 'numeric' && (
            <Panel title={t('goals.checkins')} padded={false}>
              <form
                className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 border-b border-line p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  addCheckin.mutate(undefined, { onError: checkin.fail });
                }}
              >
                <Field label={`${t('goals.value')}${g.unit ? ` (${g.unit})` : ''}`} error={checkin.errors.value}>
                  <Input inputMode="decimal" dir="ltr" value={checkin.values.value} onChange={(e) => checkin.set('value', e.target.value)} />
                </Field>
                <Field label={t('common.date')}>
                  <Input type="date" value={checkin.values.date} onChange={(e) => checkin.set('date', e.target.value)} />
                </Field>
                <Button type="submit" variant="primary" loading={addCheckin.isPending}>
                  {t('goals.checkin')}
                </Button>
              </form>
              <ul className="divide-y divide-line">
                {g.checkins.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="num w-24 text-[13px] text-ink-3">{fmt.date(c.date)}</span>
                    <span className="num flex-1 font-medium">{fmtVal(c.value)}</span>
                    <Button size="icon-sm" variant="ghost" onClick={() => delCheckin.mutate(c.id)} aria-label={t('common.delete')}>
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel
            title={t('goals.subgoals')}
            padded={false}
            actions={
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAddSub(true)}>
                {t('goals.addSub')}
              </Button>
            }
          >
            {g.children.length === 0 ? (
              <p className="p-4 text-[13px] text-ink-3">—</p>
            ) : (
              <ul className="divide-y divide-line">
                {g.children.map((c) => (
                  <GoalNode key={c.id} goal={c} all={[]} depth={0} />
                ))}
              </ul>
            )}
          </Panel>
          <Panel
            title={t('goals.tasks')}
            padded={false}
            actions={
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => ui.openTask({ defaults: { goalId: g.id, status: 'planned' } })}>
                {t('goals.addTask')}
              </Button>
            }
          >
            {(tasks.data ?? []).length === 0 ? (
              <p className="p-4 text-[13px] text-ink-3">—</p>
            ) : (
              <ul className="divide-y divide-line">
                {tasks.data!.filter((x) => x.status !== 'cancelled').map((x) => (
                  <TaskRow key={x.id} task={x} onOpen={(task) => ui.openTask({ id: task.id })} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel>
            <dl>
              <DataRow label={t('goals.metric')}>{t(`goals.metric.${g.metric}` as MessageKey)}</DataRow>
              <DataRow label={t('goals.startDate')}>{g.startDate ? fmt.date(g.startDate) : '—'}</DataRow>
              <DataRow label={t('goals.deadline')}>{g.deadline ? fmt.date(g.deadline) : '—'}</DataRow>
              <DataRow label={t('goals.status')}>{t(`goals.status.${g.status}` as MessageKey)}</DataRow>
              {g.metric === 'savings' && g.savingsGoalId && (
                <DataRow label={t('goals.savingsGoal')}>
                  <Link to={`/finance/goals/${g.savingsGoalId}`} className="text-accent hover:underline">
                    {t('common.open')}
                  </Link>
                </DataRow>
              )}
            </dl>
          </Panel>
          <LinksPanel type="goal" id={g.id} />
        </div>
      </div>
      <GoalFormModal open={edit} onOpenChange={setEdit} goal={g} />
      <GoalFormModal open={addSub} onOpenChange={setAddSub} parent={g} />
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: g.title })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}

const NEXT_LEVEL: Record<Goal['level'], Goal['level']> = { vision: 'long_term', long_term: 'objective', objective: 'milestone', milestone: 'milestone' };

export function GoalFormModal({ open, onOpenChange, goal, parent }: { open: boolean; onOpenChange: (o: boolean) => void; goal?: Goal; parent?: Goal }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { workspaces, currentId } = useWorkspace();
  const { data: all = [] } = useGoals();
  const savings = useQuery({ queryKey: ['finance', 'goals'], queryFn: () => api.get<{ goals: { id: string; name: string }[] }>('/api/finance/goals'), enabled: open });
  const init = () => ({
    title: goal?.title ?? '',
    description: goal?.description ?? '',
    level: goal?.level ?? (parent ? NEXT_LEVEL[parent.level] : 'objective'),
    parentId: goal?.parentId ?? parent?.id ?? '',
    area: goal?.area ?? parent?.area ?? '',
    metric: goal?.metric ?? 'none',
    startValue: String(goal?.startValue ?? 0),
    targetValue: goal?.targetValue == null ? '' : String(goal.targetValue),
    unit: goal?.unit ?? '',
    savingsGoalId: goal?.savingsGoalId ?? '',
    startDate: goal?.startDate ?? '',
    deadline: goal?.deadline ?? '',
    priority: String(goal?.priority ?? 2),
    workspaceId: goal?.workspaceId ?? parent?.workspaceId ?? currentId ?? '',
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
        parentId: v.parentId || null,
        area: v.area || null,
        startValue: Number(v.startValue || 0),
        targetValue: v.targetValue === '' ? null : Number(v.targetValue),
        unit: v.unit || null,
        savingsGoalId: v.savingsGoalId || null,
        startDate: v.startDate || null,
        deadline: v.deadline || null,
        priority: Number(v.priority),
        workspaceId: v.workspaceId || null,
        description: v.description || null,
      };
      return goal ? api.put<Goal>(`/api/goals/${goal.id}`, body) : api.post<Goal>('/api/goals', body);
    },
    {
      invalidate: LIFE_KEYS,
      success: t('common.saved'),
      silentFieldErrors: true,
      onSuccess: (r) => {
        onOpenChange(false);
        if (!goal && !parent) navigate(`/goals/${r.id}`);
      },
    },
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={goal ? t('goals.edit') : t('goals.new')}
      size="lg"
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormError message={form.formError} />
        <TextField label={t('common.name')} value={v.title} onChange={(e) => form.set('title', e.target.value)} error={form.errors.title} autoFocus />
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('goals.level')}>
            <Select value={v.level} onChange={(e) => form.set('level', e.target.value as Goal['level'])}>
              {GOAL_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`goals.level.${l}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('goals.parent')} error={form.errors.parentId}>
            <Select value={v.parentId} onChange={(e) => form.set('parentId', e.target.value)}>
              <option value="">{t('goals.noParent')}</option>
              {all
                .filter((g) => g.id !== goal?.id)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('task.area')} optional>
            <Select value={v.area} onChange={(e) => form.set('area', e.target.value)}>
              <option value="">—</option>
              {LIFE_AREAS.map((a) => (
                <option key={a} value={a}>
                  {t(`area.${a}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('goals.metric')} className="md:col-span-3">
            <Select value={v.metric} onChange={(e) => form.set('metric', e.target.value as Goal['metric'])}>
              {GOAL_METRICS.map((m) => (
                <option key={m} value={m}>
                  {t(`goals.metric.${m}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          {v.metric === 'numeric' && (
            <>
              <Field label={t('goals.startValue')}>
                <Input inputMode="decimal" dir="ltr" value={v.startValue} onChange={(e) => form.set('startValue', e.target.value)} />
              </Field>
              <Field label={t('goals.targetValue')} error={form.errors.targetValue}>
                <Input inputMode="decimal" dir="ltr" value={v.targetValue} onChange={(e) => form.set('targetValue', e.target.value)} />
              </Field>
              <TextField label={t('goals.unit')} optional value={v.unit} onChange={(e) => form.set('unit', e.target.value)} />
            </>
          )}
          {v.metric === 'savings' && (
            <Field label={t('goals.savingsGoal')} error={form.errors.savingsGoalId} className="md:col-span-3">
              <Select value={v.savingsGoalId} onChange={(e) => form.set('savingsGoalId', e.target.value)}>
                <option value="">—</option>
                {(savings.data?.goals ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('goals.startDate')} optional>
            <Input type="date" value={v.startDate} onChange={(e) => form.set('startDate', e.target.value)} />
          </Field>
          <Field label={t('goals.deadline')} optional error={form.errors.deadline}>
            <Input type="date" value={v.deadline} onChange={(e) => form.set('deadline', e.target.value)} />
          </Field>
          <Field label={t('goal.priority')}>
            <Select value={v.priority} onChange={(e) => form.set('priority', e.target.value)}>
              {[1, 2, 3].map((p) => (
                <option key={p} value={p}>
                  {t(`goal.priority.${p}` as MessageKey)}
                </option>
              ))}
            </Select>
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
        <Field label={t('common.description')} optional>
          <Textarea value={v.description} onChange={(e) => form.set('description', e.target.value)} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}
