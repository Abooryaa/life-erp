import {
  addDays,
  AUTOMATION_EVENTS,
  AUTOMATION_EVENT_KEYS,
  opsFor,
  type AutoField,
  type AutomationAction,
  type AutomationEvent,
  type Condition,
  type ScheduleSpec,
} from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, FlaskConical, Pause, Play, Plus, Trash2, Workflow, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, NoFieldId, Select, Switch, TextField } from '../../components/ui/form';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { useProjects } from '../business/biz-lib';
import { useAccounts, useCategories } from '../finance/fin-lib';

interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  event: AutomationEvent;
  schedule: ScheduleSpec | null;
  conditions: Condition[];
  actions: AutomationAction[];
  lastRunAt: string | null;
  runCount: number;
  runs?: { id: string; at: string; status: 'ok' | 'error'; entityType: string | null; entityId: string | null; message: string | null }[];
}

interface TestResult {
  checked: number;
  matched: number;
  matches: { id: string; title: string; actions: { type: string; text: string }[] }[];
  schedulePreview: { type: string; text: string }[] | null;
  lastOccurrence: string | null;
}

const KEYS = [['automations'], ['audit']];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** Human label for an enum value, reusing the app's existing translations. */
function useEnumLabel() {
  const { t } = useI18n();
  return (field: string, event: AutomationEvent, v: string) => {
    const key: Record<string, string> = {
      type: event === 'document.create' ? `docs.type.${v}` : `tx.type.${v}`,
      stageKind: `opp.kind.${v}`,
      statusKind: `car.kind.${v}`,
      status: `prj.status.${v}`,
      priority: event.startsWith('application') ? `car.priority.${v}` : `task.priority.${v}`,
    };
    const k = key[field] as MessageKey | undefined;
    const label = k ? t(k) : v;
    return label === k ? v : label;
  };
}

export function AutomationsPage() {
  const { t, fmt } = useI18n();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['automations'], queryFn: () => api.get<Automation[]>('/api/automations') });
  const toggle = useAction((a: Automation) => api.put(`/api/automations/${a.id}`, { enabled: !a.enabled }), { invalidate: KEYS });
  return (
    <div>
      <PageHeader
        title={t('auto.title')}
        subtitle={t('auto.subtitle')}
        actions={<NewButton />}
      />
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : !data.length ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Workflow className="size-5" />} title={t('auto.empty')} body={t('auto.emptyBody')} action={<NewButton />} />
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface shadow-card">
          {data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              <Link to={`/automations/${a.id}`} className="min-w-0 flex-1">
                <p className={clsx('truncate font-medium', !a.enabled && 'text-ink-3')}>{a.name}</p>
                <p className="truncate text-[12.5px] text-ink-3">
                  {t(`auto.ev.${a.event}` as MessageKey)} · {a.actions.map((x) => t(`auto.act.${x.type}` as MessageKey)).join(', ')}
                  {a.lastRunAt ? ` · ${t('auto.lastRun', { when: fmt.relative(a.lastRunAt), n: a.runCount })}` : ` · ${t('auto.neverRun')}`}
                </p>
              </Link>
              {!a.enabled && <Badge>{t('auto.paused')}</Badge>}
              <Button size="icon-sm" variant="ghost" onClick={() => toggle.mutate(a)} aria-label={a.enabled ? t('auto.pause') : t('auto.resume')} title={a.enabled ? t('auto.pause') : t('auto.resume')}>
                {a.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewButton() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/automations/new')}>
      {t('auto.new')}
    </Button>
  );
}

type Form = {
  name: string;
  enabled: boolean;
  event: AutomationEvent;
  schedule: ScheduleSpec;
  conditions: Condition[];
  actions: AutomationAction[];
};

const blankAction = (type: AutomationAction['type']): AutomationAction =>
  type === 'notify' ? { type, severity: 'reminder', title: '', body: null } : type === 'create_task' ? { type, title: '', priority: 3, dueInDays: null, workspace: 'record' } : { type, tag: '' };

