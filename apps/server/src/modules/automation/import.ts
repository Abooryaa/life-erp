import { guessDateFormat, importPresetSchema, importRequestSchema, parseCsv, type ImportOptions, type ImportRequest } from '@life-erp/shared';
import { desc, eq } from 'drizzle-orm';
import { getDb, getSqlite } from '../../db/client';
import { importItems, importPresets, imports } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { parse } from '../../lib/validate';
import { withoutAutomations } from './engine';
import { TARGETS, type TargetDef } from './import-targets';

const MAX_ROWS = 5000;

/** Turn the file into a header list and rows of strings. */
function readFile(req: { content: string; format: 'csv' | 'json'; delimiter?: string | null }) {
  if (req.format === 'json') {
    let data: unknown;
    try {
      data = JSON.parse(req.content);
    } catch {
      throw new AppError(400, 'validation', 'The file is not valid JSON', [{ path: 'content', message: 'Not valid JSON' }]);
    }
    const list = Array.isArray(data) ? data : data && typeof data === 'object' ? (Object.values(data).find(Array.isArray) as unknown[] | undefined) : undefined;
    if (!list?.length) throw badRequest('Expected a JSON array of records');
    const objs = list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
    const headers = [...new Set(objs.flatMap((o) => Object.keys(o)))];
    const rows = objs.map((o) => headers.map((h) => (o[h] === null || o[h] === undefined ? '' : typeof o[h] === 'object' ? JSON.stringify(o[h]) : String(o[h]))));
    return { headers, rows, delimiter: null as string | null };
  }
  const r = parseCsv(req.content, req.delimiter ?? undefined);
  if (!r.headers.length) throw badRequest('The file has no header row');
  return r;
}

const norm = (s: string) => s.toLowerCase().replace(/[_\-.:()]/g, ' ').replace(/\s+/g, ' ').trim();

/** Match file columns to fields by name (exact synonym first, then "contains"). */
function autoMapping(target: TargetDef, headers: string[]) {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of target.fields) {
      if (mapping[f.key]) continue;
      const h = headers.find((x) => {
        if (used.has(x)) return false;
        const n = norm(x);
        return pass === 'exact' ? f.synonyms.includes(n) || n === norm(f.key) : f.synonyms.some((s) => s.length > 3 && n.includes(s));
      });
      if (h) {
        mapping[f.key] = h;
        used.add(h);
      }
    }
  }
  return mapping;
}

/** First look at a file: columns, a few rows, and suggested mapping/format. Nothing is saved. */
export function analyzeImport(input: unknown) {
  const req = parse(importRequestSchema, input);
  const target = TARGETS[req.target];
  const file = readFile(req);
  const mapping = autoMapping(target, file.headers);
  const col = (key: string) => file.headers.indexOf(mapping[key] ?? '');
  const samples = (key: string) => (col(key) >= 0 ? file.rows.slice(0, 50).map((r) => r[col(key)]) : []);
  const dateKey = target.fields.find((f) => f.kind === 'date' && mapping[f.key])?.key;
  const amounts = target.fields.filter((f) => f.kind === 'amount' && mapping[f.key]).flatMap((f) => samples(f.key));
  // "1.234,56" or "12,50" → decimal comma.
  const decimal = amounts.some((a) => /\d,\d{1,2}$/.test(a.trim()) && !/\.\d{1,2}$/.test(a.trim())) ? ',' : '.';
  return {
    headers: file.headers,
    rowCount: file.rows.length,
    sample: file.rows.slice(0, 5),
    delimiter: file.delimiter,
    fields: target.fields.map((f) => ({ key: f.key, kind: f.kind, required: !!f.required })),
    suggested: {
      mapping,
      dateFormat: dateKey ? guessDateFormat(samples(dateKey)) : null,
      decimal,
      amountMode: mapping.amount ? 'signed' : mapping.moneyIn || mapping.moneyOut ? 'split' : 'signed',
    },
  };
}

class Rollback extends Error {}

type RowResult = { row: number; status: 'ok' | 'duplicate' | 'error'; summary?: string; message?: string; field?: string; warnings?: string[] };

/**
 * Run the import row by row through each module's normal create function (same validation as the app).
 * Preview runs everything inside a transaction and rolls it back, so it shows exactly what would happen.
 */
