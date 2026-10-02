import { normalizeDigits } from '@life-erp/shared';
import { getSqlite } from '../../db/client';
import { allEntityDefs, entityDef, resolveRefs, type SearchDoc } from '../../lib/registry';

function tagsFor(type: string, id: string): string {
  const rows = getSqlite()
    .prepare('SELECT t.name FROM taggings g JOIN tags t ON t.id = g.tag_id WHERE g.entity_type = ? AND g.entity_id = ?')
    .all(type, id) as { name: string }[];
  return rows.map((r) => `#${r.name} ${r.name}`).join(' ');
}

function writeDoc(type: string, doc: SearchDoc) {
  getSqlite()
    .prepare('INSERT INTO search_index (entity_type, entity_id, workspace_id, title, body, tags) VALUES (?, ?, ?, ?, ?, ?)')
    .run(type, doc.id, doc.workspaceId ?? null, doc.title, doc.body ?? '', tagsFor(type, doc.id));
}

export function removeFromIndex(type: string, id: string) {
  getSqlite().prepare('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?').run(type, id);
}

/** Refresh one record's search row from its module (removes it if the record is gone). */
export function reindexEntity(type: string, id: string) {
  const def = entityDef(type);
  removeFromIndex(type, id);
  const doc = def?.searchDocs?.([id])[0];
  if (doc) writeDoc(type, doc);
}

export function rebuildSearchIndex() {
  const sqlite = getSqlite();
  let count = 0;
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM search_index').run();
    for (const def of allEntityDefs()) {
      for (const doc of def.searchDocs?.() ?? []) {
        writeDoc(def.type, doc);
        count++;
      }
    }
  })();
  return count;
}

/**
 * Turn free text into a safe FTS5 query: every word must match (prefix match),
 * user input can never inject FTS syntax.
 */
export function toFtsQuery(q: string): string | null {
  const words = normalizeDigits(q)
    .replace(/[#"*^():{}[\]\\]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' AND ');
}

export interface SearchHit {
  type: string;
  id: string;
  title: string;
  url: string;
  subtitle: string | null;
  snippet: string;
  workspaceId: string | null;
}

export function search(q: string, opts: { workspaceId?: string | null; types?: string[]; limit?: number } = {}): SearchHit[] {
  const fts = toFtsQuery(q);
  if (!fts) return [];
  const params: unknown[] = [fts];
  let where = 'search_index MATCH ?';
  if (opts.workspaceId) {
    where += ' AND workspace_id = ?';
    params.push(opts.workspaceId);
  }
  if (opts.types?.length) {
    where += ` AND entity_type IN (${opts.types.map(() => '?').join(',')})`;
    params.push(...opts.types);
  }
  params.push(Math.min(opts.limit ?? 30, 100));
  const rows = getSqlite()
    .prepare(
      `SELECT entity_type AS type, entity_id AS id, workspace_id AS workspaceId,
              snippet(search_index, -1, '[[', ']]', '…', 12) AS snippet
         FROM search_index WHERE ${where}
         ORDER BY bm25(search_index, 0, 0, 0, 10.0, 1.0, 4.0) LIMIT ?`,
    )
    .all(...params) as { type: string; id: string; workspaceId: string | null; snippet: string }[];
  const resolved = resolveRefs(rows);
  return rows.flatMap((r) => {
    const e = resolved.get(`${r.type}:${r.id}`);
    if (!e) return []; // stale index row for a deleted record
    return [{ type: r.type, id: r.id, title: e.title, url: e.url, subtitle: e.subtitle ?? null, snippet: r.snippet, workspaceId: r.workspaceId }];
  });
}
