import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Cake, CalendarDays, CheckCircle2, CreditCard, Inbox, Target, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useWorkspace } from '../../lib/workspace';
import { useUI } from '../../layout/ui-context';
import { Bar, Money } from '../finance/fin-lib';
import { HealthBadge } from './GoalsOkrPage';
import { TaskRow, type Goal, type Person, type Task } from './life-lib';
import { TaskQuickAdd } from './TasksPage';

interface TodayData {
  date: string;
  counts: { inbox: number; today: number; overdue: number; upcoming: number; waiting: number };
  overdue: Task[];
  dueToday: Task[];
  inProgress: Task[];
  events: { id: string; title: string; startTime: string | null; endTime: string | null; allDay: boolean; location: string | null; occurrenceDate: string }[];
  money: { id: string; kind: string; name: string; amount: number; currency: string; direction: 'in' | 'out'; overdue: boolean; link: string; date: string }[];
  followUps: Person[];
  birthdays: { id: string; name: string; date: string; age: number }[];
  focusGoals: Goal[];
  alerts: { id: string; title: string; severity: string; link: string | null }[];
}

/** The "what do I need to do today" screen — the phone's home. */
export function TodayPage() {
  const { t, fmt } = useI18n();
  const ui = useUI();
  const { currentId } = useWorkspace();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['today', currentId],
    queryFn: () => api.get<TodayData>(`/api/today${qs({ workspaceId: currentId })}`),
    refetchInterval: 120_000,
  });
  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock error={error ?? 'No data'} onRetry={refetch} />;
  const openTask = (x: Task) => ui.openTask({ id: x.id });
  const nothing = !data.overdue.length && !data.dueToday.length && !data.events.length && !data.money.length && !data.followUps.length;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <p className="text-[13px] font-medium text-ink-3">{fmt.longDate(`${data.date}`)}</p>
        <h1 className="mt-0.5 text-[24px] font-semibold tracking-tight">{t('today.title')}</h1>
      </div>

      <TaskQuickAdd placeholder={t('today.addTask')} defaultDue="today" />

      {data.counts.inbox > 0 && (
        <Link to="/tasks?view=inbox" className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 shadow-card hover:border-line-strong">
          <Inbox className="size-5 text-accent" />
          <span className="flex-1 font-medium">{t('today.inbox', { n: data.counts.inbox })}</span>
          <span className="text-[13px] text-accent">{t('today.processInbox')}</span>
        </Link>
      )}

      {data.alerts.length > 0 && (
        <Panel title={t('today.alerts')} padded={false}>
          <ul className="divide-y divide-line">
            {data.alerts.slice(0, 5).map((a) => (
              <li key={a.id}>
                <Link to={a.link ?? '/notifications'} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                  <AlertTriangle className={a.severity === 'critical' ? 'size-4 text-neg' : 'size-4 text-warn'} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px]">{a.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          {nothing && (
            <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-5 text-ink-2">
              <CheckCircle2 className="size-6 text-pos" />
              {t('today.allDone')}
            </div>
          )}
          {data.overdue.length > 0 && (
            <Panel title={<span className="text-neg">{t('today.overdue')} · {data.overdue.length}</span>} padded={false}>
              <ul className="divide-y divide-line">
                {data.overdue.map((x) => (
                  <TaskRow key={x.id} task={x} onOpen={openTask} />
                ))}
              </ul>
            </Panel>
          )}
          {data.dueToday.length > 0 && (
            <Panel title={`${t('today.dueToday')} · ${data.dueToday.length}`} padded={false}>
              <ul className="divide-y divide-line">
                {data.dueToday.map((x) => (
                  <TaskRow key={x.id} task={x} onOpen={openTask} />
                ))}
              </ul>
            </Panel>
          )}
          {data.inProgress.length > 0 && (
            <Panel title={t('today.inProgress')} padded={false}>
              <ul className="divide-y divide-line">
                {data.inProgress.map((x) => (
                  <TaskRow key={x.id} task={x} onOpen={openTask} />
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-5">
          <Panel title={t('today.events')} padded={false} actions={<Link to="/calendar" className="text-[13px] font-medium text-accent hover:underline">{t('nav.calendar')}</Link>}>
            {data.events.length === 0 ? (
              <p className="flex items-center gap-2 p-4 text-[13px] text-ink-3">
                <CalendarDays className="size-4" />
                {t('today.noEvents')}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {data.events.map((e) => (
                  <li key={`${e.id}:${e.occurrenceDate}`}>
                    <button onClick={() => ui.openEvent({ id: e.id })} className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-2">
                      <span className="num w-14 shrink-0 text-[13px] font-medium text-accent">{e.allDay ? t('cal.allDay') : e.startTime}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{e.title}</span>
                        {e.location && <span className="block truncate text-[12px] text-ink-3">{e.location}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {data.money.length > 0 && (
            <Panel title={t('today.money')} padded={false}>
              <ul className="divide-y divide-line">
                {data.money.map((m) => (
                  <li key={`${m.kind}:${m.id}`}>
                    <Link to={m.link} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                      <CreditCard className="size-4 shrink-0 text-warn" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">{m.name}</span>
                      {m.overdue && <Badge tone="neg">{t('fin.overdue')}</Badge>}
                      <Money minor={m.direction === 'in' ? m.amount : -m.amount} currency={m.currency} colored />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {data.followUps.length > 0 && (
            <Panel title={t('today.followUps')} padded={false}>
              <ul className="divide-y divide-line">
                {data.followUps.map((p) => (
                  <li key={p.id}>
                    <Link to={`/people/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                      <UserRound className="size-4 shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.fullName}</span>
                        {p.followUpNote && <span className="block truncate text-[12px] text-ink-3">{p.followUpNote}</span>}
                      </span>
                      <span className="num text-[12px] text-warn">{p.nextFollowUp && fmt.date(p.nextFollowUp)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {data.focusGoals.length > 0 && (
            <Panel title={t('today.focus')} padded={false}>
              <ul className="divide-y divide-line">
                {data.focusGoals.map((g) => (
                  <li key={g.id}>
                    <Link to={`/goals/${g.id}`} className="block px-4 py-2.5 hover:bg-surface-2">
                      <p className="flex items-center gap-2">
                        <Target className="size-4 shrink-0 text-ink-3" />
                        <span className="min-w-0 flex-1 truncate font-medium">{g.title}</span>
                        <HealthBadge goal={g} />
                      </p>
                      {g.progress != null && (
                        <div className="mt-1.5">
                          <Bar ratio={g.progress} tone={g.health === 'behind' || g.health === 'overdue' ? 'neg' : 'warn'} />
                        </div>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {data.birthdays.length > 0 && (
            <Panel title={t('today.birthdays')} padded={false}>
              <ul className="divide-y divide-line">
                {data.birthdays.map((b) => (
                  <li key={b.id}>
                    <Link to={`/people/${b.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                      <Cake className="size-4 text-info" />
                      <span className="flex-1">{b.name}</span>
                      <span className="text-[12.5px] text-ink-3">{fmt.date(b.date)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
