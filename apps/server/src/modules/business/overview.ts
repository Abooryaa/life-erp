import { addDays, monthsBetween } from '@life-erp/shared';
import { categoryBreakdown, monthlySeries } from '../finance/reports';
import { today } from '../life/common';
import { listTasks } from '../life/tasks';
import { getWorkspace } from '../workspaces/service';
import { listRelations } from './organizations';
import { opportunitiesNeedingAction, pipelineAnalytics } from './pipeline';
import { listProjects } from './projects';

/** Everything a business home page needs: P&L, pipeline, projects, contacts, open tasks. */
export function businessOverview(workspaceId: string) {
  const ws = getWorkspace(workspaceId);
  const d = today();
  const month = d.slice(0, 7);
  const yearStart = `${d.slice(0, 4)}-01`;
  const monthsYtd = monthsBetween(yearStart, month) + 1;
  const series = monthlySeries(month, Math.max(12, monthsYtd), { workspaceId });
  const ytd = series.months.filter((m) => m.month >= yearStart);
  const sum = (k: 'income' | 'expenses' | 'net') => ytd.reduce((s, m) => s + m[k], 0);
  const current = series.months[series.months.length - 1];
  const relations = listRelations({ workspaceId });
  const roles: Record<string, number> = {};
  for (const r of relations.filter((x) => x.status === 'active')) roles[r.role] = (roles[r.role] ?? 0) + 1;
  const projects = listProjects({ workspaceId, status: 'open' });
  const pipeline = pipelineAnalytics(workspaceId);
  return {
    workspace: ws,
    base: series.base,
    pnl: {
      month: { income: current.income, expenses: current.expenses, profit: current.net },
      ytd: { income: sum('income'), expenses: sum('expenses'), profit: sum('net'), margin: sum('income') > 0 ? sum('net') / sum('income') : null },
      series: series.months.slice(-12),
      costs: categoryBreakdown(`${yearStart}-01`, d, 'expense', { workspaceId }),
    },
    pipeline: { stats: pipeline.stats, byStage: pipeline.byStage, pipelineId: pipeline.pipeline.id },
    nextActions: opportunitiesNeedingAction(addDays(d, 7)).filter((o) => o.workspaceId === workspaceId),
    projects: {
      open: projects,
      delayed: projects.filter((p) => p.health === 'delayed').length,
      atRisk: projects.filter((p) => p.health === 'at_risk' || p.health === 'over_budget').length,
    },
    roles,
    openTasks: listTasks({ view: 'open', workspaceId }).slice(0, 10),
    missingRates: [...new Set([...series.missingRates, ...pipeline.missingRates])],
  };
}
