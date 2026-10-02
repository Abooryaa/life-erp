import { CURRENCIES, EMPLOYMENT_TYPES, minorToInput, SALARY_PERIODS } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Briefcase, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea, TextField } from '../../components/ui/form';
import { DataRow, PageHeader, Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { useOrganizations } from '../business/biz-lib';
import { AmountInput, Money } from '../finance/fin-lib';
import { usePeople } from '../life/life-lib';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { LinksPanel } from '../shared/LinksPanel';
import { CustomFieldsPanel } from '../tools/CustomFields';
import { EntityTags } from '../shared/TagEditor';
import { AchievementItem, AchievementModal } from './AchievementsPage';
import { CAREER_KEYS, optLabel, useJobs, useTenure, type Employment } from './career-lib';

export function JobsPage() {
  const { t, fmt } = useI18n();
  const tenure = useTenure();
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading, error, refetch } = useJobs();
  return (
    <div>
      <PageHeader
        title={t('car.jobs')}
        subtitle={t('car.jobsSubtitle')}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('car.newJob')}
          </Button>
        }
      />
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : !data.length ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Briefcase className="size-5" />} title={t('car.jobsEmpty')} body={t('car.jobsEmptyBody')} action={<Button variant="primary" onClick={() => setCreating(true)}>{t('car.newJob')}</Button>} />
        </div>
      ) : (
        <ol className="relative space-y-3 border-s-2 border-line ps-5">
          {data.map((j) => (
            <li key={j.id} className="relative">
              <span className={`absolute -start-[27px] top-4 size-3 rounded-full border-2 border-surface ${j.current ? 'bg-pos' : 'bg-line-strong'}`} aria-hidden />
              <Link to={`/career/jobs/${j.id}`} className="block rounded-card border border-line bg-surface p-4 shadow-card hover:border-line-strong">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{j.position}</p>
                    <p className="text-[13px] text-ink-3">
                      {j.company}
                      {j.department && ` · ${j.department}`}
                    </p>
                  </div>
                  {j.current && <Badge tone="pos">{t('car.current')}</Badge>}
                </div>
                <p className="mt-2 text-[12.5px] text-ink-3">
                  {fmt.date(j.startDate)} – {j.endDate ? fmt.date(j.endDate) : t('car.present')} · {tenure(j.months)} · {optLabel(t, 'car.empType', j.employmentType)}
                </p>
              </Link>
            </li>
          ))}
        </ol>
      )}
      <JobFormModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}

export function JobDetailPage() {
  const { id = '' } = useParams();
  const { t, fmt } = useI18n();
  const tenure = useTenure();
  const navigate = useNavigate();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [addAch, setAddAch] = useState(false);
  const [openAch, setOpenAch] = useState<string | null>(null);
  const { data: j, isLoading, error, refetch } = useQuery({ queryKey: ['career', 'job', id], queryFn: () => api.get<Employment>(`/api/career/jobs/${id}`) });
  const remove = useAction(() => api.del(`/api/career/jobs/${id}`), { invalidate: CAREER_KEYS, onSuccess: () => navigate('/career/jobs') });
  if (isLoading) return <LoadingBlock />;
  if (error || !j) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;
  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link to="/career/jobs" className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t('car.jobs')}
          </Link>
        }
        title={j.position}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {j.current && <Badge tone="pos">{t('car.current')}</Badge>}
            {j.company} · {tenure(j.months)}
          </span>
        }
        actions={
          <>
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
          {j.responsibilities && (
            <Panel title={t('car.responsibilities')}>
              <p className="text-[13.5px] whitespace-pre-wrap text-ink-2">{j.responsibilities}</p>
            </Panel>
          )}
          <Panel
            title={t('car.achievements')}
            padded={false}
            actions={
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAddAch(true)}>
                {t('common.add')}
              </Button>
            }
          >
            {j.achievements?.length ? (
              <ul className="divide-y divide-line">
                {j.achievements.map((a) => (
                  <AchievementItem key={a.id} a={a} onOpen={() => setOpenAch(a.id)} />
                ))}
              </ul>
            ) : (
              <p className="p-4 text-[13px] text-ink-3">{t('car.noAchievementsJob')}</p>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel>
            <dl>
              <DataRow label={t('goals.startDate')}>{fmt.date(j.startDate)}</DataRow>
              <DataRow label={t('car.endDate')}>{j.endDate ? fmt.date(j.endDate) : t('car.present')}</DataRow>
              <DataRow label={t('common.type')}>{optLabel(t, 'car.empType', j.employmentType)}</DataRow>
              {j.salary != null && (
                <DataRow label={t('car.salary')}>
                  <Money minor={j.salary} currency={j.currency} /> / {optLabel(t, 'car.period', j.salaryPeriod)}
                </DataRow>
              )}
              {j.location && <DataRow label={t('cal.location')}>{j.location}</DataRow>}
              {j.workSchedule && <DataRow label={t('car.schedule')}>{j.workSchedule}</DataRow>}
              {j.managerName && <DataRow label={t('car.manager')}>{j.managerName}</DataRow>}
            </dl>
            {j.benefits && <p className="mt-3 text-[13px] whitespace-pre-wrap text-ink-2">{j.benefits}</p>}
            {j.notes && <p className="mt-3 text-[13px] whitespace-pre-wrap text-ink-3">{j.notes}</p>}
            <div className="mt-4">
              <EntityTags type="employment" id={j.id} tags={j.tags ?? []} invalidate={[['career']]} />
            </div>
          </Panel>
          <CustomFieldsPanel type="employment" id={j.id} />
          <AttachmentsPanel type="employment" id={j.id} />
          <LinksPanel type="employment" id={j.id} />
        </div>
      </div>
      <JobFormModal open={edit} onOpenChange={setEdit} job={j} />
      {(addAch || openAch) && <AchievementModal achievementId={openAch ?? undefined} defaultEmploymentId={j.id} onClose={() => (setAddAch(false), setOpenAch(null))} />}
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={t('common.deleteConfirm', { name: `${j.position} — ${j.company}` })}
        body={t('car.deleteJobBody')}
        confirmLabel={t('common.delete')}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined)}
      />
    </div>
  );
}

