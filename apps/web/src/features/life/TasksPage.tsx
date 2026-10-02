import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CheckSquare, Columns3, List, Plus } from 'lucide-react';
import { useEffect, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorBlock, LoadingBlock, useToast } from '../../components/ui/feedback';
import { Input } from '../../components/ui/form';
import { PageHeader } from '../../components/ui/layout';
import { useI18n, type MessageKey } from '../../i18n';
import { api, qs } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { postOrQueue } from '../../lib/outbox';
import { useWorkspace } from '../../lib/workspace';
import { useUI } from '../../layout/ui-context';
import { LIFE_KEYS, TaskRow, type Task } from './life-lib';

const VIEWS = ['inbox', 'today', 'upcoming', 'anytime', 'waiting', 'done'] as const;
type View = (typeof VIEWS)[number] | 'overdue' | 'open';

interface Counts {
  inbox: number;
  today: number;
  overdue: number;
  upcoming: number;
  waiting: number;
  open: number;
}

export function useTaskCounts() {
  const { currentId } = useWorkspace();
  return useQuery({ queryKey: ['tasks', 'counts', currentId], queryFn: () => api.get<Counts>(`/api/tasks/counts${qs({ workspaceId: currentId })}`), refetchInterval: 120_000 });
}

/** Single-line task capture used on the Tasks and Today screens. */
export function TaskQuickAdd({ placeholder, defaultDue }: { placeholder: string; defaultDue?: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { currentId } = useWorkspace();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        try {
          const full = defaultDue && !/\b(today|tomorrow|tmr|بكرة|اليوم)\b/i.test(text) && !/\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2}/.test(text) ? `${text} ${defaultDue}` : text;
          const r = await postOrQueue('/api/tasks/quick', { text: full, workspaceId: currentId }, text);
          if (r.queued) toast.info(t('outbox.queued'));
          else await Promise.all(LIFE_KEYS.map((k) => qc.invalidateQueries({ queryKey: k })));
          setText('');
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <Button type="submit" variant="primary" size="icon" loading={busy} aria-label={t('common.add')}>
        {!busy && <Plus className="size-4" />}
      </Button>
    </form>
  );
}

export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const BOARD_COLUMNS: Task['status'][] =['inbox', 'planned', 'in_progress', 'waiting', 'done'];

