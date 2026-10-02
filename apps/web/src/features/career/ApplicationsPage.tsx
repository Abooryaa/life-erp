import { APPLICATION_STATUS_KINDS, CURRENCIES, INTERVIEW_MODES, INTERVIEW_OUTCOMES, minorToInput, WORK_MODES } from '@life-erp/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, CalendarClock, ExternalLink, Plus, Send, Settings2, Trash2, X } from 'lucide-react';
import { useEffect, useState, type DragEvent } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { EmptyState, LoadingBlock, Spinner, useToast } from '../../components/ui/feedback';
import { Field, FormError, Input, NoFieldId, Select, Textarea, TextField } from '../../components/ui/form';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { useOrganizations } from '../business/biz-lib';
import { AmountInput } from '../finance/fin-lib';
import { usePeople } from '../life/life-lib';
import { localToday } from '../life/TasksPage';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { LinksPanel } from '../shared/LinksPanel';
import { CustomFieldsPanel } from '../tools/CustomFields';
import { TagInput } from '../shared/TagEditor';
import { CAREER_KEYS, optLabel, useOpenParam, useStatuses, type AppStatus, type Application, type Interview } from './career-lib';

interface Funnel {
  saved: number;
  applied: number;
  inProgress: number;
  interviews: number;
  offers: number;
  accepted: number;
  rejected: number;
  responseRate: number | null;
  interviewRate: number | null;
  offerRate: number | null;
}

