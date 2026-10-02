import { addDays } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, CalendarCheck, CheckCircle2, ChevronLeft, ChevronRight, Sparkles, Star } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, ButtonLink } from '../../components/ui/button';
import { Badge, EmptyState, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Field, FormError, Textarea } from '../../components/ui/form';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useAction, useFormState } from '../../lib/hooks';
import { MissingRates, Money } from '../finance/fin-lib';
import { useAiStatus } from '../ai/ai-lib';
import { INSIGHT_KEYS } from './insights-lib';

type ReviewType = 'weekly' | 'monthly';

interface Metrics {
  period: { start: string; end: string };
  previous: { start: string; end: string };
  tasks: { completed: number; created: number; slipped: number };
  tasksPrevious: { completed: number; created: number; slipped: number };
  money: {
    base: string;
    income: number;
    expenses: number;
    net: number;
    savingsRate: number | null;
    previous: { income: number; expenses: number; net: number; savingsRate: number | null };
    topSpending: { name: string; nameAr: string | null; total: number }[];
  };
  netWorth: number;
  goals: { active: number; health: Record<string, number>; checkins: number; needAttention: { id: string; title: string; health: string; progress: number | null }[] };
  life: { events: number; interactions: number; notes: number };
  business: { dealsWon: number; wonValue: number; newDeals: number; projectsCompleted: number };
  career: { applications: number; interviews: number; achievements: number; learningCompleted: number };
  missingRates: string[];
}

interface Review {
  id: string | null;
  type: ReviewType;
  periodStart: string;
  periodEnd: string;
  inProgress: boolean;
  wins: string | null;
  challenges: string | null;
  lessons: string | null;
  priorities: string | null;
  rating: number | null;
  completedAt: string | null;
  savedMetrics: Metrics | null;
  metrics: Metrics;
  previousPriorities: string | null;
}

interface ReviewListItem {
  id: string;
  type: ReviewType;
  periodStart: string;
  periodEnd: string;
  rating: number | null;
  completedAt: string | null;
}

