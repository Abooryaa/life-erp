import type { FastifyInstance } from 'fastify';
import { ctxOf, type Q } from '../../http';
import { aiStatus, askAssistant, clearAiCalls, listAiCalls, removeApiKey, setApiKey, suggestReview, testAi } from './service';
import { AI_TOOLS } from './tools';

export async function aiRoutes(app: FastifyInstance) {
  app.get('/api/ai/status', async () => aiStatus());
  app.get('/api/ai/tools', async () => AI_TOOLS.map((t) => ({ name: t.name, scope: t.scope, description: t.description })));
  app.post('/api/ai/ask', async (req) => askAssistant(ctxOf(req), req.body));
  app.post('/api/ai/review', async (req) => suggestReview(ctxOf(req), req.body));
  app.post('/api/ai/test', async (req) => testAi(ctxOf(req)));
  app.get<{ Querystring: Q }>('/api/ai/log', async (req) => listAiCalls(Number(req.query.limit) || 100));
  app.delete('/api/ai/log', async (req) => {
    clearAiCalls(ctxOf(req));
    return { ok: true };
  });
  app.put('/api/ai/key', async (req) => setApiKey(ctxOf(req), req.body));
  app.delete('/api/ai/key', async (req) => removeApiKey(ctxOf(req)));
}