export function AutomationEditPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const [del, setDel] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const existing = useQuery({ queryKey: ['automations', id], queryFn: () => api.get<Automation>(`/api/automations/${id}`), enabled: !isNew });
  const form = useFormState<Form>({
    name: '',
    enabled: true,
    event: 'transaction.create',
    schedule: { frequency: 'weekly', time: '09:00', weekday: 6, dayOfMonth: 1 },
    conditions: [],
    actions: [blankAction('notify')],
  });
  useEffect(() => {
    const a = existing.data;
    if (a) form.setValues({ name: a.name, enabled: a.enabled, event: a.event, schedule: a.schedule ?? { frequency: 'weekly', time: '09:00', weekday: 6, dayOfMonth: 1 }, conditions: a.conditions, actions: a.actions });
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const def = AUTOMATION_EVENTS[v.event];
  const body = () => ({ ...v, schedule: v.event === 'schedule' ? v.schedule : null, conditions: v.event === 'schedule' ? [] : v.conditions });
  const save = useAction(() => (isNew ? api.post<Automation>('/api/automations', body()) : api.put<Automation>(`/api/automations/${id}`, body())), {
    invalidate: KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: (a) => isNew && navigate(`/automations/${a.id}`, { replace: true }),
  });
  const runTest = useAction(() => api.post<TestResult>('/api/automations/test', body()), { silentFieldErrors: true, onSuccess: setTest });
  const remove = useAction(() => api.del(`/api/automations/${id}`), { invalidate: KEYS, onSuccess: () => navigate('/automations') });
  if (!isNew && existing.isLoading) return <LoadingBlock />;
  if (!isNew && existing.error) return <ErrorBlock error={existing.error} onRetry={existing.refetch} />;

  const setEvent = (event: AutomationEvent) => {
    // Conditions refer to the old event's fields, and tags need a record.
    form.setValues((s) => ({ ...s, event, conditions: [], actions: event === 'schedule' ? s.actions.filter((a) => a.type !== 'add_tag') : s.actions }));
    setTest(null);
  };
  const setCond = (i: number, patch: Partial<Condition>) => form.set('conditions', v.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setAct = (i: number, patch: Partial<AutomationAction>) => form.set('actions', v.actions.map((a, j) => (j === i ? ({ ...a, ...patch } as AutomationAction) : a)));
  const err = (p: string) => form.errors[p];
  const placeholders = ['today', ...def.fields.filter((f) => f.type !== 'ref').map((f) => f.key)];

  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link to="/automations" className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t('auto.title')}
          </Link>
        }
        title={isNew ? t('auto.new') : v.name || t('auto.title')}
        actions={
          !isNew && (
            <Button variant="ghost" size="icon" onClick={() => setDel(true)} aria-label={t('common.delete')}>
              <Trash2 className="size-4 text-neg" />
            </Button>
          )
        }
      />
      <FormError message={form.formError} />
      <Panel>
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label={t('common.name')} value={v.name} onChange={(e) => form.set('name', e.target.value)} error={err('name')} placeholder={t('auto.namePh')} autoFocus={isNew} />
          <div className="flex items-end">
            <Switch checked={v.enabled} onChange={(x) => form.set('enabled', x)} label={t('auto.enabled')} />
          </div>
        </div>
      </Panel>

      <Panel title={t('auto.when')}>
        <div className="space-y-4">
          <Field label={t('auto.trigger')}>
            <Select value={v.event} onChange={(e) => setEvent(e.target.value as AutomationEvent)}>
              {AUTOMATION_EVENT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`auto.ev.${k}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          {v.event === 'schedule' && (
            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t('auto.frequency')}>
                <Select value={v.schedule.frequency} onChange={(e) => form.set('schedule', { ...v.schedule, frequency: e.target.value as ScheduleSpec['frequency'] })}>
                  {(['daily', 'weekly', 'monthly'] as const).map((f) => (
                    <option key={f} value={f}>
                      {t(`auto.freq.${f}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </Field>
              {v.schedule.frequency === 'weekly' && (
                <Field label={t('auto.weekday')} error={err('schedule.weekday')}>
                  <Select value={String(v.schedule.weekday ?? 6)} onChange={(e) => form.set('schedule', { ...v.schedule, weekday: Number(e.target.value) })}>
                    {WEEKDAYS.map((d) => (
                      <option key={d} value={d}>
                        {/* 2026-01-04 is a Sunday (0). */}
                        {fmt.weekday(addDays('2026-01-04', d))}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {v.schedule.frequency === 'monthly' && (
                <Field label={t('auto.dayOfMonth')} hint={t('auto.dayOfMonthHint')} error={err('schedule.dayOfMonth')}>
                  <Input type="number" min={1} max={31} value={v.schedule.dayOfMonth ?? 1} onChange={(e) => form.set('schedule', { ...v.schedule, dayOfMonth: Number(e.target.value) })} />
                </Field>
              )}
              <Field label={t('auto.time')} error={err('schedule.time')}>
                <Input type="time" value={v.schedule.time} onChange={(e) => form.set('schedule', { ...v.schedule, time: e.target.value })} />
              </Field>
            </div>
          )}
        </div>
      </Panel>

      {v.event !== 'schedule' && (
        <Panel title={t('auto.if')}>
          <NoFieldId>
            <div className="space-y-2">
              {v.conditions.length === 0 && <p className="text-[13px] text-ink-3">{t('auto.always')}</p>}
              {v.conditions.map((c, i) => (
                <ConditionRow key={i} event={v.event} fields={def.fields} c={c} onChange={(p) => setCond(i, p)} onRemove={() => form.set('conditions', v.conditions.filter((_, j) => j !== i))} />
              ))}
              {def.fields.length > 0 && v.conditions.length < 10 && (
                <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => form.set('conditions', [...v.conditions, { field: def.fields[0].key, op: 'eq', value: '' }])}>
                  {t('auto.addCondition')}
                </Button>
              )}
            </div>
          </NoFieldId>
        </Panel>
      )}

      <Panel title={t('auto.then')}>
        <div className="space-y-3">
          {err('actions') && <p className="text-[13px] text-neg">{err('actions')}</p>}
          {v.actions.map((a, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-line p-3">
              <div className="flex items-center gap-2">
                <Select
                  value={a.type}
                  onChange={(e) => form.set('actions', v.actions.map((x, j) => (j === i ? blankAction(e.target.value as AutomationAction['type']) : x)))}
                  aria-label={t('auto.action')}
                  className="flex-1"
                >
                  {(['notify', 'create_task', 'add_tag'] as const)
                    .filter((x) => x !== 'add_tag' || v.event !== 'schedule')
                    .map((x) => (
                      <option key={x} value={x}>
                        {t(`auto.act.${x}` as MessageKey)}
                      </option>
                    ))}
                </Select>
                <Button size="icon-sm" variant="ghost" onClick={() => form.set('actions', v.actions.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                  <X className="size-4" />
                </Button>
              </div>
              {a.type === 'notify' && (
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                  <TextField label={t('auto.titleText')} value={a.title} onChange={(e) => setAct(i, { title: e.target.value })} error={err(`actions.${i}.title`)} placeholder={t('auto.notifyPh')} />
                  <Field label={t('auto.severity')}>
                    <Select value={a.severity} onChange={(e) => setAct(i, { severity: e.target.value as 'info' })}>
                      {(['info', 'reminder', 'warning'] as const).map((s) => (
                        <option key={s} value={s}>
                          {t(`auto.sev.${s}` as MessageKey)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <TextField label={t('auto.bodyText')} optional className="md:col-span-2" value={a.body ?? ''} onChange={(e) => setAct(i, { body: e.target.value || null })} />
                </div>
              )}
              {a.type === 'create_task' && (
                <div className="grid gap-3 md:grid-cols-3">
                  <TextField label={t('auto.taskTitle')} className="md:col-span-3" value={a.title} onChange={(e) => setAct(i, { title: e.target.value })} error={err(`actions.${i}.title`)} placeholder={t('auto.taskPh')} />
                  <Field label={t('task.priority')}>
                    <Select value={String(a.priority)} onChange={(e) => setAct(i, { priority: Number(e.target.value) })}>
                      {[1, 2, 3, 4].map((p) => (
                        <option key={p} value={p}>
                          {t(`task.priority.${p}` as MessageKey)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('auto.dueIn')} hint={t('auto.dueInHint')}>
                    <Input type="number" min={0} max={365} value={a.dueInDays ?? ''} onChange={(e) => setAct(i, { dueInDays: e.target.value === '' ? null : Number(e.target.value) })} />
                  </Field>
                  {v.event !== 'schedule' && (
                    <Field label={t('common.workspace')}>
                      <Select value={a.workspace} onChange={(e) => setAct(i, { workspace: e.target.value as 'record' })}>
                        <option value="record">{t('auto.sameWorkspace')}</option>
                        <option value="none">{t('common.noWorkspace')}</option>
                      </Select>
                    </Field>
                  )}
                </div>
              )}
              {a.type === 'add_tag' && <TextField label={t('auto.tag')} value={a.tag} onChange={(e) => setAct(i, { tag: e.target.value })} error={err(`actions.${i}.tag`)} placeholder="review" />}
            </div>
          ))}
          {v.actions.length < 5 && (
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => form.set('actions', [...v.actions, blankAction('notify')])}>
              {t('auto.addAction')}
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-1 text-[12px] text-ink-3">
            <span>{t('auto.placeholders')}</span>
            {placeholders.map((p) => (
              <code key={p} className="rounded bg-surface-2 px-1 py-0.5 text-[11.5px]" dir="ltr">{`{{${p}}}`}</code>
            ))}
          </div>
        </div>
      </Panel>

      <div className="flex flex-wrap justify-end gap-2">
        <Button icon={<FlaskConical className="size-4" />} loading={runTest.isPending} onClick={() => runTest.mutate(undefined, { onError: form.fail })}>
          {t('auto.test')}
        </Button>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      </div>

      {test && (
        <Panel title={t('auto.testResult')}>
          {test.schedulePreview ? (
            <div className="space-y-1 text-[13.5px]">
              <p className="text-ink-3">{t('auto.wouldDo')}</p>
              {test.schedulePreview.map((p, i) => (
                <p key={i}>
                  {t(`auto.act.${p.type}` as MessageKey)}: <strong>{p.text}</strong>
                </p>
              ))}
            </div>
          ) : (
            <div className="space-y-3 text-[13.5px]">
              <p>{t('auto.testSummary', { checked: test.checked, matched: test.matched })}</p>
              {test.matches.map((m) => (
                <div key={m.id} className="rounded-lg bg-surface-2/60 p-2.5">
                  <p className="font-medium">{m.title}</p>
                  {m.actions.map((p, i) => (
                    <p key={i} className="text-[12.5px] text-ink-2">
                      → {t(`auto.act.${p.type}` as MessageKey)}: {p.text}
                    </p>
                  ))}
                </div>
              ))}
              <p className="text-[12px] text-ink-3">{t('auto.testNote')}</p>
            </div>
          )}
        </Panel>
      )}

      {existing.data?.runs && existing.data.runs.length > 0 && (
        <Panel title={t('auto.history')} padded={false}>
          <ul className="divide-y divide-line">
            {existing.data.runs.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                <Badge tone={r.status === 'ok' ? 'pos' : 'neg'}>{r.status === 'ok' ? t('auto.ok') : t('auto.failed')}</Badge>
                <span className="min-w-0 flex-1 truncate text-ink-2">{r.message}</span>
                <span className="shrink-0 text-[12px] text-ink-3">{fmt.relative(r.at)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: v.name })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}

function ConditionRow({ event, fields, c, onChange, onRemove }: { event: AutomationEvent; fields: readonly AutoField[]; c: Condition; onChange: (p: Partial<Condition>) => void; onRemove: () => void }) {
  const { t, locale } = useI18n();
  const enumLabel = useEnumLabel();
  const { workspaces } = useWorkspace();
  const { data: cats = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: projects = [] } = useProjects('');
  const f = fields.find((x) => x.key === c.field) ?? fields[0];
  const ops = opsFor(f.type);
  const needsValue = c.op !== 'empty' && c.op !== 'not_empty';
  const refOptions =
    f.ref === 'category'
      ? cats.map((x) => ({ id: x.id, name: locale === 'ar' && x.nameAr ? x.nameAr : x.name }))
      : f.ref === 'account'
        ? accounts.map((x) => ({ id: x.id, name: x.name }))
        : f.ref === 'workspace'
          ? workspaces.map((x) => ({ id: x.id, name: x.name }))
          : f.ref === 'project'
            ? projects.map((x) => ({ id: x.id, name: x.name }))
            : [];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 md:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)_auto]">
      <Select
        value={f.key}
        onChange={(e) => {
          const nf = fields.find((x) => x.key === e.target.value)!;
          onChange({ field: nf.key, op: opsFor(nf.type).includes(c.op) ? c.op : 'eq', value: '' });
        }}
        aria-label={t('auto.field')}
      >
        {fields.map((x) => (
          <option key={x.key} value={x.key}>
            {t(`auto.f.${x.key}` as MessageKey)}
          </option>
        ))}
      </Select>
      <Select value={c.op} onChange={(e) => onChange({ op: e.target.value as Condition['op'] })} aria-label={t('auto.operator')}>
        {ops.map((o) => (
          <option key={o} value={o}>
            {t(`auto.op.${o}` as MessageKey)}
          </option>
        ))}
      </Select>
      <div className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
        {!needsValue ? null : f.type === 'enum' ? (
          <Select value={c.value ?? ''} onChange={(e) => onChange({ value: e.target.value })} aria-label={t('auto.value')}>
            <option value="">—</option>
            {f.values!.map((x) => (
              <option key={x} value={x}>
                {enumLabel(f.key, event, x)}
              </option>
            ))}
          </Select>
        ) : f.type === 'ref' ? (
          <Select value={c.value ?? ''} onChange={(e) => onChange({ value: e.target.value })} aria-label={t('auto.value')}>
            <option value="">—</option>
            {refOptions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        ) : (
          <Input value={c.value ?? ''} onChange={(e) => onChange({ value: e.target.value })} inputMode={f.type === 'number' ? 'decimal' : undefined} aria-label={t('auto.value')} />
        )}
      </div>
      <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label={t('common.remove')} className="row-start-1 md:row-start-auto col-start-3 md:col-start-auto">
        <X className="size-4" />
      </Button>
    </div>
  );
}
