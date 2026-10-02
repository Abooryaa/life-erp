import { categorySchema, type CategoryInput } from '@life-erp/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { afterDbOpen, getDb, tx } from '../../db/client';
import { appMeta, budgetLines, categories, installments, recurringRules, transactions } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { parse } from '../../lib/validate';

export type Category = typeof categories.$inferSelect;

/** Default categories in English and Arabic. Users can rename, add, archive or delete them. */
const DEFAULTS: { kind: 'income' | 'expense'; name: string; ar: string; color: string; children?: [string, string][] }[] = [
  { kind: 'expense', name: 'Housing', ar: 'السكن', color: '#6366f1', children: [['Rent', 'الإيجار'], ['Utilities', 'المرافق'], ['Maintenance', 'الصيانة']] },
  { kind: 'expense', name: 'Food', ar: 'الطعام', color: '#f59e0b', children: [['Groceries', 'البقالة'], ['Restaurants', 'المطاعم'], ['Coffee', 'القهوة']] },
  { kind: 'expense', name: 'Transportation', ar: 'المواصلات', color: '#0ea5e9', children: [['Fuel', 'الوقود'], ['Ride-hailing', 'تطبيقات التوصيل'], ['Car maintenance', 'صيانة السيارة'], ['Parking & tolls', 'الجراج والرسوم']] },
  { kind: 'expense', name: 'Shopping', ar: 'التسوق', color: '#ec4899', children: [['Clothes', 'الملابس'], ['Electronics', 'الإلكترونيات'], ['Home', 'المنزل']] },
  { kind: 'expense', name: 'Bills & subscriptions', ar: 'الفواتير والاشتراكات', color: '#8b5cf6', children: [['Mobile & internet', 'الموبايل والإنترنت'], ['Subscriptions', 'الاشتراكات']] },
  { kind: 'expense', name: 'Health', ar: 'الصحة', color: '#ef4444', children: [['Doctor', 'الطبيب'], ['Pharmacy', 'الصيدلية'], ['Fitness', 'الرياضة']] },
  { kind: 'expense', name: 'Education', ar: 'التعليم', color: '#14b8a6', children: [['Courses', 'الدورات'], ['Books', 'الكتب']] },
  { kind: 'expense', name: 'Family', ar: 'العائلة', color: '#f97316', children: [['Family support', 'دعم العائلة'], ['Gifts', 'الهدايا']] },
  { kind: 'expense', name: 'Entertainment', ar: 'الترفيه', color: '#a855f7', children: [['Outings', 'الخروجات'], ['Travel', 'السفر']] },
  { kind: 'expense', name: 'Business', ar: 'العمل', color: '#64748b', children: [['Materials', 'الخامات'], ['Contractors', 'المقاولون'], ['Marketing', 'التسويق'], ['Software', 'البرمجيات']] },
  { kind: 'expense', name: 'Fees & interest', ar: 'الرسوم والفوائد', color: '#78716c', children: [['Bank fees', 'رسوم بنكية'], ['Installment interest', 'فوائد الأقساط']] },
  { kind: 'expense', name: 'Charity', ar: 'الصدقات والزكاة', color: '#22c55e' },
  { kind: 'expense', name: 'Other', ar: 'أخرى', color: '#94a3b8' },
  { kind: 'income', name: 'Salary', ar: 'الراتب', color: '#16a34a' },
  { kind: 'income', name: 'Business income', ar: 'دخل الأعمال', color: '#0d9488' },
  { kind: 'income', name: 'Freelance', ar: 'العمل الحر', color: '#2563eb' },
  { kind: 'income', name: 'Investment returns', ar: 'عوائد الاستثمار', color: '#7c3aed' },
  { kind: 'income', name: 'Gifts received', ar: 'هدايا مستلمة', color: '#db2777' },
  { kind: 'income', name: 'Other income', ar: 'دخل آخر', color: '#94a3b8' },
];

/** Create the default categories once per database (never re-created after the user edits them). */
export function ensureDefaultCategories() {
  const db = getDb();
  if (db.select().from(appMeta).where(eq(appMeta.key, 'categories_seeded')).get()) return;
  tx(() => {
    DEFAULTS.forEach((c, i) => {
      const id = newId();
      db.insert(categories).values({ id, kind: c.kind, name: c.name, nameAr: c.ar, color: c.color, sortOrder: i }).run();
      c.children?.forEach(([en, arName], j) =>
        db.insert(categories).values({ id: newId(), parentId: id, kind: c.kind, name: en, nameAr: arName, color: c.color, sortOrder: j }).run(),
      );
    });
    db.insert(appMeta).values({ key: 'categories_seeded', value: nowIso() }).run();
  });
}

afterDbOpen(ensureDefaultCategories);

export function listCategories(opts: { includeArchived?: boolean } = {}) {
  const rows = getDb().select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)).all();
  return opts.includeArchived ? rows : rows.filter((c) => !c.archivedAt);
}

export function getCategory(id: string): Category {
  const c = getDb().select().from(categories).where(eq(categories.id, id)).get();
  if (!c) throw notFound('Category');
  return c;
}

