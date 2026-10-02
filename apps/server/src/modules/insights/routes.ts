import { REVIEW_TYPES, type ReviewType } from '@life-erp/shared';
import type { FastifyInstance } from 'fastify';
import { ctxOf, type Q } from '../../http';
import { badRequest } from '../../lib/errors';
import { netPosition } from '../finance/reports';
import { today } from '../life/common';
import { analytics, netWorthHistory, snapshotNetWorth } from './analytics';
import { addValuation, createAsset, deleteAsset, deleteValuation, disposeAsset, getAsset, listAssets, updateAsset } from './assets';
import { deleteReview, getReview, listReviews, reviewStatus, saveReview } from './reviews';
import { createScenario, deleteScenario, getScenario, listScenarios, scenarioBaseline, updateScenario } from './scenarios';

type Id = { Params: { id: string } };
const ok = { ok: true };
const reviewType = (t: string | undefined): ReviewType => {
  if (!REVIEW_TYPES.includes(t as ReviewType)) throw badRequest('Unknown review type');
  return t as ReviewType;
};

export async function insightsRoutes(app: FastifyInstance) {
  // ---------- assets & net worth ----------
  app.get<{ Querystring: Q }>('/api/assets', async (req) => listAssets({ workspaceId: req.query.workspaceId, includeDisposed: req.query.disposed === '1' }));
  app.get<Id>('/api/assets/:id', async (req) => getAsset(req.params.id));
  app.post('/api/assets', async (req) => {
    const a = createAsset(ctxOf(req), req.body as never);
    snapshotNetWorth();
    return a;
  });
  app.put<Id>('/api/assets/:id', async (req) => updateAsset(ctxOf(req), req.params.id, req.body as never));
  app.post<Id>('/api/assets/:id/valuations', async (req) => {
    const a = addValuation(ctxOf(req), req.params.id, req.body);
    snapshotNetWorth();
    return a;
  });
  app.delete<{ Params: { id: string; vid: string } }>('/api/assets/:id/valuations/:vid', async (req) => deleteValuation(ctxOf(req), req.params.id, req.params.vid));
  app.post<Id>('/api/assets/:id/dispose', async (req) => disposeAsset(ctxOf(req), req.params.id, req.body ?? null));
  app.delete<Id>('/api/assets/:id/dispose', async (req) => disposeAsset(ctxOf(req), req.params.id, null));
  app.delete<Id>('/api/assets/:id', async (req) => {
    deleteAsset(ctxOf(req), req.params.id);
    return ok;
  });
  app.get('/api/net-worth', async () => ({ now: netPosition(today()), history: netWorthHistory() }));

  // ---------- analytics ----------
  app.get<{ Querystring: Q }>('/api/analytics', async (req) => analytics(Math.min(Math.max(Number(req.query.months) || 12, 3), 36)));

  // ---------- reviews ----------
  app.get('/api/reviews/status', async () => reviewStatus());
  app.get<{ Querystring: Q }>('/api/reviews', async (req) => listReviews(req.query.type ? reviewType(req.query.type) : undefined));
  app.get<{ Params: { type: string }; Querystring: Q }>('/api/reviews/:type', async (req) => getReview(reviewType(req.params.type), req.query.start));
  app.put('/api/reviews', async (req) => saveReview(ctxOf(req), req.body));
  app.delete<Id>('/api/reviews/:id', async (req) => {
    deleteReview(ctxOf(req), req.params.id);
    return ok;
  });

  // ---------- scenarios ----------
  app.get('/api/scenarios/baseline', async () => scenarioBaseline());
  app.get('/api/scenarios', async () => listScenarios());
  app.get<Id>('/api/scenarios/:id', async (req) => getScenario(req.params.id));
  app.post('/api/scenarios', async (req) => createScenario(ctxOf(req), req.body as never));
  app.put<Id>('/api/scenarios/:id', async (req) => updateScenario(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/scenarios/:id', async (req) => {
    deleteScenario(ctxOf(req), req.params.id);
    return ok;
  });
}
