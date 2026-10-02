import { cvBullet } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { Copy, FileDown, Plus, Trash2, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock, Spinner, useToast } from '../../components/ui/feedback';
import { Field, FormError, Input, NoFieldId, Select, Textarea, TextField } from '../../components/ui/form';
import { PageHeader } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { localToday } from '../life/TasksPage';
import { LinksPanel } from '../shared/LinksPanel';
import { TagInput } from '../shared/TagEditor';
import { CAREER_KEYS, useJobs, useOpenParam, useSkills, type Achievement } from './career-lib';

export function AchievementItem({ a, onOpen }: { a: Achievement; onOpen: () => void }) {
  const { t, fmt } = useI18n();
  return (
    <li>
      <button onClick={onOpen} className="block w-full px-4 py-3 text-start hover:bg-surface-2/60">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 font-medium">{a.title}</p>
          <span className="num shrink-0 text-[12px] text-ink-3">{fmt.date(a.date)}</span>
        </div>
        {a.metric && <p className="mt-0.5 text-[13px] font-medium text-pos">{a.metric}</p>}
        <p className="mt-1 text-[12.5px] text-ink-3">
          {[a.company, a.role].filter(Boolean).join(' · ')}
          {a.cvRelevance === 3 && <Badge tone="accent" className="ms-2">{t('car.relevance.3')}</Badge>}
        </p>
        {a.skills.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {a.skills.map((s) => (
              <Badge key={s.id}>{s.name}</Badge>
            ))}
          </div>
        )}
      </button>
    </li>
  );
}

export function AchievementsPage() {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [cvOpen, setCvOpen] = useState(false);
  const [job, setJob] = useState('');
  const { data: jobs = [] } = useJobs();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['career', 'achievements'], queryFn: () => api.get<Achievement[]>('/api/career/achievements') });
  useOpenParam((id) => setEditing(id));
  const shown = job ? data.filter((a) => (job === '-' ? !a.employmentId : a.employmentId === job)) : data;
  return (
    <div>
      <PageHeader
        title={t('car.achievements')}
        subtitle={t('car.achievementsSubtitle')}
        actions={
          <>
            {jobs.length > 0 && (
              <Select value={job} onChange={(e) => setJob(e.target.value)} aria-label={t('car.jobs')} className="w-52">
                <option value="">{t('car.allJobs')}</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.position} — {j.company}
                  </option>
                ))}
                <option value="-">{t('car.otherAchievements')}</option>
              </Select>
            )}
            <Button icon={<FileDown className="size-4" />} onClick={() => setCvOpen(true)} disabled={!data.length}>
              {t('car.cvExport')}
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              {t('car.newAchievement')}
            </Button>
          </>
        }
      />
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : !shown.length ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Trophy className="size-5" />} title={t('car.achEmpty')} body={t('car.achEmptyBody')} action={<Button variant="primary" onClick={() => setEditing('new')}>{t('car.newAchievement')}</Button>} />
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface shadow-card">
          {shown.map((a) => (
            <AchievementItem key={a.id} a={a} onOpen={() => setEditing(a.id)} />
          ))}
        </ul>
      )}
      {editing && <AchievementModal achievementId={editing === 'new' ? undefined : editing} defaultEmploymentId={job && job !== '-' ? job : undefined} onClose={() => setEditing(null)} />}
      {cvOpen && <CvModal onClose={() => setCvOpen(false)} />}
    </div>
  );
}

