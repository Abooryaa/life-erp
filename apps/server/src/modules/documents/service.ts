import { documentMetaSchema, type DocumentMeta } from '@life-erp/shared';
import { and, desc, eq, inArray, isNull, like, or } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { documents, files } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { createLink, linkedIds, linksFor } from '../links/service';
import { reindexEntity } from '../search/service';
import { getTagsFor, getTagsForMany, idsWithTag, setTagsFor } from '../tags/service';
import { assertWorkspace } from '../workspaces/service';
import type { FileRow } from './files';

const live = isNull(documents.deletedAt);

function withFile() {
  return getDb()
    .select({
      id: documents.id,
      workspaceId: documents.workspaceId,
      title: documents.title,
      originalName: documents.originalName,
      description: documents.description,
      docType: documents.docType,
      documentDate: documents.documentDate,
      expiresOn: documents.expiresOn,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      size: files.size,
      mime: files.mime,
      fileId: files.id,
    })
    .from(documents)
    .innerJoin(files, eq(files.id, documents.fileId));
}

export function createDocument(
  ctx: AuditContext,
  file: FileRow,
  originalName: string,
  meta: DocumentMeta,
  attachTo?: { type: string; id: string } | null,
) {
  const data = parse(documentMetaSchema, meta);
  assertWorkspace(data.workspaceId);
  const id = newId();
  getDb()
    .insert(documents)
    .values({
      id,
      fileId: file.id,
      originalName: originalName.slice(0, 255),
      title: data.title,
      description: data.description,
      docType: data.docType,
      workspaceId: data.workspaceId ?? null,
      documentDate: data.documentDate ?? null,
      expiresOn: data.expiresOn ?? null,
    })
    .run();
  if (data.tags?.length) setTagsFor('document', id, data.tags);
  if (attachTo) createLink(ctx, attachTo, { type: 'document', id }, 'attachment');
  audit(ctx, 'document.create', { type: 'document', id }, `Uploaded "${data.title}" (${originalName}, ${file.size} bytes)`);
  reindexEntity('document', id);
  return getDocument(id);
}

export function getDocument(id: string) {
  const d = withFile().where(and(eq(documents.id, id), live)).get();
  if (!d) throw notFound('Document');
  return { ...d, tags: getTagsFor('document', id), links: linksFor({ type: 'document', id }) };
}

export function getDocumentFile(id: string) {
  const row = getDb()
    .select({ title: documents.title, originalName: documents.originalName, file: files })
    .from(documents)
    .innerJoin(files, eq(files.id, documents.fileId))
    .where(and(eq(documents.id, id), live))
    .get();
  if (!row) throw notFound('Document');
  return row;
}

export interface DocumentFilter {
  workspaceId?: string | null;
  docType?: string | null;
  tag?: string | null;
  q?: string | null;
  attachedTo?: { type: string; id: string } | null;
  limit?: number;
  offset?: number;
}

export function listDocuments(f: DocumentFilter = {}) {
  const conds = [live];
  if (f.workspaceId) conds.push(eq(documents.workspaceId, f.workspaceId));
  if (f.docType) conds.push(eq(documents.docType, f.docType));
  if (f.tag) conds.push(inArray(documents.id, idsWithTag('document', f.tag)));
  if (f.attachedTo) conds.push(inArray(documents.id, linkedIds(f.attachedTo, 'document')));
  if (f.q) {
    const q = `%${f.q.replace(/[%_]/g, '')}%`;
    conds.push(or(like(documents.title, q), like(documents.originalName, q), like(documents.description, q))!);
  }
  const rows = withFile()
    .where(and(...conds))
    .orderBy(desc(documents.createdAt))
    .limit(Math.min(f.limit ?? 100, 500))
    .offset(f.offset ?? 0)
    .all();
  const tags = getTagsForMany('document', rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, tags: tags.get(r.id) ?? [] }));
}

export function updateDocument(ctx: AuditContext, id: string, meta: Partial<DocumentMeta>) {
  const before = getDocument(id);
  const data = parse(documentMetaSchema, { ...before, ...meta });
  assertWorkspace(data.workspaceId);
  getDb()
    .update(documents)
    .set({
      title: data.title,
      description: data.description,
      docType: data.docType,
      workspaceId: data.workspaceId ?? null,
      documentDate: data.documentDate ?? null,
      expiresOn: data.expiresOn ?? null,
      updatedAt: nowIso(),
    })
    .where(eq(documents.id, id))
    .run();
  if (meta.tags) setTagsFor('document', id, meta.tags);
  reindexEntity('document', id);
  const after = getDocument(id);
  audit(ctx, 'document.update', { type: 'document', id }, `Updated document "${after.title}"`, before, after);
  return after;
}

/** Soft delete: the file stays on disk (and in backups) until the trash is emptied. */
export function deleteDocument(ctx: AuditContext, id: string) {
  const d = getDocument(id);
  getDb().update(documents).set({ deletedAt: nowIso(), updatedAt: nowIso() }).where(eq(documents.id, id)).run();
  reindexEntity('document', id);
  audit(ctx, 'document.delete', { type: 'document', id }, `Deleted document "${d.title}"`, d);
}

registerEntity({
  type: 'document',
  exists: (id) => !!getDb().select({ id: documents.id }).from(documents).where(and(eq(documents.id, id), live)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(documents)
      .where(and(inArray(documents.id, ids), live))
      .all()
      .map((d) => ({ id: d.id, type: 'document', title: d.title, url: `/documents/${d.id}`, subtitle: d.originalName, workspaceId: d.workspaceId })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(documents)
      .where(ids ? and(inArray(documents.id, ids), live) : live)
      .all()
      .map((d) => ({
        id: d.id,
        workspaceId: d.workspaceId,
        title: d.title,
        body: [d.originalName, d.description, d.docType].filter(Boolean).join('\n'),
      })),
});
