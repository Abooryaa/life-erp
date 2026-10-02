import { CURRENCIES, LEARNING_STATUSES, LEARNING_TYPES, minorToInput, SKILL_CATEGORIES } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ExternalLink, GraduationCap, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { ConfirmDialog, Modal } from '../../components/ui/dialog';
import { Badge, EmptyState, ErrorBlock, LoadingBlock, type Tone } from '../../components/ui/feedback';
import { Field, FormError, Input, Select, Textarea, TextField } from '../../components/ui/form';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { AmountInput, Bar, Money } from '../finance/fin-lib';
import { useGoals } from '../life/life-lib';
import { localToday } from '../life/TasksPage';
import { LinksPanel } from '../shared/LinksPanel';
import { CAREER_KEYS, LevelDots, optLabel, useOpenParam, useSkills, type Learning, type Skill } from './career-lib';

// ---------- skills ----------

export function SkillsPage() {
  const { t, fmt } = useI18n();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [gapsOnly, setGapsOnly] = useState(false);
  const { data = [], isLoading, error, refetch } = useSkills();
  useOpenParam((id) => setEditing(id));
  const shown = gapsOnly ? data.filter((s) => s.gap > 0) : data;
  const groups = SKILL_CATEGORIES.map((c) => ({ c, items: shown.filter((s) => s.category === c) })).filter((g) => g.items.length);
  return (
    <div>
      <PageHeader
        title={t('car.skills')}
        subtitle={t('car.skillsSubtitle')}
        actions={
          <>
            <Button variant={gapsOnly ? 'subtle' : 'ghost'} onClick={() => setGapsOnly((x) => !x)}>
              {t('car.gapsOnly')}
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              {t('car.newSkill')}
            </Button>
          </>
        }
      />
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : !data.length ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<Sparkles className="size-5" />} title={t('car.skillsEmpty')} body={t('car.skillsEmptyBody')} action={<Button variant="primary" onClick={() => setEditing('new')}>{t('car.newSkill')}</Button>} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <Panel key={g.c} title={optLabel(t, 'car.cat', g.c)} padded={false}>
              <ul className="divide-y divide-line">
                {g.items.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => setEditing(s.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-2/60">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{s.name}</p>
                        <p className="truncate text-[12px] text-ink-3">
                          {s.lastUsed ? t('car.lastUsed', { date: fmt.date(s.lastUsed) }) : t('car.neverUsed')}
                          {s.achievementCount > 0 && ` · ${t('car.nAchievements', { n: s.achievementCount })}`}
                        </p>
                      </div>
                      <LevelDots level={s.level} target={s.targetLevel} />
                      {s.gap > 0 && <Badge tone="warn">+{s.gap}</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
      {editing && <SkillModal skill={editing === 'new' ? undefined : data.find((s) => s.id === editing)} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SkillModal({ skill, onClose }: { skill?: Skill; onClose: () => void }) {
  const { t } = useI18n();
  const [del, setDel] = useState(false);
  const { data: goals = [] } = useGoals();
  const form = useFormState({
    name: skill?.name ?? '',
    category: skill?.category ?? 'technical',
    level: String(skill?.level ?? 1),
    targetLevel: skill?.targetLevel == null ? '' : String(skill.targetLevel),
    lastUsed: skill?.lastUsed ?? '',
    evidence: skill?.evidence ?? '',
    goalId: skill?.goalId ?? '',
    notes: skill?.notes ?? '',
  });
  const v = form.values;
  const body = () => ({ ...v, level: Number(v.level), targetLevel: v.targetLevel === '' ? null : Number(v.targetLevel), lastUsed: v.lastUsed || null, goalId: v.goalId || null, evidence: v.evidence || null, notes: v.notes || null });
  const save = useAction(() => (skill ? api.put(`/api/career/skills/${skill.id}`, body()) : api.post('/api/career/skills', body())), {
    invalidate: CAREER_KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: onClose,
  });
  const remove = useAction(() => api.del(`/api/career/skills/${skill!.id}`), { invalidate: CAREER_KEYS, onSuccess: onClose });
  const levels = [0, 1, 2, 3, 4, 5];
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={skill ? t('car.editSkill') : t('car.newSkill')}
      footer={
        <>
          {skill && (
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
      <div className="space-y-4">
        <FormError message={form.formError} />
        <TextField label={t('common.name')} value={v.name} onChange={(e) => form.set('name', e.target.value)} error={form.errors.name} autoFocus={!skill} />
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('car.category')}>
            <Select value={v.category} onChange={(e) => form.set('category', e.target.value)}>
              {SKILL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {optLabel(t, 'car.cat', c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('car.level')} error={form.errors.level}>
            <Select value={v.level} onChange={(e) => form.set('level', e.target.value)}>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l} — {optLabel(t, 'car.lvl', String(l))}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('car.targetLevel')} optional>
            <Select value={v.targetLevel} onChange={(e) => form.set('targetLevel', e.target.value)}>
              <option value="">—</option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l} — {optLabel(t, 'car.lvl', String(l))}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('car.lastUsedLabel')} optional>
            <Input type="date" value={v.lastUsed} onChange={(e) => form.set('lastUsed', e.target.value)} />
          </Field>
          <Field label={t('task.goal')} optional className="md:col-span-2">
            <Select value={v.goalId} onChange={(e) => form.set('goalId', e.target.value)}>
              <option value="">—</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('car.evidence')} optional hint={t('car.evidenceHint')}>
          <Textarea value={v.evidence} onChange={(e) => form.set('evidence', e.target.value)} rows={2} />
        </Field>
        <Field label={t('common.notes')} optional>
          <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={2} />
        </Field>
        {skill && <LinksPanel type="skill" id={skill.id} />}
      </div>
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: v.name })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}

// ---------- learning ----------

const STATUS_TONE: Record<Learning['status'], Tone> = { planned: 'neutral', in_progress: 'accent', paused: 'warn', completed: 'pos', dropped: 'neutral' };

export function LearningPage() {
  const { t, fmt } = useI18n();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ['career', 'learning'], queryFn: () => api.get<Learning[]>('/api/career/learning') });
  useOpenParam((id) => setEditing(id));
  const shown = filter === 'active' ? data.filter((l) => l.status === 'planned' || l.status === 'in_progress' || l.status === 'paused') : data;
  const d = localToday();
  return (
    <div>
      <PageHeader
        title={t('car.learning')}
        subtitle={t('car.learningSubtitle')}
        actions={
          <>
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
              {(['active', 'all'] as const).map((f) => (
                <Button key={f} size="sm" variant={filter === f ? 'subtle' : 'ghost'} onClick={() => setFilter(f)}>
                  {f === 'active' ? t('car.filterActive') : t('prj.filterAll')}
                </Button>
              ))}
            </div>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              {t('car.newLearning')}
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
          <EmptyState icon={<GraduationCap className="size-5" />} title={t('car.learningEmpty')} body={t('car.learningEmptyBody')} action={<Button variant="primary" onClick={() => setEditing('new')}>{t('car.newLearning')}</Button>} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((l) => {
            const late = l.deadline && l.deadline < d && (l.status === 'in_progress' || l.status === 'planned');
            return (
              <button key={l.id} onClick={() => setEditing(l.id)} className="flex flex-col rounded-card border border-line bg-surface p-4 text-start shadow-card hover:border-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{l.title}</p>
                    <p className="truncate text-[12.5px] text-ink-3">{[optLabel(t, 'car.ltype', l.type), l.provider, l.skillName].filter(Boolean).join(' · ')}</p>
                  </div>
                  <Badge tone={STATUS_TONE[l.status]}>{optLabel(t, 'car.lstatus', l.status)}</Badge>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1">
                    <Bar ratio={l.progress / 100} tone={l.status === 'completed' ? 'pos' : late ? 'neg' : 'accent'} />
                  </div>
                  <span className="num text-[12px] text-ink-3">{fmt.percent(l.progress / 100)}</span>
                </div>
                <p className={clsx('mt-2 text-[12px]', late ? 'text-neg' : 'text-ink-3')}>
                  {l.status === 'completed' && l.completedAt
                    ? t('car.completedOn', { date: fmt.date(l.completedAt) })
                    : l.deadline
                      ? `${t('goals.deadline')}: ${fmt.date(l.deadline)}`
                      : ' '}
                </p>
              </button>
            );
          })}
        </div>
      )}
      {editing && <LearningModal item={editing === 'new' ? undefined : data.find((l) => l.id === editing)} onClose={() => setEditing(null)} />}
    </div>
  );
}

