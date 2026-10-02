import type { FastifyPluginAsync } from 'fastify';
// Importing a module registers its entity types (for links, tags, search) and its jobs.
import './workspaces/service';
import './documents/service';
import '../jobs/core-jobs';

/** Route plugins of feature modules (finance, tasks, CRM, …). */
export const moduleRoutes: FastifyPluginAsync[] = [];
