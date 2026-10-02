import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Badge, type Tone } from '../../components/ui/feedback';
import { Select } from '../../components/ui/form';
import { useI18n, type MessageKey } from '../../i18n';
import { api } from '../../lib/api';
import { useWorkspace } from '../../lib/workspace';

export interface Organization {
  id: string;
  name: string;
  type: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  instagram: string | null;
  notes: string | null;
  peopleCount?: number;
  opportunityCount?: number;
  projectCount?: number;
  tags: string[];
}

export interface Stage {
  id: string;
  name: string;
  probability: number;
  kind: 'open' | 'won' | 'lost';
  color: string | null;
  sortOrder: number;
}

export interface Pipeline {
  id: string;
  workspaceId: string;
  name: string;
  stages: Stage[];
}

export interface Opportunity {
  id: string;
  title: string;
  workspaceId: string;
  pipelineId: string;
  stageId: string;
  stageName: string;
  kind: 'open' | 'won' | 'lost';
  personId: string | null;
  organizationId: string | null;
  personName: string | null;
  organizationName: string | null;
  value: number;
  currency: string;
  probability: number | null;
  effectiveProbability: number;
  expectedClose: string | null;
  owner: string | null;
  source: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  closedAt: string | null;
  lostReason: string | null;
  notes: string | null;
  tags: string[];
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  workspaceId: string | null;
  personId: string | null;
  organizationId: string | null;
  opportunityId: string | null;
  goalId: string | null;
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  priority: number;
  owner: string | null;
  startDate: string | null;
  deadline: string | null;
  currency: string;
  budget: number | null;
  contractValue: number | null;
  color: string | null;
  progress: number | null;
  milestonesDone: number;
  milestonesTotal: number;
  tasksDone: number;
  tasksTotal: number;
  revenue: number;
  spent: number;
  profit: number;
  budgetRemaining: number | null;
  health: 'on_track' | 'at_risk' | 'delayed' | 'over_budget' | 'done' | 'not_started';
  timeElapsed: number | null;
  budgetUsed: number | null;
  missingRates: string[];
  clientName: string | null;
  tags: string[];
  milestones?: { id: string; title: string; dueDate: string | null; done: boolean; amount: number | null }[];
}

export interface Relation {
  id: string;
  workspaceId: string;
  personId: string | null;
  organizationId: string | null;
  role: string;
  status: string;
  name: string;
  phone: string | null;
  kind: 'person' | 'organization';
}

export const BIZ_KEYS = [['opportunities'], ['projects'], ['organizations'], ['relations'], ['business'], ['pipelines'], ['calendar'], ['today'], ['notifications'], ['audit']];

export function useOrganizations() {
  return useQuery({ queryKey: ['organizations', 'all'], queryFn: () => api.get<Organization[]>('/api/organizations'), staleTime: 30_000 });
}

export function useProjects(status = 'open') {
  return useQuery({ queryKey: ['projects', 'all', status], queryFn: () => api.get<Project[]>(`/api/projects?status=${status}`), staleTime: 30_000 });
}

const PROJECT_TONE: Record<Project['health'], Tone> = { on_track: 'pos', at_risk: 'warn', delayed: 'neg', over_budget: 'neg', done: 'neutral', not_started: 'neutral' };

export function ProjectHealthBadge({ health }: { health: Project['health'] }) {
  const { t } = useI18n();
  return <Badge tone={PROJECT_TONE[health]}>{t(`prj.health.${health}` as MessageKey)}</Badge>;
}

/**
 * The business whose pipeline/projects are shown: the selected workspace when it's a business,
 * otherwise the first business (switchable).
 */
export function useBusinessChoice() {
  const { current, workspaces } = useWorkspace();
  const businesses = workspaces.filter((w) => w.kind === 'business');
  const [chosen, setChosen] = useState<string>(current?.kind === 'business' ? current.id : (businesses[0]?.id ?? ''));
  useEffect(() => {
    if (current?.kind === 'business') setChosen(current.id);
    else if (!chosen && businesses[0]) setChosen(businesses[0].id);
  }, [current?.id, businesses.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return { businessId: chosen, setBusinessId: setChosen, businesses };
}

export function BusinessSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useI18n();
  const { workspaces } = useWorkspace();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('common.workspace')} className="w-48">
      {workspaces
        .filter((w) => w.kind === 'business')
        .map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
    </Select>
  );
}
