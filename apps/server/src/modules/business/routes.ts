import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf, type Q } from '../../http';
import { badRequest } from '../../lib/errors';
import { parse } from '../../lib/validate';
import {
  addRelation,
  createOrganization,
  deleteOrganization,
  getOrganization,
  listOrganizations,
  listRelations,
  removeRelation,
  updateOrganization,
  updateRelation,
} from './organizations';
import { businessOverview } from './overview';
import {
  createOpportunity,
  createPipeline,
  deleteOpportunity,
  getOpportunity,
  listOpportunities,
  listPipelines,
  moveOpportunity,
  pipelineAnalytics,
  updateOpportunity,
  updatePipeline,
} from './pipeline';
import {
  addMilestone,
  createProject,
  deleteMilestone,
  deleteProject,
  getProject,
  listProjects,
  projectFromOpportunity,
  updateMilestone,
  updateProject,
} from './projects';

type Id = { Params: { id: string } };

export async function businessRoutes(app: FastifyInstance) {
  app.get<Id>('/api/business/:id/overview', async (req) => businessOverview(req.params.id));

  // ---------- organizations ----------
  app.get<{ Querystring: Q }>('/api/organizations', async (req) => listOrganizations({ q: req.query.q, type: req.query.type }));
  app.get<Id>('/api/organizations/:id', async (req) => getOrganization(req.params.id));
  app.post('/api/organizations', async (req) => createOrganization(ctxOf(req), req.body as never));
  app.put<Id>('/api/organizations/:id', async (req) => updateOrganization(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/organizations/:id', async (req) => {
    deleteOrganization(ctxOf(req), req.params.id);
    return { ok: true };
  });

  // ---------- relations (client/supplier/… per business) ----------
  app.get<{ Querystring: Q }>('/api/relations', async (req) =>
    listRelations({ workspaceId: req.query.workspaceId, role: req.query.role, personId: req.query.personId, organizationId: req.query.organizationId }),
  );
  app.post('/api/relations', async (req) => addRelation(ctxOf(req), req.body as never));
  app.put<Id>('/api/relations/:id', async (req) => {
    updateRelation(ctxOf(req), req.params.id, req.body as never);
    return { ok: true };
  });
  app.delete<Id>('/api/relations/:id', async (req) => {
    removeRelation(ctxOf(req), req.params.id);
    return { ok: true };
  });

  // ---------- pipelines ----------
  app.get<{ Querystring: Q }>('/api/pipelines', async (req) => {
    if (!req.query.workspaceId) throw badRequest('workspaceId is required');
    return listPipelines(req.query.workspaceId);
  });
  app.post('/api/pipelines', async (req) => createPipeline(ctxOf(req), req.body as never));
  app.put<Id>('/api/pipelines/:id', async (req) => updatePipeline(ctxOf(req), req.params.id, req.body as never));
  app.get<{ Querystring: Q }>('/api/pipelines/analytics', async (req) => {
    if (!req.query.workspaceId) throw badRequest('workspaceId is required');
    return pipelineAnalytics(req.query.workspaceId, req.query.pipelineId);
  });

  // ---------- opportunities ----------
  app.get<{ Querystring: Q }>('/api/opportunities', async (req) =>
    listOpportunities({
      workspaceId: req.query.workspaceId,
      pipelineId: req.query.pipelineId,
      status: req.query.status as 'open' | 'won' | 'lost' | undefined,
      personId: req.query.personId,
      organizationId: req.query.organizationId,
    }),
  );
  app.get<Id>('/api/opportunities/:id', async (req) => getOpportunity(req.params.id));
  app.post('/api/opportunities', async (req) => createOpportunity(ctxOf(req), req.body as never));
  app.put<Id>('/api/opportunities/:id', async (req) => updateOpportunity(ctxOf(req), req.params.id, req.body as never));
  app.post<Id>('/api/opportunities/:id/move', async (req) => {
    const { stageId, lostReason } = parse(z.object({ stageId: z.string(), lostReason: z.string().max(500).nullable().optional() }), req.body);
    return moveOpportunity(ctxOf(req), req.params.id, stageId, { lostReason });
  });
  app.post<Id>('/api/opportunities/:id/project', async (req) => projectFromOpportunity(ctxOf(req), req.params.id));
  app.delete<Id>('/api/opportunities/:id', async (req) => {
    deleteOpportunity(ctxOf(req), req.params.id);
    return { ok: true };
  });

  // ---------- projects ----------
  app.get<{ Querystring: Q }>('/api/projects', async (req) =>
    listProjects({ workspaceId: req.query.workspaceId, status: req.query.status, organizationId: req.query.organizationId, personId: req.query.personId }),
  );
  app.get<Id>('/api/projects/:id', async (req) => getProject(req.params.id));
  app.post('/api/projects', async (req) => createProject(ctxOf(req), req.body as never));
  app.put<Id>('/api/projects/:id', async (req) => updateProject(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/projects/:id', async (req) => {
    deleteProject(ctxOf(req), req.params.id);
    return { ok: true };
  });
  app.post<Id>('/api/projects/:id/milestones', async (req) => addMilestone(ctxOf(req), req.params.id, req.body));
  app.put<{ Params: { id: string; mid: string } }>('/api/projects/:id/milestones/:mid', async (req) =>
    updateMilestone(ctxOf(req), req.params.id, req.params.mid, req.body as Record<string, unknown>),
  );
  app.delete<{ Params: { id: string; mid: string } }>('/api/projects/:id/milestones/:mid', async (req) => deleteMilestone(ctxOf(req), req.params.id, req.params.mid));
}