export function ReviewsPage() {
  const { t, fmt } = useI18n();
  const status = useQuery({ queryKey: ['insights', 'review-status'], queryFn: () => api.get<Record<ReviewType, { periodStart: string; periodEnd: string; done: boolean }>>('/api/reviews/status') });
  const list = useQuery({ queryKey: ['insights', 'reviews'], queryFn: () => api.get<ReviewListItem[]>('/api/reviews') });
  return (
    <div className="space-y-5">
      <PageHeader title={t('rev.title')} subtitle={t('rev.subtitle')} />
      {status.data && (
        <div className="grid gap-4 md:grid-cols-2">
          {(['weekly', 'monthly'] as const).map((type) => {
            const s = status.data[type];
            return (
              <Panel key={type}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{t(`rev.${type}` as MessageKey)}</p>
                    <p className="text-[13px] text-ink-3">
                      {fmt.date(s.periodStart)} – {fmt.date(s.periodEnd)}
                    </p>
                  </div>
                  {s.done ? <Badge tone="pos">{t('rev.done')}</Badge> : <Badge tone="warn">{t('rev.due')}</Badge>}
                </div>
                <ButtonLink to={`/reviews/${type}/${s.periodStart}`} className="mt-3" variant={s.done ? 'secondary' : 'primary'} icon={<CalendarCheck className="size-4" />}>
                  {s.done ? t('rev.open') : t('rev.start')}
                </ButtonLink>
              </Panel>
            );
          })}
        </div>
      )}
      <Panel title={t('rev.history')} padded={false}>
        {list.isLoading ? (
          <LoadingBlock />
        ) : !list.data?.length ? (
          <EmptyState icon={<CalendarCheck className="size-5" />} title={t('rev.empty')} body={t('rev.emptyBody')} />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((r) => (
              <li key={r.id}>
                <Link to={`/reviews/${r.type}/${r.periodStart}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {t(`rev.${r.type}` as MessageKey)} · {fmt.date(r.periodStart)} – {fmt.date(r.periodEnd)}
                  </span>
                  {r.rating != null && <Stars value={r.rating} />}
                  {r.completedAt ? <Badge tone="pos">{t('rev.done')}</Badge> : <Badge>{t('rev.draft')}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Stars({ value, onChange }: { value: number | null; onChange?: (v: number | null) => void }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex" role={onChange ? 'radiogroup' : 'img'} aria-label={t('rev.rating')}>
      {[1, 2, 3, 4, 5].map((i) => {
        const on = value != null && i <= value;
        const icon = <Star className={clsx('size-4', on ? 'fill-warn text-warn' : 'text-line-strong')} />;
        return onChange ? (
          <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={String(i)} onClick={() => onChange(value === i ? null : i)} className="p-0.5">
            {icon}
          </button>
        ) : (
          <span key={i}>{icon}</span>
        );
      })}
    </span>
  );
}

/** Change vs the previous period, coloured by whether it's good. */
function Delta({ now, before, higherIsBetter = true, money, base }: { now: number; before: number; higherIsBetter?: boolean; money?: boolean; base?: string }) {
  const { fmt } = useI18n();
  const d = now - before;
  if (!d) return <span className="text-[12px] text-ink-3">=</span>;
  const good = higherIsBetter ? d > 0 : d < 0;
  return <span className={clsx('text-[12px]', good ? 'text-pos' : 'text-neg')}>{money ? fmt.money(d, base, { sign: true, compact: true }) : `${d > 0 ? '+' : ''}${fmt.number(d)}`}</span>;
}

function Metric({ label, value, delta }: { label: string; value: ReactNode; delta?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2/60 p-3">
      <p className="truncate text-[12px] text-ink-3">{label}</p>
      <p className="num text-[17px] font-semibold whitespace-nowrap">{value}</p>
      {delta}
    </div>
  );
}

export function ReviewDetailPage() {
  const { type = 'weekly', start = '' } = useParams();
  const rt = type as ReviewType;
  const { t, fmt, locale } = useI18n();
  const navigate = useNavigate();
  const { data: r, isLoading, error, refetch } = useQuery({ queryKey: ['insights', 'review', rt, start], queryFn: () => api.get<Review>(`/api/reviews/${rt}?start=${start}`) });
  const form = useFormState({ wins: '', challenges: '', lessons: '', priorities: '', rating: null as number | null });
  useEffect(() => {
    if (r) form.setValues({ wins: r.wins ?? '', challenges: r.challenges ?? '', lessons: r.lessons ?? '', priorities: r.priorities ?? '', rating: r.rating });
  }, [r?.periodStart, r?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const ai = useAiStatus();
  const aiReady = !!ai.data?.ready && ai.data.allow.planning && ai.data.allow.finance;
  const [suggestions, setSuggestions] = useState<Record<'wins' | 'challenges' | 'lessons' | 'priorities', string> | null>(null);
  useEffect(() => setSuggestions(null), [rt, start]);
  const suggest = useAction(() => api.post<{ suggestions: Record<'wins' | 'challenges' | 'lessons' | 'priorities', string> }>('/api/ai/review', { type: rt, start: r!.periodStart }), {
    invalidate: [['ai', 'log']],
    onSuccess: (x) => setSuggestions(x.suggestions),
  });
  const save = useAction(
    (completed: boolean) =>
      api.put<Review>('/api/reviews', {
        type: rt,
        periodStart: r!.periodStart,
        wins: form.values.wins || null,
        challenges: form.values.challenges || null,
        lessons: form.values.lessons || null,
        priorities: form.values.priorities || null,
        rating: form.values.rating,
        completed,
      }),
    { invalidate: INSIGHT_KEYS, silentFieldErrors: true, success: (x) => (x.completedAt ? t('rev.completed') : t('common.saved')) },
  );
  if (isLoading) return <LoadingBlock />;
  if (error || !r) return <ErrorBlock error={error ?? 'Not found'} onRetry={refetch} />;
  // A completed review shows the numbers as they were when you completed it.
  const m = r.savedMetrics ?? r.metrics;
  const base = m.money.base;
  const step = (dir: -1 | 1) => {
    const next = rt === 'weekly' ? addDays(r.periodStart, 7 * dir) : `${new Date(Date.UTC(Number(r.periodStart.slice(0, 4)), Number(r.periodStart.slice(5, 7)) - 1 + dir, 1)).toISOString().slice(0, 10)}`;
    navigate(`/reviews/${rt}/${next}`);
  };
  const today = new Date().toISOString().slice(0, 10);
  const nextStart = rt === 'weekly' ? addDays(r.periodStart, 7) : addDays(r.periodEnd, 1);
  const v = form.values;
  const text = (k: 'wins' | 'challenges' | 'lessons' | 'priorities') => (
    <div className="space-y-1.5">
      <Field label={t(`rev.q.${k}` as MessageKey)} hint={t(`rev.h.${k}` as MessageKey)}>
        <Textarea value={v[k]} onChange={(e) => form.set(k, e.target.value)} rows={3} />
      </Field>
      {suggestions?.[k] && (
        <div className="flex items-start gap-2 rounded-lg border border-dashed border-accent/40 bg-accent-soft/40 p-2 text-[13px]">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
          <p className="min-w-0 flex-1 whitespace-pre-wrap" dir="auto">
            {suggestions[k]}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              form.set(k, v[k] ? `${v[k]}\n${suggestions[k]}` : suggestions[k]);
              setSuggestions((s) => (s ? { ...s, [k]: '' } : s));
            }}
          >
            {t('rev.useIt')}
          </Button>
        </div>
      )}
    </div>
  );
  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link to="/reviews" className="mb-1 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
            <ArrowLeft className="size-3.5 rtl:rotate-180" />
            {t('rev.title')}
          </Link>
        }
        title={`${t(`rev.${rt}` as MessageKey)} · ${fmt.date(r.periodStart)} – ${fmt.date(r.periodEnd)}`}
        subtitle={
          r.completedAt ? (
            <span className="inline-flex items-center gap-1 text-pos">
              <CheckCircle2 className="size-4" />
              {t('rev.completedOn', { date: fmt.date(r.completedAt) })} · {t('rev.frozen')}
            </span>
          ) : r.inProgress ? (
            t('rev.inProgress')
          ) : (
            t('rev.liveNumbers')
          )
        }
        actions={
          <>
            <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label={t('rev.previous')}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => step(1)} disabled={nextStart > today} aria-label={t('rev.next')}>
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Button>
          </>
        }
      />
      <MissingRates list={m.missingRates} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title={t('rev.money')}>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
              <Metric label={t('fin.income')} value={<Money minor={m.money.income} currency={base} compact />} delta={<Delta now={m.money.income} before={m.money.previous.income} money base={base} />} />
              <Metric label={t('fin.expenses')} value={<Money minor={m.money.expenses} currency={base} compact />} delta={<Delta now={m.money.expenses} before={m.money.previous.expenses} higherIsBetter={false} money base={base} />} />
              <Metric label={t('fin.savings')} value={<Money minor={m.money.net} currency={base} compact />} delta={<Delta now={m.money.net} before={m.money.previous.net} money base={base} />} />
              <Metric label={t('nw.netWorth')} value={<Money minor={m.netWorth} currency={base} compact />} />
            </div>
            {m.money.topSpending.length > 0 && (
              <ul className="mt-3 space-y-1 text-[13px]">
                {m.money.topSpending.map((c) => (
                  <li key={c.name} className="flex justify-between gap-3">
                    <span className="truncate text-ink-2">{locale === 'ar' && c.nameAr ? c.nameAr : c.name}</span>
                    <Money minor={c.total} currency={base} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={t('rev.work')}>
            <div className="grid grid-cols-3 gap-2">
              <Metric label={t('rev.tasksDone')} value={m.tasks.completed} delta={<Delta now={m.tasks.completed} before={m.tasksPrevious.completed} />} />
              <Metric label={t('rev.tasksAdded')} value={m.tasks.created} />
              <Metric label={t('rev.slipped')} value={m.tasks.slipped} delta={<Delta now={m.tasks.slipped} before={m.tasksPrevious.slipped} higherIsBetter={false} />} />
              <Metric label={t('rev.checkins')} value={m.goals.checkins} />
              <Metric label={t('rev.events')} value={m.life.events} />
              <Metric label={t('rev.interactions')} value={m.life.interactions} />
            </div>
            {m.goals.needAttention.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-[12.5px] font-medium text-ink-3">{t('rev.goalsAttention')}</p>
                <ul className="space-y-1 text-[13px]">
                  {m.goals.needAttention.map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-3">
                      <Link to={`/goals/${g.id}`} className="truncate hover:underline">
                        {g.title}
                      </Link>
                      <Badge tone={g.health === 'at_risk' ? 'warn' : 'neg'}>{t(`an.health.${g.health}` as MessageKey)}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
          <Panel title={t('rev.businessCareer')}>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
              <Metric label={t('rev.dealsWon')} value={m.business.dealsWon} delta={m.business.wonValue ? <Money minor={m.business.wonValue} currency={base} compact className="text-[12px] text-pos" /> : undefined} />
              <Metric label={t('rev.newDeals')} value={m.business.newDeals} />
              <Metric label={t('rev.projectsDone')} value={m.business.projectsCompleted} />
              <Metric label={t('an.applications')} value={m.career.applications} />
              <Metric label={t('car.interviews')} value={m.career.interviews} />
              <Metric label={t('car.achievements')} value={m.career.achievements} />
              <Metric label={t('an.learningDone')} value={m.career.learningCompleted} />
              <Metric label={t('rev.notes')} value={m.life.notes} />
            </div>
          </Panel>
        </div>
        <Panel
          title={t('rev.reflect')}
          actions={
            aiReady && (
              <Button size="sm" variant="ghost" icon={<Sparkles className="size-4" />} loading={suggest.isPending} onClick={() => suggest.mutate(undefined)}>
                {t('rev.aiSuggest')}
              </Button>
            )
          }
        >
          <div className="space-y-4">
            <FormError message={form.formError} />
            {suggestions && <p className="rounded-lg bg-surface-2/70 px-3 py-2 text-[12.5px] text-ink-3">{t('rev.aiNote')}</p>}
            {r.previousPriorities && (
              <div className="rounded-lg border border-line bg-surface-2/60 p-3">
                <p className="text-[12.5px] font-medium text-ink-3">{t('rev.lastPriorities')}</p>
                <p className="mt-1 text-[13.5px] whitespace-pre-wrap">{r.previousPriorities}</p>
              </div>
            )}
            {text('wins')}
            {text('challenges')}
            {text('lessons')}
            {text('priorities')}
            <Field label={t('rev.rating')}>
              <Stars value={v.rating} onChange={(x) => form.set('rating', x)} />
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button loading={save.isPending && save.variables === false} onClick={() => save.mutate(false, { onError: form.fail })}>
                {r.completedAt ? t('rev.reopen') : t('rev.saveDraft')}
              </Button>
              <Button variant="primary" icon={<CheckCircle2 className="size-4" />} loading={save.isPending && save.variables === true} onClick={() => save.mutate(true, { onError: form.fail })}>
                {r.completedAt ? t('rev.updateCompleted') : t('rev.complete')}
              </Button>
            </div>
            <p className="text-[12px] text-ink-3">{t('rev.completeHint')}</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
