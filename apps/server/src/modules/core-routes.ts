import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { documentMetaSchema, entityRefSchema, linkSchema, setTagsSchema, settingsPatchSchema, tagSchema } from '@life-erp/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../db/client';
import { auditLog } from '../db/schema';
import { ctxOf, sendFileDownload, type Q } from '../http';
import { audit } from '../lib/audit';
import { badRequest } from '../lib/errors';
import { entityDef, resolveRefs } from '../lib/registry';
import { parse } from '../lib/validate';
import { getConfig } from '../runtime';
import { INLINE_SAFE, storeUpload } from './documents/files';
import { createDocument, deleteDocument, getDocument, getDocumentFile, listDocuments, updateDocument } from './documents/service';
import { createLink, deleteLink, linksFor } from './links/service';
import { dismiss, listNotifications, markAllRead, markRead, notificationCounts } from './notifications/service';
import { rebuildSearchIndex, search } from './search/service';
import { getSettings, saveSettings } from './settings/service';
import { createTag, deleteTag, getTagsFor, listTags, setTagsFor, updateTag } from './tags/service';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  reorderWorkspaces,
  setWorkspaceArchived,
  updateWorkspace,
} from './workspaces/service';

type Id = { Params: { id: string } };

export async function coreRoutes(app: FastifyInstance) {
  // ---------- settings ----------
  app.get('/api/settings', async () => getSettings());
  app.patch('/api/settings', async (req) => saveSettings(ctxOf(req), parse(settingsPatchSchema, req.body)));

  // ---------- workspaces ----------
  app.get<{ Querystring: Q }>('/api/workspaces', async (req) => listWorkspaces({ includeArchived: req.query.archived === '1' }));
  app.get<Id>('/api/workspaces/:id', async (req) => getWorkspace(req.params.id));
  app.post('/api/workspaces', async (req) => createWorkspace(ctxOf(req), req.body as never));
  app.put<Id>('/api/workspaces/:id', async (req) => updateWorkspace(ctxOf(req), req.params.id, req.body as never));
  app.post<Id>('/api/workspaces/:id/archive', async (req) => {
    const { archived } = parse(z.object({ archived: z.boolean() }), req.body);
    setWorkspaceArchived(ctxOf(req), req.params.id, archived);
    return getWorkspace(req.params.id);
  });
  app.delete<Id>('/api/workspaces/:id', async (req) => {
    deleteWorkspace(ctxOf(req), req.params.id);
    return { ok: true };
  });
  app.post('/api/workspaces/reorder', async (req) => {
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(100) }), req.body);
    reorderWorkspaces(ctxOf(req), ids);
    return { ok: true };
  });

  // ---------- tags ----------
  app.get('/api/tags', async () => listTags());
  app.post('/api/tags', async (req) => createTag(ctxOf(req), parse(tagSchema, req.body)));
  app.put<Id>('/api/tags/:id', async (req) => {
    updateTag(ctxOf(req), req.params.id, parse(tagSchema.partial(), req.body));
    return { ok: true };
  });
  app.delete<Id>('/api/tags/:id', async (req) => {
    deleteTag(ctxOf(req), req.params.id);
    return { ok: true };
  });
  app.get<{ Querystring: Q }>('/api/tags/for', async (req) => {
    const ref = parse(entityRefSchema, req.query);
    return getTagsFor(ref.type, ref.id);
  });
  app.put('/api/tags/for', async (req) => {
    const { entity, tags } = parse(setTagsSchema, req.body);
    const def = entityDef(entity.type);
    if (!def?.exists(entity.id)) throw badRequest('Record not found');
    return setTagsFor(entity.type, entity.id, tags);
  });

  // ---------- links ----------
  app.get<{ Querystring: Q }>('/api/links', async (req) => linksFor(parse(entityRefSchema, req.query)));
  app.post('/api/links', async (req) => {
    const d = parse(linkSchema, req.body);
    return createLink(ctxOf(req), d.from, d.to, d.relation, d.note);
  });
  app.delete<Id>('/api/links/:id', async (req) => {
    deleteLink(ctxOf(req), req.params.id);
    return { ok: true };
  });
  app.post('/api/entities/resolve', async (req) => {
    const { refs } = parse(z.object({ refs: z.array(entityRefSchema).max(200) }), req.body);
    return [...resolveRefs(refs).values()];
  });

  // ---------- documents ----------
  app.get<{ Querystring: Q }>('/api/documents', async (req) => {
    const q = req.query;
    const attachedTo = q.attachedType && q.attachedId ? { type: q.attachedType, id: q.attachedId } : null;
    return listDocuments({
      workspaceId: q.workspaceId,
      docType: q.docType,
      tag: q.tag,
      q: q.q,
      attachedTo,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
  });
  app.get<Id>('/api/documents/:id', async (req) => getDocument(req.params.id));
  app.post('/api/documents', async (req) => {
    const cfg = getConfig();
    if (!req.isMultipart()) throw badRequest('Send the file as multipart/form-data');
    const part = await req.file({ limits: { fileSize: cfg.maxUploadBytes, files: 1 } });
    if (!part) throw badRequest('No file was uploaded');
    const stored = await storeUpload(part.file, part.filename, { files: cfg.paths.files, tmp: cfg.paths.tmp });
    const f = Object.fromEntries(
      Object.entries(part.fields).flatMap(([k, v]) => (v && 'value' in v ? [[k, (v as { value: string }).value]] : [])),
    ) as Record<string, string>;
    const meta = parse(documentMetaSchema, {
      title: f.title?.trim() || part.filename.replace(/\.[^.]+$/, ''),
      description: f.description || null,
      docType: f.docType || 'other',
      workspaceId: f.workspaceId || null,
      documentDate: f.documentDate || null,
      expiresOn: f.expiresOn || null,
      tags: f.tags ? f.tags.split(/[\s,]+/).filter(Boolean) : [],
    });
    const attachTo = f.attachType && f.attachId ? parse(entityRefSchema, { type: f.attachType, id: f.attachId }) : null;
    return createDocument(ctxOf(req), stored, part.filename, meta, attachTo);
  });
  app.put<Id>('/api/documents/:id', async (req) => updateDocument(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/documents/:id', async (req) => {
    deleteDocument(ctxOf(req), req.params.id);
    return { ok: true };
  });
  app.get<Id & { Querystring: Q }>('/api/documents/:id/file', async (req, reply) => {
    const { originalName, file } = getDocumentFile(req.params.id);
    const inline = req.query.download !== '1' && INLINE_SAFE.has(file.mime);
    sendFileDownload(reply, originalName, file.mime, inline);
    reply.header('Content-Length', file.size);
    return reply.send(createReadStream(join(getConfig().paths.files, file.storagePath)));
  });

  // ---------- search ----------
  app.get<{ Querystring: Q }>('/api/search', async (req) => {
    const q = (req.query.q ?? '').slice(0, 200);
    return search(q, {
      workspaceId: req.query.workspaceId || null,
      types: req.query.types ? req.query.types.split(',') : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 30,
    });
  });
  app.post('/api/search/rebuild', async (req) => {
    const count = rebuildSearchIndex();
    audit(ctxOf(req), 'search.rebuild', null, `Rebuilt search index (${count} records)`);
    return { count };
  });

  // ---------- notifications ----------
  app.get<{ Querystring: Q }>('/api/notifications', async (req) => ({
    items: listNotifications({ unreadOnly: req.query.unread === '1' }),
    counts: notificationCounts(),
  }));
  app.post<Id>('/api/notifications/:id/read', async (req) => {
    markRead(req.params.id);
    return { ok: true };
  });
  app.post('/api/notifications/read-all', async () => {
    markAllRead();
    return { ok: true };
  });
  app.post<Id>('/api/notifications/:id/dismiss', async (req) => {
    dismiss(req.params.id);
    return { ok: true };
  });

  // ---------- audit log / activity ----------
  app.get<{ Querystring: Q }>('/api/audit', async (req) => {
    const q = req.query;
    const conds = [];
    if (q.entityType && q.entityId) conds.push(and(eq(auditLog.entityType, q.entityType), eq(auditLog.entityId, q.entityId)));
    if (q.before) conds.push(lt(auditLog.at, q.before));
    const rows = getDb()
      .select({
        id: auditLog.id,
        at: auditLog.at,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        summary: auditLog.summary,
        ip: auditLog.ip,
      })
      .from(auditLog)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditLog.at))
      .limit(Math.min(Number(q.limit ?? 100), 500))
      .all();
    return rows;
  });
  app.get<Id>('/api/audit/:id', async (req) => {
    const row = getDb().select().from(auditLog).where(eq(auditLog.id, req.params.id)).get();
    if (!row) throw badRequest('Not found');
    return { ...row, before: row.before ? JSON.parse(row.before) : null, after: row.after ? JSON.parse(row.after) : null };
  });
}
