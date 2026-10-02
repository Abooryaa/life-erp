import { addDays, addMonthsToMonth, monthEnd } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Cake, CalendarDays, CheckSquare, ChevronLeft, ChevronRight, CreditCard, FolderKanban, Plus, Target } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { ErrorBlock, LoadingBlock } from '../../components/ui/feedback';
import { PageHeader, Panel } from '../../components/ui/layout';
import { useI18n } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useMediaQuery, useSettings } from '../../lib/hooks';
import { useWorkspace } from '../../lib/workspace';
import { useUI } from '../../layout/ui-context';
import { Money } from '../finance/fin-lib';
import { localToday } from './TasksPage';

export interface CalItem {
  kind: 'event' | 'task' | 'payment' | 'goal' | 'birthday' | 'followup' | 'project';
  id: string;
  title: string;
  date: string;
  endDate?: string;
  time?: string | null;
  endTime?: string | null;
  allDay: boolean;
  done?: boolean;
  link: string;
  meta?: { eventId?: string; amount?: number; currency?: string; direction?: string; overdue?: boolean; age?: number; location?: string | null };
}

const KIND_STYLE: Record<CalItem['kind'], string> = {
  event: 'bg-accent-soft text-accent',
  task: 'bg-surface-2 text-ink-2',
  payment: 'bg-warn-soft text-warn',
  goal: 'bg-pos-soft text-pos',
  birthday: 'bg-info-soft text-info',
  followup: 'bg-surface-2 text-ink-2',
  project: 'bg-neg-soft text-neg',
};
const KIND_ICON = { event: CalendarDays, task: CheckSquare, payment: CreditCard, goal: Target, birthday: Cake, followup: CheckSquare, project: FolderKanban };

function itemsOn(items: CalItem[], date: string) {
  return items.filter((i) => i.date === date || (i.endDate && i.date < date && i.endDate >= date));
}

/** Open an item: events/tasks in their editor, everything else on its own page. */
function useOpenItem() {
  const ui = useUI();
  const navigate = useNavigate();
  return (i: CalItem) => {
    if (i.kind === 'event' && i.meta?.eventId) ui.openEvent({ id: i.meta.eventId });
    else if (i.kind === 'task') ui.openTask({ id: i.id });
    else navigate(i.link);
  };
}

function ItemChip({ item, compact }: { item: CalItem; compact?: boolean }) {
  const open = useOpenItem();
  const Icon = KIND_ICON[item.kind];
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        open(item);
      }}
      className={clsx('flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-start text-[11.5px] font-medium', KIND_STYLE[item.kind], item.done && 'line-through opacity-60')}
      title={item.title}
    >
      {!compact && <Icon className="size-3 shrink-0" />}
      {item.time && <span className="num shrink-0 opacity-80">{item.time}</span>}
      <span className="truncate">{item.title}</span>
    </button>
  );
}

function AgendaRow({ item }: { item: CalItem }) {
  const { t } = useI18n();
  const open = useOpenItem();
  const Icon = KIND_ICON[item.kind];
  return (
    <li>
      <button onClick={() => open(item)} className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-2">
        <span className={clsx('flex size-8 shrink-0 items-center justify-center rounded-lg', KIND_STYLE[item.kind])}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={clsx('truncate font-medium', item.done && 'text-ink-3 line-through')}>{item.title}</p>
          <p className="text-[12.5px] text-ink-3">
            {item.allDay ? t('cal.allDay') : `${item.time ?? ''}${item.endTime ? ` – ${item.endTime}` : ''}`}
            {item.meta?.location ? ` · ${item.meta.location}` : ''}
            {item.kind === 'birthday' && item.meta?.age ? ` · ${item.meta.age}` : ''}
          </p>
        </div>
        {item.kind === 'payment' && item.meta?.amount != null && (
          <Money minor={item.meta.direction === 'in' ? item.meta.amount : -item.meta.amount} currency={item.meta.currency} colored />
        )}
      </button>
    </li>
  );
}

