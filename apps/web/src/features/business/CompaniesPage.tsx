import { ORG_TYPES } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, Dot, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea, TextField } from '../../components/ui/form';
import { DataRow, PageHeader, Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useAction, useDebounced, useFormState } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { LinksPanel } from '../shared/LinksPanel';
import { CustomFieldsPanel } from '../tools/CustomFields';
import { EntityTags, TagList } from '../shared/TagEditor';
import { BIZ_KEYS, type Opportunity, type Organization, type Project, type Relation } from './biz-lib';
import { ProjectCard } from './ProjectsPage';

export function CompaniesPage() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['organizations', 'list', dq, type], queryFn: () => api.get<Organization[]>(`/api/organizations${qs({ q: dq, type })}`) });
  return (
    <div>
      <PageHeader
        title={t('org.title')}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t('org.new')}
          </Button>
        }
      />
      <div className="mb-4 flex gap-2">
        <Input className="max-w-xs" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('common.search')} />
        <Select className="w-44" value={type} onChange={(e) => setType(e.target.value)} aria-label={t('org.type')}>
          <option value="">{t('common.all')}</option>
          {ORG_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`org.type.${x}` as MessageKey)}
            </option>
          ))}
        </Select>
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : data.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Building className="size-5" />} title={t('org.empty')} body={t('org.emptyBody')} action={<Button variant="primary" onClick={() => setCreating(true)}>{t('org.new')}</Button>} />
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface shadow-card">
          {data.map((o) => (
            <li key={o.id}>
              <Link to={`/companies/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-2">
                  <Building className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {o.name}
                    <span className="text-[12px] font-normal text-ink-3">{t(`org.type.${o.type}` as MessageKey)}</span>
                  </p>
                  <p className="flex flex-wrap gap-x-2 text-[12.5px] text-ink-3">
                    {[o.industry, o.city].filter(Boolean).join(' · ')}
                    <span>{t('org.counts', { p: o.peopleCount ?? 0, o: o.opportunityCount ?? 0, j: o.projectCount ?? 0 })}</span>
                    <TagList tags={o.tags} />
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CompanyFormModal open={creating} onOpenChange={setCreating} />
    </div>
  );
}

interface CompanyDetail extends Organization {
  people: { id: string; fullName: string; role: string | null; phone: string | null; email: string | null }[];
  relations: Relation[];
}

export function CompanyDetailPage() {
  const { id = '' } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { byId } = useWorkspace();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const { data: o, isLoading, error, refetch } = useQuery({ queryKey: ['organizations', id], queryFn: () => api.get<CompanyDetail>(`/api/organizations/${id}`) });
  const opps = useQuery({ queryKey: ['opportunities', 'org', id], queryFn: () => api.get<Opportunity[]>(`/api/opportunities?organizationId=${id}`) });
  const prjs = useQuery({ queryKey: ['projects', 'org', id], queryFn: () => api.get<Project[]>(`/api/projects?organizationId=${id}`) });
  const remove = useAction(() => api.del(`/api/organizations/${id}`), { invalidate: BIZ_KEYS, onSuccess: () => navigate('/companies') });
  if (isLoading) return <LoadingBlock />;
  if (error || !o) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;
  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link to="/companies" className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t('org.title')}
          </Link>
        }
        title={o.name}
        subtitle={[t(`org.type.${o.type}` as MessageKey), o.industry, o.city].filter(Boolean).join(' · ')}
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
          <Panel title={t('rel.businessRoles')} padded={false}>
            {o.relations.length === 0 ? (
              <p className="p-4 text-[13px] text-ink-3">—</p>
            ) : (
              <ul className="divide-y divide-line">
                {o.relations.map((r) => {
                  const ws = byId(r.workspaceId);
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                      {ws && <Dot color={ws.color} />}
                      <Link to={`/workspaces/${r.workspaceId}`} className="flex-1 hover:underline">
                        {ws?.name}
                      </Link>
                      <Badge>{t(`rel.role.${r.role}` as MessageKey)}</Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title={t('org.people')} padded={false}>
            {o.people.length === 0 ? (
              <p className="p-4 text-[13px] text-ink-3">—</p>
            ) : (
              <ul className="divide-y divide-line">
                {o.people.map((p) => (
                  <li key={p.id}>
                    <Link to={`/people/${p.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2">
                      <span className="font-medium">{p.fullName}</span>
                      <span className="text-[12.5px] text-ink-3">{p.role}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {(opps.data ?? []).length > 0 && (
            <Panel title={t('opp.title')} padded={false}>
              <ul className="divide-y divide-line">
                {opps.data!.map((x) => (
                  <li key={x.id}>
                    <Link to={`/pipeline?open=${x.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2">
                      <span className="min-w-0 flex-1 truncate">{x.title}</span>
                      <Badge tone={x.kind === 'won' ? 'pos' : x.kind === 'lost' ? 'neg' : 'neutral'}>{x.stageName}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {(prjs.data ?? []).length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {prjs.data!.map((p) => (
                <ProjectCard key={p.id} p={p} />
              ))}
            </div>
          )}
        </div>
        <div className="space-y-5">
          <Panel>
            <dl>
              {o.phone && <DataRow label={t('people.phone')}><a href={`tel:${o.phone}`} dir="ltr" className="text-accent">{o.phone}</a></DataRow>}
              {o.email && <DataRow label={t('people.email')}><span dir="ltr">{o.email}</span></DataRow>}
              {o.website && (
                <DataRow label={t('ws.website')}>
                  <a href={/^https?:/.test(o.website) ? o.website : `https://${o.website}`} target="_blank" rel="noopener noreferrer" className="break-all text-accent" dir="ltr">
                    {o.website}
                  </a>
                </DataRow>
              )}
              {o.address && <DataRow label={t('org.address')}>{o.address}</DataRow>}
            </dl>
            {o.notes && <p className="mt-3 text-[13.5px] whitespace-pre-wrap text-ink-2">{o.notes}</p>}
            <div className="mt-4">
              <EntityTags type="organization" id={o.id} tags={o.tags} invalidate={[['organizations']]} />
            </div>
          </Panel>
          <CustomFieldsPanel type="organization" id={o.id} />
          <AttachmentsPanel type="organization" id={o.id} />
          <LinksPanel type="organization" id={o.id} />
        </div>
      </div>
      <CompanyFormModal open={edit} onOpenChange={setEdit} org={o} />
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: o.name })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}

export function CompanyFormModal({ open, onOpenChange, org }: { open: boolean; onOpenChange: (o: boolean) => void; org?: Organization }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const init = () => ({
    name: org?.name ?? '',
    type: org?.type ?? 'company',
    industry: org?.industry ?? '',
    website: org?.website ?? '',
    phone: org?.phone ?? '',
    email: org?.email ?? '',
    address: org?.address ?? '',
    city: org?.city ?? '',
    instagram: org?.instagram ?? '',
    notes: org?.notes ?? '',
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
      body.name = v.name;
      body.type = v.type;
      return org ? api.put<Organization>(`/api/organizations/${org.id}`, body) : api.post<Organization>('/api/organizations', body);
    },
    {
      invalidate: BIZ_KEYS,
      success: t('common.saved'),
      silentFieldErrors: true,
      onSuccess: (r) => {
        onOpenChange(false);
        if (!org) navigate(`/companies/${r.id}`);
      },
    },
  );
  const text = (k: keyof typeof v, label: MessageKey, dir?: 'ltr') => (
    <TextField label={t(label)} optional={k !== 'name'} dir={dir} value={v[k]} onChange={(e) => form.set(k, e.target.value)} error={form.errors[k]} />
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={org ? t('org.edit') : t('org.new')}
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
          {text('name', 'common.name')}
          <Field label={t('org.type')}>
            <Select value={v.type} onChange={(e) => form.set('type', e.target.value)}>
              {ORG_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`org.type.${x}` as MessageKey)}
                </option>
              ))}
            </Select>
          </Field>
          {text('industry', 'org.industry')}
          {text('city', 'people.city')}
          {text('phone', 'people.phone', 'ltr')}
          {text('email', 'people.email', 'ltr')}
          {text('website', 'ws.website', 'ltr')}
          {text('instagram', 'people.instagram', 'ltr')}
        </div>
        {text('address', 'org.address')}
        <Field label={t('common.notes')} optional>
          <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}