/** A category and all its descendants (budgets and reports roll subcategories up). */
export function categorySubtree(id: string): string[] {
  const all = listCategories({ includeArchived: true });
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const c of all) if (c.parentId === out[i]) out.push(c.id);
  return out;
}

/** Top-level ancestor of each category, for roll-up reports. */
export function topLevelMap(): Map<string, Category> {
  const all = listCategories({ includeArchived: true });
  const byId = new Map(all.map((c) => [c.id, c]));
  const out = new Map<string, Category>();
  for (const c of all) {
    let top = c;
    for (let guard = 0; top.parentId && byId.get(top.parentId) && guard < 10; guard++) top = byId.get(top.parentId)!;
    out.set(c.id, top);
  }
  return out;
}

/** Validates that a category exists, is active and matches the expected kind. */
export function assertCategoryKind(id: string | null | undefined, kind: 'income' | 'expense', field = 'categoryId') {
  if (!id) return null;
  const c = getDb().select().from(categories).where(eq(categories.id, id)).get();
  const fail = (msg: string) => {
    throw new AppError(400, 'validation', msg, [{ path: field, message: msg }]);
  };
  if (!c) fail('Category not found');
  if (c!.archivedAt) fail(`Category "${c!.name}" is archived`);
  if (c!.kind !== kind) fail(kind === 'income' ? 'Choose an income category' : 'Choose an expense category');
  return c!;
}

export function createCategory(ctx: AuditContext, input: CategoryInput) {
  const data = parse(categorySchema, input);
  if (data.parentId) {
    const parent = getCategory(data.parentId);
    if (parent.kind !== data.kind) throw badRequest('A subcategory must have the same kind as its parent');
    if (parent.parentId) throw badRequest('Categories can be nested one level deep');
  }
  const siblings = listCategories({ includeArchived: true }).filter((c) => (c.parentId ?? null) === (data.parentId ?? null) && c.kind === data.kind);
  if (siblings.some((c) => c.name.toLowerCase() === data.name.toLowerCase())) throw conflict(`"${data.name}" already exists here`);
  const id = newId();
  getDb()
    .insert(categories)
    .values({ id, ...data, parentId: data.parentId ?? null, color: data.color ?? null, icon: data.icon ?? null, sortOrder: siblings.length })
    .run();
  audit(ctx, 'category.create', { type: 'category', id }, `Created ${data.kind} category "${data.name}"`);
  return getCategory(id);
}

export function updateCategory(ctx: AuditContext, id: string, input: Partial<CategoryInput>) {
  const before = getCategory(id);
  const data = parse(categorySchema, { ...before, ...input, kind: before.kind });
  if (data.parentId) {
    if (data.parentId === id) throw badRequest('A category cannot be its own parent');
    const parent = getCategory(data.parentId);
    if (parent.parentId) throw badRequest('Categories can be nested one level deep');
    if (listCategories({ includeArchived: true }).some((c) => c.parentId === id)) throw badRequest('This category has subcategories, so it cannot become a subcategory');
    if (parent.kind !== before.kind) throw badRequest('A subcategory must have the same kind as its parent');
  }
  getDb()
    .update(categories)
    .set({ name: data.name, nameAr: data.nameAr, parentId: data.parentId ?? null, color: data.color ?? null, icon: data.icon ?? null, updatedAt: nowIso() })
    .where(eq(categories.id, id))
    .run();
  audit(ctx, 'category.update', { type: 'category', id }, `Updated category "${data.name}"`, before, data);
  return getCategory(id);
}

export function setCategoryArchived(ctx: AuditContext, id: string, archived: boolean) {
  const c = getCategory(id);
  const ids = archived ? categorySubtree(id) : [id];
  getDb()
    .update(categories)
    .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
    .where(inArray(categories.id, ids))
    .run();
  audit(ctx, archived ? 'category.archive' : 'category.unarchive', { type: 'category', id }, `${archived ? 'Archived' : 'Restored'} category "${c.name}"`);
}

/** Only unused categories can be deleted; used ones are archived so reports stay correct. */
export function deleteCategory(ctx: AuditContext, id: string) {
  const c = getCategory(id);
  const ids = categorySubtree(id);
  const db = getDb();
  const used =
    db.select({ id: transactions.id }).from(transactions).where(and(inArray(transactions.categoryId, ids), isNull(transactions.deletedAt))).get() ||
    db.select({ id: budgetLines.id }).from(budgetLines).where(inArray(budgetLines.categoryId, ids)).get() ||
    db.select({ id: recurringRules.id }).from(recurringRules).where(and(inArray(recurringRules.categoryId, ids), isNull(recurringRules.deletedAt))).get() ||
    db.select({ id: installments.id }).from(installments).where(and(inArray(installments.categoryId, ids), isNull(installments.deletedAt))).get();
  if (used) throw badRequest(`"${c.name}" is in use. Archive it instead so your history stays correct.`);
  // Soft-deleted transactions may still reference it: detach them.
  db.update(transactions).set({ categoryId: null }).where(inArray(transactions.categoryId, ids)).run();
  db.delete(categories).where(inArray(categories.id, ids)).run();
  audit(ctx, 'category.delete', { type: 'category', id }, `Deleted category "${c.name}"`, c);
}
