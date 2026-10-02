import type { FastifyInstance } from 'fastify';
import { ctxOf, type Q } from '../../http';
import {
  addInterview,
  createApplication,
  deleteApplication,
  deleteInterview,
  funnel,
  getApplication,
  listApplications,
  listStatuses,
  saveStatuses,
  updateApplication,
  updateInterview,
} from './applications';
import { careerOverview } from './overview';
import {
  createAchievement,
  createEmployment,
  createLearning,
  createSkill,
  cvExport,
  deleteAchievement,
  deleteEmployment,
  deleteLearning,
  deleteSkill,
  getEmployment,
  listAchievements,
  listEmployments,
  listLearning,
  listSkills,
  updateAchievement,
  updateEmployment,
  updateLearning,
  updateSkill,
} from './profile';

type Id = { Params: { id: string } };
const ok = { ok: true };

export async function careerRoutes(app: FastifyInstance) {
  app.get('/api/career/overview', async () => careerOverview());

  // ---------- applications ----------
  app.get('/api/career/statuses', async () => listStatuses());
  app.put('/api/career/statuses', async (req) => saveStatuses(ctxOf(req), req.body));
  app.get('/api/career/funnel', async () => funnel());
  app.get<{ Querystring: Q }>('/api/career/applications', async (req) => listApplications({ statusId: req.query.statusId, open: req.query.open === '1' }));
  app.get<Id>('/api/career/applications/:id', async (req) => getApplication(req.params.id));
  app.post('/api/career/applications', async (req) => createApplication(ctxOf(req), req.body as never));
  app.put<Id>('/api/career/applications/:id', async (req) => updateApplication(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/career/applications/:id', async (req) => {
    deleteApplication(ctxOf(req), req.params.id);
    return ok;
  });
  app.post('/api/career/interviews', async (req) => addInterview(ctxOf(req), req.body as never));
  app.put<Id>('/api/career/interviews/:id', async (req) => updateInterview(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/career/interviews/:id', async (req) => deleteInterview(ctxOf(req), req.params.id));

  // ---------- employment ----------
  app.get('/api/career/jobs', async () => listEmployments());
  app.get<Id>('/api/career/jobs/:id', async (req) => getEmployment(req.params.id));
  app.post('/api/career/jobs', async (req) => createEmployment(ctxOf(req), req.body as never));
  app.put<Id>('/api/career/jobs/:id', async (req) => updateEmployment(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/career/jobs/:id', async (req) => {
    deleteEmployment(ctxOf(req), req.params.id);
    return ok;
  });

  // ---------- skills ----------
  app.get('/api/career/skills', async () => listSkills());
  app.post('/api/career/skills', async (req) => createSkill(ctxOf(req), req.body as never));
  app.put<Id>('/api/career/skills/:id', async (req) => updateSkill(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/career/skills/:id', async (req) => {
    deleteSkill(ctxOf(req), req.params.id);
    return ok;
  });

  // ---------- achievements ----------
  app.get<{ Querystring: Q }>('/api/career/achievements', async (req) => listAchievements({ employmentId: req.query.employmentId, skillId: req.query.skillId }));
  app.get<{ Querystring: Q }>('/api/career/achievements/cv', async (req) => ({ text: cvExport(Number(req.query.minRelevance) || 1) }));
  app.post('/api/career/achievements', async (req) => createAchievement(ctxOf(req), req.body as never));
  app.put<Id>('/api/career/achievements/:id', async (req) => updateAchievement(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/career/achievements/:id', async (req) => {
    deleteAchievement(ctxOf(req), req.params.id);
    return ok;
  });

  // ---------- learning ----------
  app.get<{ Querystring: Q }>('/api/career/learning', async (req) => listLearning({ status: req.query.status, skillId: req.query.skillId }));
  app.post('/api/career/learning', async (req) => createLearning(ctxOf(req), req.body as never));
  app.put<Id>('/api/career/learning/:id', async (req) => updateLearning(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/career/learning/:id', async (req) => {
    deleteLearning(ctxOf(req), req.params.id);
    return ok;
  });
}
