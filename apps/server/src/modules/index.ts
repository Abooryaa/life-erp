import type { FastifyPluginAsync } from 'fastify';
// Importing a module registers its entity types (for links, tags, search) and its jobs.
import './workspaces/service';
import './documents/service';
import './finance/accounts';
import './finance/transactions';
import './finance/installments';
import './finance/debts';
import './finance/budgets';
import './finance/goals';
import './finance/jobs';
import '../jobs/core-jobs';
import { financeRoutes } from './finance/routes';

/** Route plugins of feature modules (finance, tasks, CRM, …). */
export const moduleRoutes: FastifyPluginAsync[] = [financeRoutes];