function LearningModal({ item, onClose }: { item?: Learning; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [del, setDel] = useState(false);
  const { data: skills = [] } = useSkills();
  const { data: goals = [] } = useGoals();
  const init = () => ({
    title: item?.title ?? '',
    type: item?.type ?? 'course',
    provider: item?.provider ?? '',
    url: item?.url ?? '',
    skillId: item?.skillId ?? '',
    goalId: item?.goalId ?? '',
    status: item?.status ?? 'planned',
    startDate: item?.startDate ?? '',
    deadline: item?.deadline ?? '',
    progress: String(item?.progress ?? 0),
    cost: item?.cost != null ? minorToInput(item.cost, item.currency) : '',
    currency: item?.currency ?? 'EGP',
    notes: item?.notes ?? '',
  });
  const form = useFormState(init());
  useEffect(() => form.setValues(init()), [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const body = () => ({ ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x])), progress: Number(v.progress) || 0 });
  const save = useAction(() => (item ? api.put(`/api/career/learning/${item.id}`, body()) : api.post('/api/career/learning', body())), {
    invalidate: CAREER_KEYS,
    success: t('common.saved'),
    silentFieldErrors: true,
    onSuccess: onClose,
  });
  const remove = useAction(() => api.del(`/api/career/learning/${item!.id}`), { invalidate: CAREER_KEYS, onSuccess: onClose });
  const isUrl = /^https?:\/\//i.test(v.url);
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={item ? t('car.editLearning') : t('car.newLearning')}
      size="lg"
      footer={
        <>
          {item && (
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
      <div className="space-y-4">
        <FormError message={form.formError} />
        <TextField label={t('common.name')} value={v.title} onChange={(e) => form.set('title', e.target.value)} error={form.errors.title} autoFocus={!item} />
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t('common.type')}>
            <Select value={v.type} onChange={(e) => form.set('type', e.target.value)}>
              {LEARNING_TYPES.map((x) => (
                <option key={x} value={x}>
                  {optLabel(t, 'car.ltype', x)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.status')}>
            <Select value={v.status} onChange={(e) => form.set('status', e.target.value as Learning['status'])}>
              {LEARNING_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {optLabel(t, 'car.lstatus', x)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('prj.progress')} error={form.errors.progress} hint={t('car.progressHint')}>
            <Input type="number" min={0} max={100} step={5} value={v.progress} onChange={(e) => form.set('progress', e.target.value)} />
          </Field>
          <TextField label={t('car.provider')} optional value={v.provider} onChange={(e) => form.set('provider', e.target.value)} placeholder="Coursera, Udemy…" />
          <Field label={t('goals.startDate')} optional>
            <Input type="date" value={v.startDate} onChange={(e) => form.set('startDate', e.target.value)} />
          </Field>
          <Field label={t('goals.deadline')} optional error={form.errors.deadline}>
            <Input type="date" value={v.deadline} onChange={(e) => form.set('deadline', e.target.value)} invalid={!!form.errors.deadline} />
          </Field>
          <Field label={t('car.forSkill')} optional>
            <Select value={v.skillId} onChange={(e) => form.set('skillId', e.target.value)}>
              <option value="">—</option>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
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
          <Field label={t('car.cost')} optional error={form.errors.cost}>
            <AmountInput value={v.cost} onChange={(e) => form.set('cost', e.target.value)} currency={v.currency} />
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
        </div>
        <Field label={t('car.link')} optional>
          <div className="flex gap-2">
            <Input value={v.url} onChange={(e) => form.set('url', e.target.value)} dir="ltr" inputMode="url" />
            {isUrl && (
              <a href={v.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center rounded-lg border border-line px-2.5 text-ink-2 hover:text-ink" aria-label={t('common.open')}>
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>
        </Field>
        {item?.cost != null && (
          <p className="text-[12.5px] text-ink-3">
            {t('car.costNote')} <Money minor={item.cost} currency={item.currency} />
          </p>
        )}
        <Field label={t('common.notes')} optional>
          <Textarea value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={3} />
        </Field>
        {item && <LinksPanel type="learning" id={item.id} />}
      </div>
      <ConfirmDialog open={del} onOpenChange={setDel} title={t('common.deleteConfirm', { name: v.title })} confirmLabel={t('common.delete')} loading={remove.isPending} onConfirm={() => remove.mutate(undefined)} />
    </Modal>
  );
}