function Board({ tasks, onOpen }: { tasks: Task[]; onOpen: (t: Task) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [over, setOver] = useState<string | null>(null);
  const move = async (id: string, status: Task['status']) => {
    try {
      await api.post(`/api/tasks/${id}/status`, { status });
      await Promise.all(LIFE_KEYS.map((k) => qc.invalidateQueries({ queryKey: k })));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  return (
    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-thin md:mx-0 md:px-0">
      {BOARD_COLUMNS.map((col) => {
        const items = tasks.filter((x) => x.status === col);
        return (
          <section
            key={col}
            onDragOver={(e: DragEvent) => {
              e.preventDefault();
              setOver(col);
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData('text/task');
              if (id) void move(id, col);
            }}
            className={clsx('flex w-72 shrink-0 flex-col rounded-card border bg-surface-2/60', over === col ? 'border-accent' : 'border-line')}
          >
            <h3 className="flex items-center justify-between px-3 py-2 text-[12.5px] font-semibold text-ink-2 uppercase">
              {t(`task.status.${col}` as MessageKey)}
              <span className="text-ink-3">{items.length}</span>
            </h3>
            <ul className="flex min-h-24 flex-col gap-2 p-2">
              {items.map((x) => (
                <li
                  key={x.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/task', x.id)}
                  onClick={() => onOpen(x)}
                  className="cursor-pointer rounded-lg border border-line bg-surface p-2.5 text-[13.5px] shadow-card hover:border-line-strong"
                >
                  <p className={clsx(x.status === 'done' && 'text-ink-3 line-through')}>{x.title}</p>
                  {x.dueDate && <p className="mt-1 text-[12px] text-ink-3">{x.dueDate}</p>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function TasksPage() {
  const { t } = useI18n();
  const ui = useUI();
  const { currentId } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View) ?? 'today';
  const [layout, setLayout] = useState<'list' | 'board'>('list');
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const counts = useTaskCounts().data;
  const effectiveView = layout === 'board' ? 'all' : view;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tasks', 'list', effectiveView, currentId, dq],
    queryFn: () => api.get<Task[]>(`/api/tasks${qs({ view: effectiveView, workspaceId: currentId, q: dq })}`),
  });
  const setView = (v: View) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('view', v);
      return n;
    });
  const open = (task: Task) => ui.openTask({ id: task.id });

  // Links from search/notifications use ?open=<taskId>.
  const openParam = params.get('open');
  useEffect(() => {
    if (!openParam) return;
    ui.openTask({ id: openParam });
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete('open');
        return n;
      },
      { replace: true },
    );
  }, [openParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const badge = (v: View) => {
    const n = v === 'today' ? (counts?.today ?? 0) + (counts?.overdue ?? 0) : v === 'inbox' ? counts?.inbox : v === 'waiting' ? counts?.waiting : v === 'upcoming' ? counts?.upcoming : 0;
    return n ? <span className={clsx('num rounded-full px-1.5 text-[11px]', v === 'today' && counts?.overdue ? 'bg-neg text-white' : 'bg-surface-3 text-ink-2')}>{n}</span> : null;
  };

  // Group upcoming tasks by day for readability.
  const groups = view === 'upcoming' && data ? [...data.reduce((m, x) => m.set(x.dueDate ?? '', [...(m.get(x.dueDate ?? '') ?? []), x]), new Map<string, Task[]>())] : null;

  return (
    <div>
      <PageHeader
        title={t('task.title')}
        actions={
          <>
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
              <Button size="icon-sm" variant={layout === 'list' ? 'subtle' : 'ghost'} onClick={() => setLayout('list')} aria-label={t('task.list')} title={t('task.list')}>
                <List className="size-4" />
              </Button>
              <Button size="icon-sm" variant={layout === 'board' ? 'subtle' : 'ghost'} onClick={() => setLayout('board')} aria-label={t('task.board')} title={t('task.board')}>
                <Columns3 className="size-4" />
              </Button>
            </div>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => ui.openTask({ defaults: view === 'today' ? { dueDate: localToday() } : view === 'waiting' ? { status: 'waiting' } : undefined })}>
              {t('task.new')}
            </Button>
          </>
        }
      />
      {layout === 'list' && (
        <div className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 pb-1 scrollbar-thin md:mx-0 md:px-0" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={clsx('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium', view === v ? 'bg-ink text-canvas' : 'bg-surface-2 text-ink-2 hover:bg-surface-3')}
            >
              {t(`task.view.${v}` as MessageKey)}
              {badge(v)}
            </button>
          ))}
        </div>
      )}
      <div className="mb-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_240px]">
        <TaskQuickAdd placeholder={t('task.quickAdd')} defaultDue={view === 'today' ? 'today' : undefined} />
        <Input placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('common.search')} />
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : layout === 'board' ? (
        <Board tasks={data ?? []} onOpen={open} />
      ) : !data?.length ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon={<CheckSquare className="size-5" />} title={t('task.empty')} body={view === 'inbox' ? t('task.emptyInbox') : undefined} />
        </div>
      ) : groups ? (
        <div className="space-y-4">
          {groups.map(([date, items]) => (
            <section key={date} className="rounded-card border border-line bg-surface shadow-card">
              <DayHeader date={date} />
              <ul className="divide-y divide-line">
                {items.map((x) => (
                  <TaskRow key={x.id} task={x} onOpen={open} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface shadow-card">
          {data.map((x) => (
            <TaskRow key={x.id} task={x} onOpen={open} />
          ))}
        </ul>
      )}
    </div>
  );
}

function DayHeader({ date }: { date: string }) {
  const { fmt } = useI18n();
  return <h3 className="border-b border-line px-4 py-2 text-[12.5px] font-semibold text-ink-2">{date ? `${fmt.weekday(date)} · ${fmt.date(date)}` : '—'}</h3>;
}