export function ApplicationsPage() {
  const { t, fmt } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<{ id?: string; statusId?: string } | null>(null);
  const [statusesOpen, setStatusesOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const statuses = useStatuses();
  const apps = useQuery({ queryKey: ['career', 'applications'], queryFn: () => api.get<Application[]>('/api/career/applications') });
  const funnel = useQuery({ queryKey: ['career', 'funnel'], queryFn: () => api.get<Funnel>('/api/career/funnel') });
  useOpenParam((id) => setEditing({ id }));

  const move = async (id: string, statusId: string) => {
    try {
      await api.put(`/api/career/applications/${id}`, { statusId });
      await Promise.all(CAREER_KEYS.map((k) => qc.invalidateQueries({ queryKey: k })));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const closedKinds = ['accepted', 'rejected', 'withdrawn'];
  const columns = (statuses.data ?? []).filter((s) => showClosed || !closedKinds.includes(s.kind));
  const f = funnel.data;
  const rate = (r: number | null) => (r == null ? '—' : fmt.percent(r));
  const d = localToday();
  return (
    <div>
      <PageHeader
        title={t('car.applications')}
        subtitle={t('car.dragHint')}
        actions={
          <>
            <Button variant={showClosed ? 'subtle' : 'ghost'} onClick={() => setShowClosed((x) => !x)}>
              {t('car.showClosed')}
            </Button>
            <Button icon={<Settings2 className="size-4" />} onClick={() => setStatusesOpen(true)} disabled={!statuses.data}>
              {t('car.editStatuses')}
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({})}>
              {t('car.newApplication')}
            </Button>
          </>
        }
      />
      {f && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            [t('car.f.applied'), f.applied, `+${f.saved} ${t('car.f.saved')}`],
            [t('car.f.inProgress'), f.inProgress, null],
            [t('car.f.responseRate'), rate(f.responseRate), null],
            [t('car.f.interviewRate'), rate(f.interviewRate), `${f.interviews}`],
            [t('car.f.offerRate'), rate(f.offerRate), `${f.offers}`],
          ].map(([label, value, hint], i) => (
            <div key={i} className="rounded-card border border-line bg-surface p-3 shadow-card">
              <p className="text-[12px] text-ink-3">{label}</p>
              <p className="num mt-0.5 text-[18px] font-semibold">{value}</p>
              {hint && <p className="text-[12px] text-ink-3">{hint}</p>}
            </div>
          ))}
        </div>
      )}
      {statuses.isLoading || apps.isLoading ? (
        <LoadingBlock />
      ) : !apps.data?.length ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Send className="size-5" />} title={t('car.appsEmpty')} body={t('car.appsEmptyBody')} action={<Button variant="primary" onClick={() => setEditing({})}>{t('car.newApplication')}</Button>} />
        </div>
      ) : (
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 scrollbar-thin md:mx-0 md:px-0">
          {columns.map((st) => {
            const items = apps.data!.filter((a) => a.statusId === st.id);
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
                  const id = e.dataTransfer.getData('text/app');
                  if (id) void move(id, st.id);
                }}
                className={clsx(
                  'flex w-60 shrink-0 flex-col rounded-card border bg-surface-2/60',
                  over === st.id ? 'border-accent' : 'border-line',
                  st.kind === 'accepted' && 'bg-pos-soft/40',
                  st.kind === 'rejected' && 'bg-neg-soft/30',
                )}
              >
                <header className="flex items-center justify-between px-3 pt-2.5 pb-1 text-[12.5px] font-semibold text-ink-2 uppercase">
                  {st.name}
                  <span className="text-ink-3">{items.length}</span>
                </header>
                <ul className="flex min-h-28 flex-col gap-2 p-2">
                  {items.map((a) => (
                    <li
                      key={a.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/app', a.id)}
                      onClick={() => setEditing({ id: a.id })}
                      className="cursor-pointer rounded-lg border border-line bg-surface p-2.5 shadow-card hover:border-line-strong"
                    >
                      <p className="flex items-start justify-between gap-2 text-[13.5px] font-medium">
                        <span className="min-w-0">{a.position}</span>
                        {a.priority === 1 && <span className="mt-1 size-2 shrink-0 rounded-full bg-neg" aria-label={t('car.priority.1')} />}
                      </p>
                      <p className="truncate text-[12px] text-ink-3">{a.company}</p>
                      {a.nextInterview ? (
                        <p className="mt-1.5 flex items-center gap-1 text-[11.5px] text-info">
                          <CalendarClock className="size-3.5" />
                          {fmt.date(a.nextInterview.date)} {a.nextInterview.time ?? ''}
                        </p>
                      ) : a.followUpDate && !closedKinds.includes(a.statusKind) ? (
                        <p className={clsx('mt-1.5 text-[11.5px]', a.followUpDate <= d ? 'text-warn' : 'text-ink-3')}>
                          {t('car.followUp')}: {fmt.date(a.followUpDate)}
                        </p>
                      ) : a.appliedDate ? (
                        <p className="mt-1.5 text-[11.5px] text-ink-3">{t('car.appliedOn', { date: fmt.date(a.appliedDate) })}</p>
                      ) : null}
                    </li>
                  ))}
                  <button onClick={() => setEditing({ statusId: st.id })} className="rounded-lg px-2 py-1.5 text-start text-[12.5px] text-ink-3 hover:bg-surface hover:text-ink">
                    + {t('common.add')}
                  </button>
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {editing && statuses.data && <ApplicationModal key={editing.id ?? 'new'} statuses={statuses.data} appId={editing.id} defaultStatusId={editing.statusId} onClose={() => setEditing(null)} />}
      {statusesOpen && statuses.data && <StatusesModal statuses={statuses.data} onClose={() => setStatusesOpen(false)} />}
    </div>
  );
}

function ApplicationModal({ statuses, appId, defaultStatusId, onClose }: { statuses: AppStatus[]; appId?: string; defaultStatusId?: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [del, setDel] = useState(false);
  const { data: people = [] } = usePeople();
  const { data: orgs = [] } = useOrganizations();
  const existing = useQuery({ queryKey: ['career', 'application', appId], queryFn: () => api.get<Application>(`/api/career/applications/${appId}`), enabled: !!appId });
  const form = useFormState({
    company: '',
    organizationId: '',
    position: '',
    statusId: defaultStatusId ?? '',
    source: '',
    url: '',
    location: '',
    workMode: '',
    appliedDate: '',
    salaryMin: '',
    salaryMax: '',
    currency: 'EGP',
    recruiterPersonId: '',
    followUpDate: '',
    cvVersion: '',
    jobDescription: '',
    outcome: '',
    priority: '2',
    notes: '',
    tags: [] as string[],
  });
  useEffect(() => {
    const a = existing.data;
    if (a)
      form.setValues({
        company: a.company,
        organizationId: a.organizationId ?? '',
        position: a.position,
        statusId: a.statusId,
        source: a.source ?? '',
        url: a.url ?? '',
        location: a.location ?? '',
        workMode: a.workMode ?? '',
        appliedDate: a.appliedDate ?? '',
        salaryMin: a.salaryMin == null ? '' : minorToInput(a.salaryMin, a.currency),
        salaryMax: a.salaryMax == null ? '' : minorToInput(a.salaryMax, a.currency),
        currency: a.currency,
        recruiterPersonId: a.recruiterPersonId ?? '',
        followUpDate: a.followUpDate ?? '',
        cvVersion: a.cvVersion ?? '',
        jobDescription: a.jobDescription ?? '',
        outcome: a.outcome ?? '',
        priority: String(a.priority),
        notes: a.notes ?? '',
        tags: a.tags,
      });
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const status = statuses.find((s) => s.id === v.statusId);
  const nul = (s: string) => s || null;
  const body = () => ({
    ...v,
    statusId: nul(v.statusId),
    organizationId: nul(v.organizationId),
    recruiterPersonId: nul(v.recruiterPersonId),
    workMode: nul(v.workMode),
    appliedDate: nul(v.appliedDate),
    followUpDate: nul(v.followUpDate),
    salaryMin: nul(v.salaryMin),
    salaryMax: nul(v.salaryMax),
    source: nul(v.source),
    url: nul(v.url),
    location: nul(v.location),
    cvVersion: nul(v.cvVersion),
    jobDescription: nul(v.jobDescription),
    outcome: nul(v.outcome),
    notes: nul(v.notes),
    priority: Number(v.priority),
  });
  const save = useAction(() => (appId ? api.put(`/api/career/applications/${appId}`, body()) : api.post('/api/career/applications', body())), {
    invalidate: CAREER_KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: onClose,
  });
  const remove = useAction(() => api.del(`/api/career/applications/${appId}`), { invalidate: CAREER_KEYS, onSuccess: onClose });
  const pickOrg = (id: string) => {
    form.set('organizationId', id);
    const o = orgs.find((x) => x.id === id);
    if (o && !v.company) form.set('company', o.name);
  };
  const isUrl = /^https?:\/\//i.test(v.url);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={appId ? t('car.editApplication') : t('car.newApplication')}
      size="lg"
      footer={
        <>
          {appId && (
            <Button variant="ghost" icon={<Trash2 className="size-4 text-neg" />} onClick={() => setDel(true)} className="me-auto">
              {t('common.delete')}
            </Button>
          )}
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {appId && existing.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <FormError message={form.formError} />
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label={t('car.position')} value={v.position} onChange={(e) => form.set('position', e.target.value)} error={form.errors.position} autoFocus={!appId} />
            <TextField label={t('car.company')} value={v.company} onChange={(e) => form.set('company', e.target.value)} error={form.errors.company} />
          </div>
          <Field label={t('common.status')} hint={!appId && !v.statusId ? t('car.statusAuto') : undefined}>
            <div className="flex flex-wrap gap-1.5">
              {statuses.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => form.set('statusId', st.id)}
                  className={clsx(
                    'rounded-full px-3 py-1 text-[12.5px] font-medium',
                    v.statusId === st.id ? (st.kind === 'accepted' ? 'bg-pos text-white' : st.kind === 'rejected' ? 'bg-neg text-white' : 'bg-ink text-canvas') : 'bg-surface-2 text-ink-2',
                  )}
                >
                  {st.name}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t('car.appliedDate')} optional>
              <Input type="date" value={v.appliedDate} onChange={(e) => form.set('appliedDate', e.target.value)} />
            </Field>
            <Field label={t('car.followUp')} optional>
              <Input type="date" value={v.followUpDate} onChange={(e) => form.set('followUpDate', e.target.value)} />
            </Field>
            <Field label={t('task.priority')}>
              <Select value={v.priority} onChange={(e) => form.set('priority', e.target.value)}>
                {[1, 2, 3].map((p) => (
                  <option key={p} value={p}>
                    {t(`car.priority.${p}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('car.workMode')} optional>
              <Select value={v.workMode} onChange={(e) => form.set('workMode', e.target.value)}>
                <option value="">—</option>
                {WORK_MODES.map((m) => (
                  <option key={m} value={m}>
                    {optLabel(t, 'car.mode', m)}
                  </option>
                ))}
              </Select>
            </Field>
            <TextField label={t('cal.location')} optional value={v.location} onChange={(e) => form.set('location', e.target.value)} />
            <TextField label={t('opp.source')} optional value={v.source} onChange={(e) => form.set('source', e.target.value)} placeholder="LinkedIn, Wuzzuf…" />
            <Field label={t('car.salaryMin')} optional error={form.errors.salaryMin}>
              <AmountInput value={v.salaryMin} onChange={(e) => form.set('salaryMin', e.target.value)} currency={v.currency} />
            </Field>
            <Field label={t('car.salaryMax')} optional error={form.errors.salaryMax}>
              <AmountInput value={v.salaryMax} onChange={(e) => form.set('salaryMax', e.target.value)} currency={v.currency} invalid={!!form.errors.salaryMax} />
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
            <Field label={t('car.companyRecord')} optional>
              <Select value={v.organizationId} onChange={(e) => pickOrg(e.target.value)}>
                <option value="">—</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('car.recruiter')} optional>
              <Select value={v.recruiterPersonId} onChange={(e) => form.set('recruiterPersonId', e.target.value)}>
                <option value="">—</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <TextField label={t('car.cvVersion')} optional value={v.cvVersion} onChange={(e) => form.set('cvVersion', e.target.value)} />
          </div>
          <Field label={t('car.jobUrl')} optional>
            <div className="flex gap-2">
              <Input value={v.url} onChange={(e) => form.set('url', e.target.value)} dir="ltr" inputMode="url" />
              {isUrl && (
                <a href={v.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center rounded-lg border border-line px-2.5 text-ink-2 hover:text-ink" aria-label={t('common.open')}>
                  <ExternalLink className="size-4" />
                </a>
              )}
            </div>
          </Field>
          {appId && existing.data && <InterviewsSection app={existing.data} />}
          {(status?.kind === 'rejected' || status?.kind === 'withdrawn' || status?.kind === 'accepted' || status?.kind === 'offer') && (
            <Field label={t('car.outcome')} optional>
              <Textarea value={v.outcome} onChange={(e) => form.set('outcome', e.target.value)} rows={2} />
            </Field>
          )}
          <Field label={t('car.jobDescription')} optional>
            <Textarea value={v.jobDescription} onChange={(e) => form.set('jobDescription', e.target.value)} rows={4} />
          </Field>
          <Field label={t('common.tags')} optional>
            <TagInput value={v.tags} onChange={(tags) => form.set('tags', tags)} />
          </Field>
          <Field label={t('common.notes')} optional>
            <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={3} />
          </Field>
          {appId && (
            <>
              <CustomFieldsPanel type="job_application" id={appId} />
              <AttachmentsPanel type="job_application" id={appId} />
              <LinksPanel type="job_application" id={appId} />
            </>
          )}
        </div>
      )}
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: `${v.position} — ${v.company}` })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}

function InterviewsSection({ app }: { app: Application }) {
  const { t, fmt } = useI18n();
  const iv = useFormState({ stage: '', date: localToday(), time: '', mode: 'video' as Interview['mode'] });
  const keys = [...CAREER_KEYS];
  const add = useAction(() => api.post('/api/career/interviews', { applicationId: app.id, ...iv.values, time: iv.values.time || null }), {
    invalidate: keys,
    silentFieldErrors: true,
    onSuccess: () => iv.reset(),
  });
  const setOutcome = useAction((x: { id: string; outcome: string }) => api.put(`/api/career/interviews/${x.id}`, { outcome: x.outcome }), { invalidate: keys });
  const remove = useAction((id: string) => api.del(`/api/career/interviews/${id}`), { invalidate: keys });
  return (
    <Panel title={t('car.interviews')} padded={false}>
      <NoFieldId>
        {app.interviews?.length ? (
          <ul className="divide-y divide-line">
            {app.interviews.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">{i.stage}</p>
                  <p className="text-[12px] text-ink-3">
                    {fmt.date(i.date)} {i.time ?? ''} · {optLabel(t, 'car.ivMode', i.mode)}
                    {i.interviewer && ` · ${i.interviewer}`}
                  </p>
                </div>
                <Select value={i.outcome} onChange={(e) => setOutcome.mutate({ id: i.id, outcome: e.target.value })} aria-label={t('car.outcome')} className="w-32">
                  {INTERVIEW_OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {optLabel(t, 'car.ivOutcome', o)}
                    </option>
                  ))}
                </Select>
                <Button size="icon-sm" variant="ghost" onClick={() => remove.mutate(i.id)} aria-label={t('common.delete')}>
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-[13px] text-ink-3">{t('car.noInterviews')}</p>
        )}
        <div className="grid grid-cols-2 gap-2 border-t border-line p-3 md:grid-cols-[minmax(0,1fr)_140px_100px_110px_auto]">
          <Input className="col-span-2 md:col-span-1" placeholder={t('car.ivStage')} value={iv.values.stage} onChange={(e) => iv.set('stage', e.target.value)} aria-label={t('car.ivStage')} invalid={!!iv.errors.stage} />
          <Input type="date" value={iv.values.date} onChange={(e) => iv.set('date', e.target.value)} aria-label={t('common.date')} />
          <Input type="time" value={iv.values.time} onChange={(e) => iv.set('time', e.target.value)} aria-label={t('cal.start')} />
          <Select value={iv.values.mode} onChange={(e) => iv.set('mode', e.target.value as Interview['mode'])} aria-label={t('car.workMode')}>
            {INTERVIEW_MODES.map((m) => (
              <option key={m} value={m}>
                {optLabel(t, 'car.ivMode', m)}
              </option>
            ))}
          </Select>
          <Button variant="primary" loading={add.isPending} icon={<Plus className="size-4" />} onClick={() => add.mutate(undefined, { onError: iv.fail })}>
            {t('common.add')}
          </Button>
        </div>
      </NoFieldId>
    </Panel>
  );
}

function StatusesModal({ statuses, onClose }: { statuses: AppStatus[]; onClose: () => void }) {
  const { t } = useI18n();
  const [list, setList] = useState<Partial<AppStatus>[]>(statuses);
  const form = useFormState({});
  const save = useAction(() => api.put('/api/career/statuses', list.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))), {
    invalidate: CAREER_KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: onClose,
  });
  const set = (i: number, patch: Partial<AppStatus>) => setList((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const swap = (i: number, j: number) =>
    setList((s) => {
      if (j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('car.editStatuses')}
      description={t('car.statusKindHint')}
      size="lg"
      footer={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onError: form.fail })}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-2">
        <FormError message={form.formError} />
        {list.map((s, i) => (
          <div key={s.id ?? `new-${i}`} className="grid grid-cols-[minmax(0,1fr)_130px_auto] items-center gap-2">
            <Input value={s.name ?? ''} onChange={(e) => set(i, { name: e.target.value })} aria-label={t('common.name')} />
            <Select value={s.kind ?? 'active'} onChange={(e) => set(i, { kind: e.target.value as AppStatus['kind'] })} aria-label={t('common.type')}>
              {APPLICATION_STATUS_KINDS.map((k) => (
                <option key={k} value={k}>
                  {optLabel(t, 'car.kind', k)}
                </option>
              ))}
            </Select>
            <div className="flex">
              <Button size="icon-sm" variant="ghost" onClick={() => swap(i, i - 1)} aria-label={t('car.moveUp')}>
                <ArrowUp className="size-4" />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => swap(i, i + 1)} aria-label={t('car.moveDown')}>
                <ArrowDown className="size-4" />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={() => setList((x) => x.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                <Trash2 className="size-4 text-neg" />
              </Button>
            </div>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setList((s) => [...s, { name: '', kind: 'interview' }])}>
          {t('car.addStatus')}
        </Button>
      </div>
    </Modal>
  );
}
