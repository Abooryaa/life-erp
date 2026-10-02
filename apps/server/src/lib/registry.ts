import type { EntityType } from '@life-erp/shared';
import { AppError } from './errors';

export interface ResolvedEntity {
  id: string;
  type: EntityType;
  title: string;
  /** Client route that opens the record. */
  url: string;
  subtitle?: string | null;
  workspaceId?: string | null;
}

export interface SearchDoc {
  id: string;
  workspaceId?: string | null;
  title: string;
  body?: string | null;
}

export interface EntityDef {
  type: EntityType;
  /** Fetch display info for a batch of ids (deleted records are omitted). */
  resolve(ids: string[]): ResolvedEntity[];
  /**
   * Search documents for the given ids (or for every live record when ids is omitted).
   * Records that are deleted must be left out — they are then removed from the index.
   */
  searchDocs?(ids?: string[]): SearchDoc[];
  /** Return true when the record exists and is not deleted. */
  exists(id: string): boolean;
}

const defs = new Map<EntityType, EntityDef>();

/** Each module registers its record types so generic features (links, tags, search) can work with them. */
export function registerEntity(def: EntityDef) {
  defs.set(def.type, def);
}

export function entityDef(type: string): EntityDef | undefined {
  return defs.get(type as EntityType);
}

export function allEntityDefs() {
  return [...defs.values()];
}

/** Validate an optional reference to another module's record without importing that module. */
export function assertRef(type: EntityType, id: string | null | undefined, field: string, label: string) {
  if (!id) return;
  if (!entityDef(type)?.exists(id)) {
    throw new AppError(400, 'validation', `${label} not found`, [{ path: field, message: `${label} not found` }]);
  }
}

/** Resolve a mixed list of references, grouped by type for efficiency. */
export function resolveRefs(refs: { type: string; id: string }[]): Map<string, ResolvedEntity> {
  const byType = new Map<string, string[]>();
  for (const r of refs) byType.set(r.type, [...(byType.get(r.type) ?? []), r.id]);
  const out = new Map<string, ResolvedEntity>();
  for (const [type, ids] of byType) {
    const def = entityDef(type);
    if (!def) continue;
    for (const e of def.resolve([...new Set(ids)])) out.set(`${type}:${e.id}`, e);
  }
  return out;
}