export function CalendarPage() {
  const { t, fmt, locale } = useI18n();
  const ui = useUI();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const weekStart = useSettings().data?.weekStart ?? 6;
  const { currentId } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState(params.get('date') ?? localToday());
  const [month, setMonth] = useState(selected.slice(0, 7));

  // Deep links (?open=<eventId>) from search and notifications.
  const openParam = params.get('open');
  useEffect(() => {
    if (!openParam) return;
    ui.openEvent({ id: openParam });
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete('open');
      return n;
    }, { replace: true });
  }, [openParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // Grid: whole weeks covering the month.
  const grid = useMemo(() => {
    const first = `${month}-01`;
    const dow = new Date(`${first}T12:00:00Z`).getUTCDay();
    const start = addDays(first, -((dow - weekStart + 7) % 7));
    const end = monthEnd(month);
    const days: string[] = [];
    for (let d = start; d <= end || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d);
    return days;
  }, [month, weekStart]);
  const from = grid[0];
  const to = grid[grid.length - 1];
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['calendar', from, to, currentId],
    queryFn: () => api.get<CalItem[]>(`/api/calendar${qs({ from, to, workspaceId: currentId })}`),
  });
  const today = localToday();
  const selectedItems = itemsOn(data, selected);
  const monthLabel = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`));

  return (
    <div>
      <PageHeader
        title={t('cal.title')}
        actions={
          <>
            <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5">
              <Button size="icon-sm" variant="ghost" onClick={() => setMonth(addMonthsToMonth(month, -1))} aria-label={t('fin.prevMonth')}>
                <ChevronLeft className="size-4 rtl:rotate-180" />
              </Button>
              <span className="min-w-32 text-center text-[13.5px] font-medium">{monthLabel}</span>
              <Button size="icon-sm" variant="ghost" onClick={() => setMonth(addMonthsToMonth(month, 1))} aria-label={t('fin.nextMonth')}>
                <ChevronRight className="size-4 rtl:rotate-180" />
              </Button>
            </div>
            <Button
              onClick={() => {
                setMonth(today.slice(0, 7));
                setSelected(today);
              }}
            >
              {t('cal.today')}
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => ui.openEvent({ date: selected })}>
              {t('cal.newEvent')}
            </Button>
          </>
        }
      />
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <div className="grid grid-cols-7 border-b border-line bg-surface-2 text-center text-[11.5px] font-semibold text-ink-3 uppercase">
              {grid.slice(0, 7).map((d) => (
                <div key={d} className="py-2">
                  {fmt.weekday(d, 'short')}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {grid.map((d) => {
                const items = itemsOn(data, d);
                const inMonth = d.startsWith(month);
                const max = isDesktop ? 3 : 0;
                return (
                  <div
                    key={d}
                    role="button"
                    tabIndex={0}
                    aria-label={fmt.date(d)}
                    aria-pressed={selected === d}
                    onClick={() => setSelected(d)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(d)}
                    className={clsx(
                      'cursor-pointer',
                      'flex min-h-14 flex-col gap-0.5 border-e border-b border-line p-1 text-start align-top md:min-h-28',
                      !inMonth && 'bg-surface-2/50 text-ink-3',
                      selected === d && 'ring-2 ring-accent ring-inset',
                    )}
                  >
                    <span className={clsx('num flex size-6 items-center justify-center self-center rounded-full text-[12.5px] md:self-start', d === today && 'bg-accent font-semibold text-accent-ink')}>
                      {Number(d.slice(8))}
                    </span>
                    {isDesktop ? (
                      <>
                        {items.slice(0, max).map((i) => (
                          <ItemChip key={`${i.kind}:${i.id}`} item={i} />
                        ))}
                        {items.length > max && <span className="px-1 text-[11px] text-ink-3">{t('cal.more', { n: items.length - max })}</span>}
                      </>
                    ) : (
                      items.length > 0 && (
                        <span className="flex justify-center gap-0.5">
                          {items.slice(0, 3).map((i) => (
                            <span key={`${i.kind}:${i.id}`} className={clsx('size-1.5 rounded-full', i.kind === 'event' ? 'bg-accent' : i.kind === 'payment' ? 'bg-warn' : i.kind === 'birthday' ? 'bg-info' : 'bg-ink-3')} />
                          ))}
                        </span>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <Panel
            title={`${fmt.weekday(selected)} · ${fmt.date(selected)}`}
            padded={false}
            actions={
              <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => ui.openEvent({ date: selected })}>
                {t('quick.event')}
              </Button>
            }
          >
            {selectedItems.length === 0 ? (
              <p className="p-4 text-[13.5px] text-ink-3">{t('cal.nothing')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {selectedItems.map((i) => (
                  <AgendaRow key={`${i.kind}:${i.id}`} item={i} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
