import { INTERACTION_KINDS, RELATIONSHIPS } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Mail, MessageCircle, Pencil, Phone, Plus, Trash2, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea, TextField } from '../../components/ui/form';
import { DataRow, PageHeader, Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useAction, useDebounced, useFormState } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { useUI } from '../../layout/ui-context';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { LinksPanel } from '../shared/LinksPanel';
import { CustomFieldsPanel } from '../tools/CustomFields';
import { EntityTags, TagList } from '../shared/TagEditor';
import { LIFE_KEYS, TaskRow, type Person, type Task } from './life-lib';
import { localToday } from './TasksPage';

/** International digits for WhatsApp; Egyptian local numbers (01…) get the +20 prefix. */
export function waNumber(phone: string) {
  let d = phone.replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
  if (/^01\d{9}$/.test(d)) d = `2${d}`;
  return d;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function PeoplePage() {
  const { t, fmt } = useI18n();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const relationship = params.get('relationship') ?? '';
  const followUp = params.get('followUp') === '1';
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['people', 'list', dq, relationship, followUp],
    queryFn: () => api.get<Person[]>(`/api/people${qs({ q: dq, relationship, followUp: followUp ? '1' : '' })}`),
  });
  const today = localToday();
  return (
    <div>
      <PageHeader
        title={t('people.title')}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('people.new')}
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 md:flex">
        <Input className="col-span-2 md:w-64" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('common.search')} />
        <Select className="md:w-48" value={relationship} onChange={(e) => setParams((p) => { const n = new URLSearchParams(p); if (e.target.value) n.set('relationship', e.target.value); else n.delete('relationship'); return n; })} aria-label={t('people.relationship')}>
          <option value="">{t('people.all')}</option>
          {RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>
              {t(`people.rel.${r}` as MessageKey)}
            </option>
          ))}
        </Select>
        <Button variant={followUp ? 'primary' : 'secondary'} onClick={() => setParams((p) => { const n = new URLSearchParams(p); if (followUp) n.delete('followUp'); else n.set('followUp', '1'); return n; })}>
          {t('people.followUpDue')}
        </Button>
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : data.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Users className="size-5" />} title={t('people.empty')} body={t('people.emptyBody')} action={<Button variant="primary" onClick={() => setCreating(true)}>{t('people.new')}</Button>} />
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface shadow-card">
          {data.map((p) => (
            <li key={p.id}>
              <Link to={`/people/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[12.5px] font-semibold text-ink-2">{initials(p.fullName)}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {p.fullName}
                    <span className="text-[12px] font-normal text-ink-3">{t(`people.rel.${p.relationship}` as MessageKey)}</span>
                    {p.nextFollowUp && p.nextFollowUp <= today && <Badge tone="warn">{t('people.followUpDue')}</Badge>}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 truncate text-[12.5px] text-ink-3">
                    {[p.role, p.company].filter(Boolean).join(' · ')}
                    <span>{p.lastContact ? `${t('people.lastContact')}: ${fmt.relative(`${p.lastContact}T12:00:00Z`)}` : t('people.never')}</span>
                    <TagList tags={p.tags} />
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <PersonFormModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}

export function PersonDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const ui = useUI();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const { data: p, isLoading, error, refetch } = useQuery({ queryKey: ['people', id], queryFn: () => api.get<Person>(`/api/people/${id}`) });
  const tasks = useQuery({ queryKey: ['tasks', 'person', id], queryFn: () => api.get<Task[]>(`/api/tasks${qs({ personId: id, view: 'open' })}`) });
  const log = useFormState({ kind: 'call', date: localToday(), summary: '', nextFollowUp: '' });
  const addLog = useAction(() => api.post('/api/interactions', { ...log.values, personId: id, nextFollowUp: log.values.nextFollowUp || undefined }), {
    invalidate: LIFE_KEYS,
    silentFieldErrors: true,
    success: t('common.saved'),
    onSuccess: () => log.setValues({ kind: log.values.kind, date: localToday(), summary: '', nextFollowUp: '' }),
  });
  const delLog = useAction((iid: string) => api.del(`/api/interactions/${iid}`), { invalidate: LIFE_KEYS });
  const remove = useAction(() => api.del(`/api/people/${id}`), { invalidate: LIFE_KEYS, onSuccess: () => navigate('/people') });

  if (isLoading) return <LoadingBlock />;
  if (error || !p) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;
  const today = localToday();
  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link to="/people" className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t('people.title')}
          </Link>
        }
        title={p.fullName}
        subtitle={[t(`people.rel.${p.relationship}` as MessageKey), p.role, p.company].filter(Boolean).join(' · ')}
        actions={
          <>
            {p.phone && (
              <>
                <a href={`tel:${p.phone.replace(/\s/g, '')}`}>
                  <Button icon={<Phone className="size-4" />}>{t('people.call')}</Button>
                </a>
                <a href={`https://wa.me/${waNumber(p.phone)}`} target="_blank" rel="noopener noreferrer">
                  <Button icon={<MessageCircle className="size-4 text-pos" />}>{t('people.whatsapp')}</Button>
                </a>
              </>
            )}
            {p.email && (
              <a href={`mailto:${p.email}`}>
                <Button variant="ghost" size="icon" aria-label={t('people.email')}>
                  <Mail className="size-4" />
                </Button>
              </a>
            )}
            <Button icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>
              {t('common.edit')}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setDel(true)} aria-label={t('common.delete')}>
              <Trash2 className="size-4 text-neg" />
            </Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Panel title={t('people.logInteraction')}>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                addLog.mutate(undefined, { onError: log.fail });
              }}
            >
              <div className="flex flex-wrap gap-1.5">
                {INTERACTION_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => log.set('kind', k)}
                    className={clsx('rounded-full px-3 py-1 text-[13px]', log.values.kind === k ? 'bg-ink text-canvas' : 'bg-surface-2 text-ink-2')}
                  >
                    {t(`people.interaction.${k}` as MessageKey)}
                  </button>
                ))}
              </div>
              <Field label={t('people.summary')} error={log.errors.summary}>
                <Textarea value={log.values.summary} onChange={(e) => log.set('summary', e.target.value)} rows={2} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('common.date')}>
                  <Input type="date" value={log.values.date} onChange={(e) => log.set('date', e.target.value)} />
                </Field>
                <Field label={t('people.setFollowUp')} optional>
                  <Input type="date" value={log.values.nextFollowUp} onChange={(e) => log.set('nextFollowUp', e.target.value)} />
                </Field>
              </div>
              <Button type="submit" variant="primary" loading={addLog.isPending}>
                {t('common.save')}
              </Button>
            </form>
          </Panel>
          <Panel title={t('people.history')} padded={false}>
            {(p.interactions ?? []).length === 0 ? (
              <p className="p-4 text-[13px] text-ink-3">{t('people.never')}</p>
            ) : (
              <ol className="divide-y divide-line">
                {p.interactions!.map((i) => (
                  <li key={i.id} className="flex gap-3 px-4 py-3">
                    <Badge>{t(`people.interaction.${i.kind}` as MessageKey)}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] whitespace-pre-wrap">{i.summary}</p>
                      <p className="text-[12px] text-ink-3">{fmt.date(i.date)}</p>
                    </div>
                    <Button size="icon-sm" variant="ghost" onClick={() => delLog.mutate(i.id)} aria-label={t('common.delete')}>
                      <X className="size-4" />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          <Panel
            title={t('people.tasks')}
            padded={false}
            actions={
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => ui.openTask({ defaults: { personId: p.id, status: 'planned' } })}>
                {t('quick.task')}
              </Button>
            }
          >
            {(tasks.data ?? []).length === 0 ? (
              <p className="p-4 text-[13px] text-ink-3">—</p>
            ) : (
              <ul className="divide-y divide-line">
                {tasks.data!.map((x) => (
                  <TaskRow key={x.id} task={x} onOpen={(task) => ui.openTask({ id: task.id })} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel>
            <dl>
              {p.phone && <DataRow label={t('people.phone')}><a href={`tel:${p.phone.replace(/\s/g, '')}`} dir="ltr" className="text-accent">{p.phone}</a></DataRow>}
              {p.phone2 && <DataRow label={t('people.phone2')}><span dir="ltr">{p.phone2}</span></DataRow>}
              {p.email && <DataRow label={t('people.email')}><span dir="ltr" className="break-all">{p.email}</span></DataRow>}
              {p.city && <DataRow label={t('people.city')}>{p.city}</DataRow>}
              {p.birthday && <DataRow label={t('people.birthday')}>{fmt.date(p.birthday)}</DataRow>}
              <DataRow label={t('people.lastContact')}>{p.lastContact ? fmt.date(p.lastContact) : t('people.never')}</DataRow>
              <DataRow label={t('people.nextFollowUp')}>
                {p.nextFollowUp ? <span className={clsx(p.nextFollowUp <= today && 'font-medium text-warn')}>{fmt.date(p.nextFollowUp)}</span> : '—'}
              </DataRow>
              {p.followUpNote && <DataRow label={t('people.followUpNote')}>{p.followUpNote}</DataRow>}
              {p.source && <DataRow label={t('people.source')}>{p.source}</DataRow>}
              {[p.linkedin, p.instagram, p.website].filter(Boolean).map((url) => (
                <DataRow key={url} label="↗">
                  <a href={/^https?:/.test(url!) ? url! : `https://${url}`} target="_blank" rel="noopener noreferrer" className="break-all text-accent" dir="ltr">
                    {url}
                  </a>
                </DataRow>
              ))}
            </dl>
            {p.notes && <p className="mt-3 text-[13.5px] whitespace-pre-wrap text-ink-2">{p.notes}</p>}
            <div className="mt-4">
              <EntityTags type="person" id={p.id} tags={p.tags} invalidate={[['people']]} />
            </div>
          </Panel>
          <BusinessRoles personId={p.id} />
          <CustomFieldsPanel type="person" id={p.id} />
          <AttachmentsPanel type="person" id={p.id} workspaceId={p.workspaceId} />
          <LinksPanel type="person" id={p.id} />
        </div>
      </div>
      <PersonFormModal open={edit} onOpenChange={setEdit} person={p} />
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: p.fullName })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}

/** The roles this person has across your businesses (client of MMA, supplier for Basira…). */
function BusinessRoles({ personId }: { personId: string }) {
  const { t } = useI18n();
  const { byId } = useWorkspace();
  const { data = [] } = useQuery({
    queryKey: ['relations', 'person', personId],
    queryFn: () => api.get<{ id: string; workspaceId: string; role: string }[]>(`/api/relations?personId=${personId}`),
  });
  if (!data.length) return null;
  return (
    <Panel title={t('rel.businessRoles')} padded={false}>
      <ul className="divide-y divide-line">
        {data.map((r) => (
          <li key={r.id}>
            <Link to={`/workspaces/${r.workspaceId}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2">
              <span>{byId(r.workspaceId)?.name}</span>
              <Badge>{t(`rel.role.${r.role}` as MessageKey)}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function PersonFormModal({ open, onOpenChange, person }: { open: boolean; onOpenChange: (o: boolean) => void; person?: Person }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { workspaces, currentId } = useWorkspace();
  const { data: orgs = [] } = useQuery({ queryKey: ['organizations', 'all'], queryFn: () => api.get<{ id: string; name: string }[]>('/api/organizations'), enabled: open });
  const init = () => ({
    fullName: person?.fullName ?? '',
    nickname: person?.nickname ?? '',
    relationship: person?.relationship ?? 'other',
    company: person?.company ?? '',
    organizationId: person?.organizationId ?? '',
    role: person?.role ?? '',
    phone: person?.phone ?? '',
    phone2: person?.phone2 ?? '',
    email: person?.email ?? '',
    city: person?.city ?? '',
    birthday: person?.birthday ?? '',
    linkedin: person?.linkedin ?? '',
    instagram: person?.instagram ?? '',
    website: person?.website ?? '',
    source: person?.source ?? '',
    workspaceId: person?.workspaceId ?? currentId ?? '',
    nextFollowUp: person?.nextFollowUp ?? '',
    followUpNote: person?.followUpNote ?? '',
    notes: person?.notes ?? '',
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
      const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x]));
      body.fullName = v.fullName;
      body.relationship = v.relationship;
      return person ? api.put<Person>(`/api/people/${person.id}`, body) : api.post<Person>('/api/people', body);
    },
    {
      invalidate: LIFE_KEYS,
      success: t('common.saved'),
      silentFieldErrors: true,
      onSuccess: (r) => {
        onOpenChange(false);
        if (!person) navigate(`/people/${r.id}`);
      },
    },
  );
  const text = (key: keyof typeof v, label: MessageKey, opts: { dir?: 'ltr'; type?: string; optional?: boolean } = {}) => (
    <TextField label={t(label)} optional={opts.optional ?? true} dir={opts.dir} type={opts.type} value={v[key]} onChange={(e) => form.set(key, e.target.value)} error={form.errors[key]} />
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={person ? t('people.edit') : t('people.new')}
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
          {text('fullName', 'people.fullName', { optional: false })}
          <Field label={t('people.relationship')}>
            <Select value={v.relationship} onChange={(e) => form.set('relationship', e.target.value)}>
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {t(`people.rel.${r}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          {text('phone', 'people.phone', { dir: 'ltr', type: 'tel' })}
          {text('email', 'people.email', { dir: 'ltr', type: 'email' })}
          {text('company', 'people.company')}
          <Field label={t('people.organization')} optional error={form.errors.organizationId}>
            <Select value={v.organizationId} onChange={(e) => form.set('organizationId', e.target.value)}>
              <option value="">—</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          {text('role', 'people.role')}
          {text('nickname', 'people.nickname')}
          {text('phone2', 'people.phone2', { dir: 'ltr', type: 'tel' })}
          {text('city', 'people.city')}
          <Field label={t('people.birthday')} optional error={form.errors.birthday}>
            <Input type="date" value={v.birthday} onChange={(e) => form.set('birthday', e.target.value)} />
          </Field>
          <Field label={t('people.nextFollowUp')} optional error={form.errors.nextFollowUp}>
            <Input type="date" value={v.nextFollowUp} onChange={(e) => form.set('nextFollowUp', e.target.value)} />
          </Field>
          {text('followUpNote', 'people.followUpNote')}
          {text('linkedin', 'people.linkedin', { dir: 'ltr' })}
          {text('instagram', 'people.instagram', { dir: 'ltr' })}
          {text('website', 'people.website', { dir: 'ltr' })}
          {text('source', 'people.source')}
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
        <Field label={t('common.notes')} optional>
          <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}