export function AchievementModal({ achievementId, defaultEmploymentId, onClose }: { achievementId?: string; defaultEmploymentId?: string; onClose: () => void }) {
  const { t } = useI18n();
  const [del, setDel] = useState(false);
  const { data: jobs = [] } = useJobs();
  const { data: skills = [] } = useSkills();
  const list = useQuery({ queryKey: ['career', 'achievements'], queryFn: () => api.get<Achievement[]>('/api/career/achievements'), enabled: !!achievementId });
  const existing = list.data?.find((a) => a.id === achievementId);
  const form = useFormState({
    date: localToday(),
    employmentId: defaultEmploymentId ?? '',
    title: '',
    description: '',
    metric: '',
    impact: '',
    skillIds: [] as string[],
    cvRelevance: '2',
    cvBullet: '',
    tags: [] as string[],
  });
  useEffect(() => {
    const a = existing;
    if (a)
      form.setValues({
        date: a.date,
        employmentId: a.employmentId ?? '',
        title: a.title,
        description: a.description ?? '',
        metric: a.metric ?? '',
        impact: a.impact ?? '',
        skillIds: a.skills.map((s) => s.id),
        cvRelevance: String(a.cvRelevance),
        cvBullet: a.cvBullet ?? '',
        tags: [],
      });
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const nul = (s: string) => s || null;
  const body = () => {
    const b = { ...v, employmentId: nul(v.employmentId), description: nul(v.description), metric: nul(v.metric), impact: nul(v.impact), cvBullet: nul(v.cvBullet), cvRelevance: Number(v.cvRelevance) };
    // Tags of an existing achievement are edited elsewhere; only send them when creating.
    if (achievementId) delete (b as Partial<typeof b>).tags;
    return b;
  };
  const save = useAction(() => (achievementId ? api.put(`/api/career/achievements/${achievementId}`, body()) : api.post('/api/career/achievements', body())), {
    invalidate: CAREER_KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: onClose,
  });
  const remove = useAction(() => api.del(`/api/career/achievements/${achievementId}`), { invalidate: CAREER_KEYS, onSuccess: onClose });
  const toggleSkill = (id: string) => form.set('skillIds', v.skillIds.includes(id) ? v.skillIds.filter((x) => x !== id) : [...v.skillIds, id]);
  const skillNames = skills.filter((s) => v.skillIds.includes(s.id)).map((s) => s.name);
  // Same assembly the server uses: only your own words, never invented.
  const preview = v.title.trim() ? cvBullet({ title: v.title, metric: v.metric, impact: v.impact, skills: skillNames }) : '';
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={achievementId ? t('car.editAchievement') : t('car.newAchievement')}
      size="lg"
      footer={
        <>
          {achievementId && (
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
      {achievementId && list.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <FormError message={form.formError} />
          <TextField label={t('car.achTitle')} value={v.title} onChange={(e) => form.set('title', e.target.value)} error={form.errors.title} autoFocus={!achievementId} placeholder={t('car.achTitlePh')} />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t('common.date')} error={form.errors.date}>
              <Input type="date" value={v.date} onChange={(e) => form.set('date', e.target.value)} />
            </Field>
            <Field label={t('car.job')} optional>
              <Select value={v.employmentId} onChange={(e) => form.set('employmentId', e.target.value)}>
                <option value="">—</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.position} — {j.company}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('car.cvRelevance')}>
              <Select value={v.cvRelevance} onChange={(e) => form.set('cvRelevance', e.target.value)}>
                {[3, 2, 1].map((r) => (
                  <option key={r} value={r}>
                    {t(`car.relevance.${r}` as MessageKey)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label={t('car.metric')} optional value={v.metric} onChange={(e) => form.set('metric', e.target.value)} placeholder={t('car.metricPh')} />
            <TextField label={t('car.impact')} optional value={v.impact} onChange={(e) => form.set('impact', e.target.value)} />
          </div>
          <Field label={t('car.skillsUsed')} optional hint={!skills.length ? t('car.noSkillsYet') : undefined}>
            <NoFieldId>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={v.skillIds.includes(s.id)}
                    onClick={() => toggleSkill(s.id)}
                    className={v.skillIds.includes(s.id) ? 'rounded-full bg-accent px-3 py-1 text-[12.5px] font-medium text-white' : 'rounded-full bg-surface-2 px-3 py-1 text-[12.5px] font-medium text-ink-2'}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </NoFieldId>
          </Field>
          <Field label={t('common.description')} optional>
            <Textarea value={v.description} onChange={(e) => form.set('description', e.target.value)} rows={3} />
          </Field>
          <Field label={t('car.cvBullet')} optional hint={t('car.cvBulletHint')}>
            <Textarea value={v.cvBullet} onChange={(e) => form.set('cvBullet', e.target.value)} rows={2} placeholder={preview} />
          </Field>
          {!achievementId && (
            <Field label={t('common.tags')} optional>
              <TagInput value={v.tags} onChange={(tags) => form.set('tags', tags)} />
            </Field>
          )}
          {achievementId && <LinksPanel type="achievement" id={achievementId} />}
        </div>
      )}
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: v.title })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}

function CvModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [min, setMin] = useState('2');
  const { data, isLoading } = useQuery({ queryKey: ['career', 'cv', min], queryFn: () => api.get<{ text: string }>(`/api/career/achievements/cv?minRelevance=${min}`) });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data?.text ?? '');
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('car.copyFailed'));
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([data?.text ?? ''], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cv-achievements.md';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('car.cvExport')}
      description={t('car.cvExportHint')}
      size="lg"
      footer={
        <>
          <Button icon={<FileDown className="size-4" />} onClick={download} disabled={!data?.text}>
            {t('common.download')}
          </Button>
          <Button variant="primary" icon={<Copy className="size-4" />} onClick={copy} disabled={!data?.text}>
            {t('common.copy')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('car.cvRelevance')}>
          <Select value={min} onChange={(e) => setMin(e.target.value)}>
            <option value="3">{t('car.relevance.3')}</option>
            <option value="2">{t('car.relevanceAtLeast2')}</option>
            <option value="1">{t('common.all')}</option>
          </Select>
        </Field>
        {isLoading ? <Spinner /> : <pre className="max-h-[50dvh] overflow-auto rounded-lg border border-line bg-surface-2 p-3 text-[12.5px] whitespace-pre-wrap" dir="auto">{data?.text || t('car.cvEmpty')}</pre>}
      </div>
    </Modal>
  );
}