function JobFormModal({ open, onOpenChange, job }: { open: boolean; onOpenChange: (o: boolean) => void; job?: Employment }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { data: orgs = [] } = useOrganizations();
  const { data: people = [] } = usePeople();
  const init = () => ({
    company: job?.company ?? '',
    organizationId: job?.organizationId ?? '',
    position: job?.position ?? '',
    department: job?.department ?? '',
    employmentType: job?.employmentType ?? 'full_time',
    startDate: job?.startDate ?? '',
    endDate: job?.endDate ?? '',
    salary: job?.salary != null ? minorToInput(job.salary, job.currency) : '',
    currency: job?.currency ?? 'EGP',
    salaryPeriod: job?.salaryPeriod ?? 'monthly',
    benefits: job?.benefits ?? '',
    location: job?.location ?? '',
    workSchedule: job?.workSchedule ?? '',
    managerName: job?.managerName ?? '',
    managerPersonId: job?.managerPersonId ?? '',
    responsibilities: job?.responsibilities ?? '',
    notes: job?.notes ?? '',
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
      return job ? api.put<Employment>(`/api/career/jobs/${job.id}`, body) : api.post<Employment>('/api/career/jobs', body);
    },
    {
      invalidate: CAREER_KEYS,
      success: t('common.saved'),
      silentFieldErrors: true,
      onSuccess: (r) => {
        onOpenChange(false);
        if (!job) navigate(`/career/jobs/${r.id}`);
      },
    },
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={job ? t('car.editJob') : t('car.newJob')}
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
          <TextField label={t('car.position')} value={v.position} onChange={(e) => form.set('position', e.target.value)} error={form.errors.position} autoFocus />
          <TextField label={t('car.company')} value={v.company} onChange={(e) => form.set('company', e.target.value)} error={form.errors.company} />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('goals.startDate')} error={form.errors.startDate}>
            <Input type="date" value={v.startDate} onChange={(e) => form.set('startDate', e.target.value)} invalid={!!form.errors.startDate} />
          </Field>
          <Field label={t('car.endDate')} hint={t('car.endDateHint')} error={form.errors.endDate}>
            <Input type="date" value={v.endDate} onChange={(e) => form.set('endDate', e.target.value)} invalid={!!form.errors.endDate} />
          </Field>
          <Field label={t('common.type')}>
            <Select value={v.employmentType} onChange={(e) => form.set('employmentType', e.target.value)}>
              {EMPLOYMENT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {optLabel(t, 'car.empType', x)}
                </option>
              ))}
            </Select>
          </Field>
          <TextField label={t('car.department')} optional value={v.department} onChange={(e) => form.set('department', e.target.value)} />
          <TextField label={t('cal.location')} optional value={v.location} onChange={(e) => form.set('location', e.target.value)} />
          <TextField label={t('car.schedule')} optional value={v.workSchedule} onChange={(e) => form.set('workSchedule', e.target.value)} placeholder="Sun–Thu 9–5" />
          <Field label={t('car.salary')} optional error={form.errors.salary}>
            <AmountInput value={v.salary} onChange={(e) => form.set('salary', e.target.value)} currency={v.currency} />
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
          <Field label={t('car.salaryPeriod')}>
            <Select value={v.salaryPeriod} onChange={(e) => form.set('salaryPeriod', e.target.value)}>
              {SALARY_PERIODS.map((x) => (
                <option key={x} value={x}>
                  {optLabel(t, 'car.period', x)}
                </option>
              ))}
            </Select>
          </Field>
          <TextField label={t('car.manager')} optional value={v.managerName} onChange={(e) => form.set('managerName', e.target.value)} />
          <Field label={t('car.managerContact')} optional>
            <Select value={v.managerPersonId} onChange={(e) => form.set('managerPersonId', e.target.value)}>
              <option value="">—</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('car.companyRecord')} optional>
            <Select value={v.organizationId} onChange={(e) => form.set('organizationId', e.target.value)}>
              <option value="">—</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('car.responsibilities')} optional>
          <Textarea value={v.responsibilities} onChange={(e) => form.set('responsibilities', e.target.value)} rows={4} />
        </Field>
        <Field label={t('car.benefits')} optional>
          <Textarea value={v.benefits} onChange={(e) => form.set('benefits', e.target.value)} rows={2} />
        </Field>
        <Field label={t('common.notes')} optional>
          <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
