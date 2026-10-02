import { AUTOMATION_EVENTS } from '@life-erp/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf, type Q } from '../../http';
import { parse } from '../../lib/validate';
import { createDef, deleteDef, getValues, listDefs, reorderDefs, setValues, updateDef } from './custom-fields';
import { createAutomation, deleteAutomation, getAutomation, listAutomations, testAutomation, updateAutomation } from './engine';
import { analyzeImport, commitImport, deletePreset, listImports, listPresets, previewImport, savePreset, undoImport } from './import';

type Id = { Params: { id: string } };
const ok = { ok: true };

export async function automationRoutes(app: FastifyInstance) {
  // ---------- automations ----------
  app.get('/api/automations/events', async () => AUTOMATION_EVENTS);
  app.get('/api/automations', async () => listAutomations());
  app.get<Id>('/api/automations/:id', async (req) => getAutomation(req.params.id));
  app.post('/api/automations', async (req) => createAutomation(ctxOf(req), req.body as never));
  app.post('/api/automations/test', async (req) => testAutomation(req.body as never));
  app.put<Id>('/api/automations/:id', async (req) => updateAutomation(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/automations/:id', async (req) => {
    deleteAutomation(ctxOf(req), req.params.id);
    return ok;
  });

  // ---------- custom fields ----------
  app.get<{ Querystring: Q }>('/api/custom-fields', async (req) => listDefs(req.query.entityType));
  app.post('/api/custom-fields', async (req) => createDef(ctxOf(req), req.body as never));
  app.put('/api/custom-fields/order', async (req) => {
    reorderDefs(ctxOf(req), parse(z.array(z.string()).max(200), req.body));
    return ok;
  });
  app.put<Id>('/api/custom-fields/:id', async (req) => updateDef(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/custom-fields/:id', async (req) => {
    deleteDef(ctxOf(req), req.params.id);
    return ok;
  });
  app.get<{ Params: { type: string; id: string } }>('/api/custom-fields/values/:type/:id', async (req) => getValues(req.params.type, req.params.id));
  app.put<{ Params: { type: string; id: string } }>('/api/custom-fields/values/:type/:id', async (req) => setValues(ctxOf(req), req.params.type, req.params.id, req.body));

  // ---------- import ----------
  // Imports carry whole files in the body.
  const big = { bodyLimit: 12 * 1024 * 1024 };
  app.post('/api/import/analyze', big, async (req) => analyzeImport(req.body));
  app.post('/api/import/preview', big, async (req) => previewImport(ctxOf(req), req.body));
  app.post('/api/import/commit', big, async (req) => commitImport(ctxOf(req), req.body));
  app.get('/api/imports', async () => listImports());
  app.post<Id>('/api/imports/:id/undo', async (req) => undoImport(ctxOf(req), req.params.id));
  app.get<{ Querystring: Q }>('/api/import/presets', async (req) => listPresets(req.query.target));
  app.post('/api/import/presets', async (req) => savePreset(ctxOf(req), req.body));
  app.delete<Id>('/api/import/presets/:id', async (req) => {
    deletePreset(ctxOf(req), req.params.id);
    return ok;
  });
}
