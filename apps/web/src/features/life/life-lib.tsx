import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Flag, Repeat, User } from 'lucide-react';
import { Dot } from '../../components/ui/feedback';
import { useToast } from '../../components/ui/feedback';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useWorkspace } from '../../lib/workspace';
import { TagList } from '../shared/TagEditor';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: 'inbox' | 'planned' | 'in_progress' | 'waiting' | 'done' | 'cancelled';
  priority: number;
  area: string | null;
  dueDate: string | null;
  dueTime: string | null;
  startDate: string | null;
  completedAt: string | null;
  workspaceId: string | null;
  projectId: string | null;
  goalId: string | null;
  personId: string | null;
  assignee: string | null;
  recurrence: string | null;
  recurrenceInterval: number;
  tags: string[];
  nextTaskId?: string | null;
}

export interface Person {
  id: string;
  fullName: string;
  nickname: string | null;
  relationship: string;
  company: string | null;
  role: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  city: string | null;
  birthday: string | null;
  linkedin: string | null;
  instagram: string | null;
  website: string | null;
  source: string | null;
  workspaceId: string | null;
  nextFollowUp: string | null;
  followUpNote: string | null;
  notes: string | null;
  lastContact: string | null;
  tags: string[];
  interactions?: { id: string; kind: string; date: string; summary: string }[];
}

export interface Goal {
  id: string;
  parentId: string | null;
  level: 'vision' | 'long_term' | 'objective' | 'milestone';
  title: string;
  description: string | null;
  area: string | null;
  metric: 'none' | 'numeric' | 'tasks' | 'children' | 'savings';
  startValue: number;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  savingsGoalId: string | null;
  startDate: string | null;
  deadline: string | null;
  priority: number;
  status: 'active' | 'achieved' | 'paused' | 'dropped';
  workspaceId: string | null;
  color: string | null;
  progress: number | null;
  health: 'achieved' | 'on_track' | 'at_risk' | 'behind' | 'no_deadline' | 'overdue' | null;
  value: number | null;
  tasksDone: number;
  tasksTotal: number;
  childCount: number;
}

export const LIFE_KEYS = [['tasks'], ['today'], ['calendar'], ['goals'], ['notifications'], ['audit'], ['people']];

export function usePeople() {
  return useQuery({ queryKey: ['people', 'all'], queryFn: () => api.get<Person[]>('/api/people'), staleTime: 30_000 });
}

export function useGoals() {
  return useQuery({ queryKey: ['goals', 'all'], queryFn: () => api.get<Goal[]>('/api/goals'), staleTime: 30_000 });
}

const PRIORITY_TONE: Record<number, string> = { 1: 'text-neg', 2: 'text-warn', 3: 'text-ink-3', 4: 'text-ink-3/60' };

export function PriorityFlag({ priority }: { priority: number }) {
  const { t } = useI18n();
  if (priority >= 3) return null;
  return <Flag className={clsx('size-3.5 shrink-0', PRIORITY_TONE[priority])} aria-label={t(`task.priority.${priority}` as MessageKey)} />;
}

export function useDueLabel() {
  const { t, fmt } = useI18n();
  return (date: string | null, time?: string | null) => {
    if (!date) return null;
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000);
    const label = diff === 0 ? t('common.today') : diff === 1 ? fmt.weekday(date, 'short') : diff > 1 && diff < 7 ? fmt.weekday(date, 'short') : fmt.date(date);
    return { text: time ? `${label} ${time}` : label, overdue: diff < 0, today: diff === 0 };
  };
}

/** One task line with a big tap target to complete it. */
export function TaskRow({ task, onOpen, showWorkspace = true }: { task: Task; onOpen: (t: Task) => void; showWorkspace?: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const due = useDueLabel()(task.dueDate, task.dueTime);
  const { byId } = useWorkspace();
  const ws = byId(task.workspaceId);
  const done = task.status === 'done';
  const toggle = async () => {
    try {
      const r = await api.post<Task>(`/api/tasks/${task.id}/status`, { status: done ? 'planned' : 'done' });
      await Promise.all(LIFE_KEYS.map((k) => qc.invalidateQueries({ queryKey: k })));
      if (r.nextTaskId) {
        const next = await api.get<Task>(`/api/tasks/${r.nextTaskId}`);
        toast.success(t('task.nextCreated', { date: next.dueDate ?? '' }));
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  return (
    <li className="group flex items-start gap-3 px-4 py-2.5 hover:bg-surface-2">
      <button
        onClick={toggle}
        className={clsx(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          done ? 'border-pos bg-pos text-white' : task.priority === 1 ? 'border-neg' : task.priority === 2 ? 'border-warn' : 'border-line-strong hover:border-accent',
        )}
        aria-label={done ? t('task.reopen') : t('task.complete')}
      >
        {done && <Check className="size-3" strokeWidth={3} />}
      </button>
      <button onClick={() => onOpen(task)} className="min-w-0 flex-1 text-start">
        <p className={clsx('flex items-center gap-1.5', done && 'text-ink-3 line-through')}>
          <PriorityFlag priority={task.priority} />
          <span className="truncate">{task.title}</span>
          {task.recurrence && <Repeat className="size-3 shrink-0 text-ink-3" />}
          {task.personId && <User className="size-3 shrink-0 text-ink-3" />}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-3">
          {due && <span className={clsx(due.overdue && !done && 'font-medium text-neg', due.today && !done && 'font-medium text-accent')}>{due.text}</span>}
          {task.status === 'waiting' && <span className="text-warn">{t('task.status.waiting')}</span>}
          {task.status === 'in_progress' && <span className="text-info">{t('task.status.in_progress')}</span>}
          {showWorkspace && ws && (
            <span className="inline-flex items-center gap-1">
              <Dot color={ws.color} />
              {ws.name}
            </span>
          )}
          <TagList tags={task.tags} />
        </p>
      </button>
    </li>
  );
}