function run(ctx: AuditContext, input: ImportRequest, commit: boolean) {
  const req = parse(importRequestSchema, input);
  const target = TARGETS[req.target];
  const file = readFile(req);
  if (file.rows.length > MAX_ROWS) throw badRequest(`Too many rows (${file.rows.length}). Split the file into parts of ${MAX_ROWS} rows.`);
  const o: ImportOptions = req.options as ImportOptions;
  for (const f of target.fields) {
    if (f.required && !req.mapping[f.key]) throw new AppError(400, 'validation', `Choose the column for “${f.key}”`, [{ path: `mapping.${f.key}`, message: 'Required' }]);
  }
  if (req.target === 'transactions') {
    if (!o.accountId) throw new AppError(400, 'validation', 'Choose the account', [{ path: 'accountId', message: 'Required' }]);
    const need = o.amountMode === 'split' ? !!(req.mapping.moneyIn || req.mapping.moneyOut) : !!req.mapping.amount;
    if (!need) throw new AppError(400, 'validation', 'Choose the amount column(s)', [{ path: o.amountMode === 'split' ? 'mapping.moneyIn' : 'mapping.amount', message: 'Required' }]);
  }
  for (const [k, h] of Object.entries(req.mapping)) {
    if (h && !file.headers.includes(h)) throw new AppError(400, 'validation', `Column “${h}” is not in the file`, [{ path: `mapping.${k}`, message: 'Not in the file' }]);
  }
  const results: RowResult[] = [];
  const created: string[] = [];
  const sqlite = getSqlite();
  const body = () => {
    file.rows.forEach((cells, i) => {
      const values: Record<string, string> = {};
      for (const [k, h] of Object.entries(req.mapping)) if (h) values[k] = cells[file.headers.indexOf(h)] ?? '';
      const attempt = (allowDuplicate: boolean) => sqlite.transaction(() => target.build(ctx, values, o, allowDuplicate))();
      try {
        const r = attempt(false);
        created.push(r.id);
        results.push({ row: i + 2, status: 'ok', summary: r.summary, warnings: r.warnings.length ? r.warnings : undefined });
      } catch (err) {
        if (err instanceof AppError && err.status === 409) {
          if (o.includeDuplicates && req.target === 'transactions') {
            const r = attempt(true);
            created.push(r.id);
            results.push({ row: i + 2, status: 'ok', summary: r.summary, message: 'Possible duplicate — imported anyway' });
          } else results.push({ row: i + 2, status: 'duplicate', message: err.message });
        } else if (err instanceof AppError) {
          results.push({ row: i + 2, status: 'error', message: err.fields?.[0]?.message && err.fields[0].message !== err.message ? `${err.fields[0].path}: ${err.fields[0].message}` : err.message, field: err.fields?.[0]?.path });
        } else throw err;
      }
    });
    if (!commit) throw new Rollback();
    if (created.length) {
      const id = newId();
      getDb()
        .insert(imports)
        .values({ id, target: req.target, fileName: req.fileName ?? null, rowCount: file.rows.length, createdCount: created.length, skippedCount: file.rows.length - created.length })
        .run();
      for (const eid of created) getDb().insert(importItems).values({ importId: id, entityType: target.entityType, entityId: eid }).run();
      audit(ctx, 'import.commit', null, `Imported ${created.length} of ${file.rows.length} rows into ${req.target}${req.fileName ? ` from ${req.fileName}` : ''}`);
      return id;
    }
    return null;
  };
  let importId: string | null = null;
  try {
    const go = () => sqlite.transaction(body)();
    importId = o.runAutomations ? go() : withoutAutomations(go);
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  const count = (s: RowResult['status']) => results.filter((r) => r.status === s).length;
  return {
    importId,
    committed: commit && !!importId,
    total: file.rows.length,
    ok: count('ok'),
    duplicates: count('duplicate'),
    errors: count('error'),
    warnings: results.filter((r) => r.warnings?.length).length,
    results,
  };
}

export const previewImport = (ctx: AuditContext, input: unknown) => run(ctx, input as ImportRequest, false);
export const commitImport = (ctx: AuditContext, input: unknown) => run(ctx, input as ImportRequest, true);

export function listImports() {
  return getDb().select().from(imports).orderBy(desc(imports.createdAt)).limit(100).all();
}

/** Undo an import: delete exactly the records it created (records already deleted are skipped). */
export function undoImport(ctx: AuditContext, id: string) {
  const imp = getDb().select().from(imports).where(eq(imports.id, id)).get();
  if (!imp) throw notFound('Import');
  if (imp.undoneAt) throw badRequest('This import was already undone');
  const target = TARGETS[imp.target as keyof typeof TARGETS];
  const items = getDb().select().from(importItems).where(eq(importItems.importId, id)).all();
  let removed = 0;
  let skipped = 0;
  withoutAutomations(() =>
    getSqlite().transaction(() => {
      for (const it of items) {
        try {
          getSqlite().transaction(() => target.undo(ctx, it.entityId))();
          removed++;
        } catch (err) {
          if (err instanceof AppError) skipped++;
          else throw err;
        }
      }
      getDb().update(imports).set({ undoneAt: nowIso() }).where(eq(imports.id, id)).run();
    })(),
  );
  audit(ctx, 'import.undo', null, `Undid import of ${imp.target}${imp.fileName ? ` (${imp.fileName})` : ''}: ${removed} removed${skipped ? `, ${skipped} already gone` : ''}`);
  return { removed, skipped };
}

// ---------- saved column mappings (e.g. one per bank) ----------

export function listPresets(target?: string) {
  return getDb()
    .select()
    .from(importPresets)
    .where(target ? eq(importPresets.target, target) : undefined)
    .orderBy(importPresets.name)
    .all()
    .map((p) => ({ ...p, mapping: JSON.parse(p.mapping) as Record<string, string>, options: JSON.parse(p.options) as Partial<ImportOptions> }));
}

export function savePreset(ctx: AuditContext, input: unknown) {
  const p = parse(importPresetSchema, input);
  const existing = getDb().select().from(importPresets).where(eq(importPresets.name, p.name)).get();
  const row = { name: p.name, target: p.target, mapping: JSON.stringify(p.mapping), options: JSON.stringify(p.options) };
  if (existing && existing.target === p.target) getDb().update(importPresets).set({ ...row, updatedAt: nowIso() }).where(eq(importPresets.id, existing.id)).run();
  else getDb().insert(importPresets).values({ id: newId(), ...row }).run();
  audit(ctx, 'import.preset', null, `Saved import mapping “${p.name}”`);
  return listPresets(p.target);
}

export function deletePreset(ctx: AuditContext, id: string) {
  const p = getDb().select().from(importPresets).where(eq(importPresets.id, id)).get();
  if (!p) throw notFound('Mapping');
  getDb().delete(importPresets).where(eq(importPresets.id, id)).run();
  audit(ctx, 'import.preset_delete', null, `Deleted import mapping “${p.name}”`);
}
