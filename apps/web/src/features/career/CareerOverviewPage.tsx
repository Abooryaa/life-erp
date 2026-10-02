import { useQuery } from '@tanstack/react-query';
import { Briefcase, CalendarClock, GraduationCap, Send, Sparkles, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { PageHeader, Panel, Stat } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { Bar } from '../finance/fin-lib';
import { LevelDots, optLabel, StatusBadge, useTenure, type Achievement, type Application, type Employment, type Interview, type Learning, type Skill } from './career-lib';

interface Overview {
  current: Employment[];
  totalMonths: number;
  funnel: { applied: number; inProgress: number; interviews: number; offers: number; responseRate: number | null; interviewRate: number | null; offerRate: number | null };
  openApplications: number;
  highPriority: Application[];
  interviews: (Interview & { company: string; position: string })[];
  followUps: Application[];
  skillGaps: Skill[];
  skillCount: number;
  learning: Learning[];
  learningOverdue: number;
  recentAchievements: Achievement[];
}

const SECTIONS = [
  { to: '/career/applications', key: 'car.applications', icon: Send },
  { to: '/career/jobs', key: 'car.jobs', icon: Briefcase },
  { to: '/career/achievements', key: 'car.achievements', icon: Trophy },
  { to: '/career/skills', key: 'car.skills', icon: Sparkles },
  { to: '/career/learning', key: 'car.learning', icon: GraduationCap },
] as const;

export function CareerOverviewPage() {
  const { t, fmt } = useI18n();
  const tenure = useTenure();
  const { data: o, isLoading, error, refetch } = useQuery({ queryKey: ['career', 'overview'], queryFn: () => api.get<Overview>('/api/career/overview') });
  if (isLoading) return <LoadingBlock />;
  if (error || !o) return <ErrorBlock error={error ?? 'No data'} onRetry={refetch} />;
  const rate = (r: number | null) => (r == null ? '—' : fmt.percent(r));
  return (
    <div className="space-y-5">
      <PageHeader title={t('car.title')} subtitle={o.current.length ? o.current.map((j) => `${j.position} — ${j.company}`).join(' · ') : t('car.noCurrentJob')} />
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin md:mx-0 md:px-0" aria-label={t('car.title')}>
        {SECTIONS.map((s) => (
          <Link key={s.to} to={s.to} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:border-line-strong">
            <s.icon className="size-4 text-ink-3" />
            {t(s.key)}
          </Link>
        ))}
      </nav>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Panel>
          <Stat label={t('car.currentTenure')} value={o.current[0] ? tenure(o.current[0].months) : '—'} hint={o.totalMonths ? t('car.totalExperience', { t: tenure(o.totalMonths) }) : undefined} />
        </Panel>
        <Panel>
          <Stat label={t('car.openApplications')} value={o.openApplications} hint={t('car.f.applied') + ': ' + fmt.number(o.funnel.applied)} />
        </Panel>
        <Panel>
          <Stat label={t('car.f.interviewRate')} value={rate(o.funnel.interviewRate)} hint={`${t('car.f.offerRate')}: ${rate(o.funnel.offerRate)}`} />
        </Panel>
        <Panel>
          <Stat label={t('car.skills')} value={o.skillCount} hint={o.skillGaps.length ? t('car.nGaps', { n: o.skillGaps.length }) : undefined} tone={o.skillGaps.length ? 'warn' : undefined} />
        </Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={t('car.upcomingInterviews')} padded={false} actions={<Link to="/career/applications" className="text-[12.5px] text-accent">{t('common.open')}</Link>}>
          {o.interviews.length || o.followUps.length ? (
            <ul className="divide-y divide-line">
              {o.interviews.map((i) => (
                <li key={i.id}>
                  <Link to={`/career/applications?open=${i.applicationId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                    <CalendarClock className="size-4 shrink-0 text-info" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{i.company}</p>
                      <p className="truncate text-[12px] text-ink-3">
                        {i.position} · {i.stage} · {optLabel(t, 'car.ivMode', i.mode)}
                      </p>
                    </div>
                    <span className="num shrink-0 text-[12.5px] text-ink-2">
                      {fmt.date(i.date)} {i.time ?? ''}
                    </span>
                  </Link>
                </li>
              ))}
              {o.followUps.map((a) => (
                <li key={a.id}>
                  <Link to={`/career/applications?open=${a.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                    <Send className="size-4 shrink-0 text-warn" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{t('car.followUpWith', { company: a.company })}</p>
                      <p className="truncate text-[12px] text-ink-3">{a.position}</p>
                    </div>
                    <StatusBadge name={a.statusName} kind={a.statusKind} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-[13px] text-ink-3">{t('car.nothingScheduled')}</p>
          )}
        </Panel>
        <Panel title={t('car.skillGaps')} padded={false} actions={<Link to="/career/skills" className="text-[12.5px] text-accent">{t('common.open')}</Link>}>
          {o.skillGaps.length ? (
            <ul className="divide-y divide-line">
              {o.skillGaps.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                  <LevelDots level={s.level} target={s.targetLevel} />
                  <Badge tone="warn">+{s.gap}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-[13px] text-ink-3">{o.skillCount ? t('car.noGaps') : t('car.skillsEmptyBody')}</p>
          )}
        </Panel>
        <Panel
          title={t('car.learningNow')}
          padded={false}
          actions={
            <span className="flex items-center gap-2">
              {o.learningOverdue > 0 && <Badge tone="neg">{t('car.nOverdue', { n: o.learningOverdue })}</Badge>}
              <Link to="/career/learning" className="text-[12.5px] text-accent">
                {t('common.open')}
              </Link>
            </span>
          }
        >
          {o.learning.length ? (
            <ul className="divide-y divide-line">
              {o.learning.map((l) => (
                <li key={l.id}>
                  <Link to={`/career/learning?open=${l.id}`} className="block px-4 py-2.5 hover:bg-surface-2/60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{l.title}</span>
                      <span className="num shrink-0 text-[12px] text-ink-3">{fmt.percent(l.progress / 100)}</span>
                    </div>
                    <div className="mt-1.5">
                      <Bar ratio={l.progress / 100} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-[13px] text-ink-3">{t('car.notLearning')}</p>
          )}
        </Panel>
        <Panel title={t('car.recentAchievements')} padded={false} actions={<Link to="/career/achievements" className="text-[12.5px] text-accent">{t('common.open')}</Link>}>
          {o.recentAchievements.length ? (
            <ul className="divide-y divide-line">
              {o.recentAchievements.map((a) => (
                <li key={a.id}>
                  <Link to={`/career/achievements?open=${a.id}`} className="block px-4 py-2.5 hover:bg-surface-2/60">
                    <p className="truncate font-medium">{a.title}</p>
                    <p className="truncate text-[12px] text-ink-3">
                      {fmt.date(a.date)}
                      {a.metric && ` · ${a.metric}`}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-[13px] text-ink-3">{t('car.achEmptyBody')}</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
