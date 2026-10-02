import { and, eq, or } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { entityLinks } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { badRequest, notFound } from '../../lib/errors';
import { newId } from '../../lib/ids';
import { entityDef, resolveRefs } from '../../lib/registry';

interface Ref {
  type: string;
  id: string;
}

function assertExists(ref: Ref) {
  const def = entityDef(ref.type);
  if (!def) throw badRequest(`Records of type "${ref.type}" can't be linked yet`);
  if (!def.exists(ref.id)) throw notFound(`Linked ${ref.type.replace('_', ' ')}`);
}

export function createLink(ctx: AuditContext, from: Ref, to: Ref, relation = 'related', note: string | null = null) {
  if (from.type === to.type && from.id === to.id) throw badRequest('A record cannot be linked to itself');
  assertExists(from);
  assertExists(to);
  const db = getDb();
  // Links are undirected for display purposes: don't create the mirror of an existing link.
  const existing = db
    .select()
    .from(entityLinks)
    .where(
      or(
        and(eq(entityLinks.fromType, from.type), eq(entityLinks.fromId, from.id), eq(entityLinks.toType, to.type), eq(entityLinks.toId, to.id)),
        and(eq(entityLinks.fromType, to.type), eq(entityLinks.fromId, to.id), eq(entityLinks.toType, from.type), eq(entityLinks.toId, from.id)),
      ),
    )
    .get();
  if (existing) return existing;
  const row = { id: newId(), fromType: from.type, fromId: from.id, toType: to.type, toId: to.id, relation, note };
  db.insert(entityLinks).values(row).run();
  audit(ctx, 'link.create', from, `Linked ${from.type} → ${to.type}`, null, row);
  return row;
}

export function deleteLink(ctx: AuditContext, id: string) {
  const db = getDb();
  const link = db.select().from(entityLinks).where(eq(entityLinks.id, id)).get();
  if (!link) throw notFound('Link');
  db.delete(entityLinks).where(eq(entityLinks.id, id)).run();
  audit(ctx, 'link.delete', { type: link.fromType, id: link.fromId }, `Unlinked ${link.fromType} → ${link.toType}`, link);
}

/** All records linked to a record (in either direction), with display info. */
export function linksFor(ref: Ref) {
  const rows = getDb()
    .select()
    .from(entityLinks)
    .where(
      or(
        and(eq(entityLinks.fromType, ref.type), eq(entityLinks.fromId, ref.id)),
        and(eq(entityLinks.toType, ref.type), eq(entityLinks.toId, ref.id)),
      ),
    )
    .all();
  const others = rows.map((r) =>
    r.fromType === ref.type && r.fromId === ref.id ? { type: r.toType, id: r.toId } : { type: r.fromType, id: r.fromId },
  );
  const resolved = resolveRefs(others);
  return rows.flatMap((r, i) => {
    const o = others[i];
    const e = resolved.get(`${o.type}:${o.id}`);
    if (!e) return [];
    return [{ linkId: r.id, relation: r.relation, note: r.note, createdAt: r.createdAt, entity: e }];
  });
}

export function linkedIds(ref: Ref, otherType: string): string[] {
  return linksFor(ref)
    .filter((l) => l.entity.type === otherType)
    .map((l) => l.entity.id);
}

/** Remove every link touching a record (used on permanent deletion). */
export function clearLinksFor(ref: Ref) {
  getDb()
    .delete(entityLinks)
    .where(
      or(
        and(eq(entityLinks.fromType, ref.type), eq(entityLinks.fromId, ref.id)),
        and(eq(entityLinks.toType, ref.type), eq(entityLinks.toId, ref.id)),
      ),
    )
    .run();
}
