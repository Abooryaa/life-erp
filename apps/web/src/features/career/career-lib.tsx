import type { ApplicationStatusKind } from '@life-erp/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { Badge, type Tone } from '../../components/ui/feedback';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';

export interface AppStatus {
  id: string;
  name: string;
  kind: ApplicationStatusKind;
  sortOrder: number;
}

export interface Interview {
  id: string;
  applicationId: string;
  stage: string;
  date: string;
  time: string | null;
  mode: 'onsite' | 'video' | 'phone';
  location: string | null;
  interviewer: string | null;
  outcome: 'pending' | 'passed' | 'failed' | 'cancelled';
  notes: string | null;
}

export interface Application {
  id: string;
  company: string;
  organizationId: string | null;
  position: string;
  statusId: string;
  statusName: string;
  statusKind: ApplicationStatusKind;
  source: string | null;
  url: string | null;
  location: string | null;
  workMode: 'onsite' | 'hybrid' | 'remote' | null;
  appliedDate: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  recruiterPersonId: string | null;
  followUpDate: string | null;
  cvVersion: string | null;
  jobDescription: string | null;
  outcome: string | null;
  priority: number;
  closedAt: string | null;
  notes: string | null;
  interviewCount: number;
  nextInterview: Interview | null;
  tags: string[];
  interviews?: Interview[];
}

export interface Employment {
  id: string;
  company: string;
  organizationId: string | null;
  position: string;
  department: string | null;
  employmentType: string;
  startDate: string;
  endDate: string | null;
  salary: number | null;
  currency: string;
  salaryPeriod: string;
  benefits: string | null;
  location: string | null;
  workSchedule: string | null;
  managerName: string | null;
  managerPersonId: string | null;
  responsibilities: string | null;
  notes: string | null;
  current: boolean;
  months: number;
  tags?: string[];
  achievements?: Achievement[];
}

export interface Skill {
  id: string;
  name: string;
  category: string;
  level: number;
  targetLevel: number | null;
  lastUsed: string | null;
  evidence: string | null;
  goalId: string | null;
  notes: string | null;
  achievementCount: number;
  gap: number;
}

export interface Achievement {
  id: string;
  date: string;
  employmentId: string | null;
  company: string | null;
  role: string | null;
  title: string;
  description: string | null;
  metric: string | null;
  impact: string | null;
  cvRelevance: number;
  cvBullet: string | null;
  bullet: string;
  skills: { id: string; name: string }[];
}

export interface Learning {
  id: string;
  title: string;
  type: string;
  provider: string | null;
  url: string | null;
  skillId: string | null;
  skillName: string | null;
  goalId: string | null;
  status: 'planned' | 'in_progress' | 'paused' | 'completed' | 'dropped';
  startDate: string | null;
  deadline: string | null;
  progress: number;
  completedAt: string | null;
  cost: number | null;
  currency: string;
  notes: string | null;
}

export const CAREER_KEYS = [['career'], ['calendar'], ['today'], ['tasks'], ['notifications'], ['audit']];

export function useStatuses() {
  return useQuery({ queryKey: ['career', 'statuses'], queryFn: () => api.get<AppStatus[]>('/api/career/statuses'), staleTime: 60_000 });
}
export function useSkills() {
  return useQuery({ queryKey: ['career', 'skills'], queryFn: () => api.get<Skill[]>('/api/career/skills') });
}
export function useJobs() {
  return useQuery({ queryKey: ['career', 'jobs'], queryFn: () => api.get<Employment[]>('/api/career/jobs') });
}

const KIND_TONE: Record<ApplicationStatusKind, Tone> = { saved: 'neutral', active: 'accent', interview: 'info', offer: 'warn', accepted: 'pos', rejected: 'neg', withdrawn: 'neutral' };

export function StatusBadge({ name, kind }: { name: string; kind: ApplicationStatusKind }) {
  return <Badge tone={KIND_TONE[kind]}>{name}</Badge>;
}

/** 0–5 dots for a skill level, with the target shown as an outline. */
export function LevelDots({ level, target }: { level: number; target?: number | null }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={t('car.levelOf', { level, max: 5 })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={
            i <= level ? 'size-2.5 rounded-full bg-accent' : target != null && i <= target ? 'size-2.5 rounded-full border border-accent' : 'size-2.5 rounded-full bg-surface-3'
          }
        />
      ))}
    </span>
  );
}

export function useTenure() {
  const { t } = useI18n();
  return (months: number) => {
    const y = Math.floor(months / 12);
    const m = months % 12;
    if (!y) return t('car.months', { n: m });
    return m ? t('car.yearsMonths', { y, m }) : t('car.years', { n: y });
  };
}

export const optLabel = (t: (k: MessageKey) => string, prefix: string, v: string) => t(`${prefix}.${v}` as MessageKey);

/** `?open=<id>` deep links (from search, notifications, calendar) open the item's editor once. */
export function useOpenParam(onOpen: (id: string) => void) {
  const [params, setParams] = useSearchParams();
  const open = params.get('open');
  useEffect(() => {
    if (!open) return;
    onOpen(open);
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete('open');
        return n;
      },
      { replace: true },
    );
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}
