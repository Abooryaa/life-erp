import { ASSET_LIQUIDITY, ASSET_TYPES, LIFE_AREAS, ORG_TYPES, parseAmount, parseDateAs, RELATIONSHIPS, TASK_STATUSES, type ImportOptions, type ImportTarget } from '@life-erp/shared';
import type { AuditContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { createOrganization, deleteOrganization } from '../business/organizations';
import { createApplication, deleteApplication, listStatuses } from '../career/applications';
import { getAccount } from '../finance/accounts';
import { listCategories } from '../finance/categories';
import { createTransaction, deleteTransaction } from '../finance/transactions';
import { createAsset, deleteAsset } from '../insights/assets';
import { createPerson, deletePerson } from '../life/people';
import { createTask, deleteTask } from '../life/tasks';
import { getSettings } from '../settings/service';

export type FieldKind = 'text' | 'date' | 'amount' | 'number' | 'list';

export interface ImportField {
  key: string;
  kind: FieldKind;
  required?: boolean;
  /** Column names that map to this field automatically (lower-case, any language). */
  synonyms: string[];
}

export interface BuildResult {
  id: string;
  summary: string;
  warnings: string[];
}

export interface TargetDef {
  entityType: string;
  fields: ImportField[];
  build(ctx: AuditContext, v: Record<string, string>, o: ImportOptions, allowDuplicate: boolean): BuildResult;
  undo(ctx: AuditContext, id: string): void;
}

const rowError = (field: string, message: string): never => {
  throw new AppError(400, 'validation', message, [{ path: field, message }]);
};
const text = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
const date = (v: Record<string, string>, k: string, o: ImportOptions) => {
  if (!text(v[k])) return null;
  return parseDateAs(v[k], o.dateFormat) ?? rowError(k, `“${v[k]}” is not a ${o.dateFormat} date`);
};
const amount = (v: Record<string, string>, k: string, o: ImportOptions) => {
  if (!text(v[k])) return null;
  return parseAmount(v[k], o.decimal) ?? rowError(k, `“${v[k]}” is not an amount`);
};
/** Accept a listed value written loosely ("In progress" → in_progress); otherwise use the default and say so. */
function pick<T extends string>(raw: string | undefined, list: readonly T[], fallback: T | null, label: string, warnings: string[]): T | null {
  const s = text(raw);
  if (!s) return fallback;
  const key = s.toLowerCase().replace(/[\s-]+/g, '_');
  const hit = list.find((x) => x === key);
  if (hit) return hit;
  warnings.push(`${label} “${s}” not recognised — ${fallback ?? 'left empty'}`);
  return fallback;
}
const tagsOf = (v: string | undefined) =>
  (text(v) ?? '')
    .split(/[,;|]/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 10);

const S = {
  date: ['date', 'transaction date', 'posting date', 'value date', 'booking date', 'تاريخ', 'التاريخ', 'تاريخ العملية'],
  amount: ['amount', 'value', 'sum', 'المبلغ', 'القيمة'],
  in: ['credit', 'deposit', 'deposits', 'money in', 'in', 'paid in', 'دائن', 'إيداع', 'ايداع'],
  out: ['debit', 'withdrawal', 'withdrawals', 'money out', 'out', 'paid out', 'مدين', 'سحب'],
  description: ['description', 'details', 'narrative', 'memo', 'transaction details', 'reference', 'البيان', 'الوصف', 'التفاصيل'],
  payee: ['payee', 'merchant', 'beneficiary', 'counterparty', 'المستفيد'],
  category: ['category', 'التصنيف', 'الفئة'],
  notes: ['notes', 'note', 'comment', 'comments', 'ملاحظات'],
  name: ['name', 'full name', 'fullname', 'contact', 'contact name', 'الاسم'],
  phone: ['phone', 'mobile', 'tel', 'telephone', 'phone number', 'الهاتف', 'الموبايل', 'رقم الهاتف'],
  email: ['email', 'e-mail', 'mail', 'البريد', 'البريد الإلكتروني'],
  company: ['company', 'organization', 'organisation', 'employer', 'الشركة'],
  city: ['city', 'المدينة'],
  tags: ['tags', 'labels', 'الوسوم'],
};

const ACCOUNT_REQUIRED = () => rowError('accountId', 'Choose the account these transactions belong to');

export const TARGETS: Record<ImportTarget, TargetDef> = {
  transactions: {
    entityType: 'transaction',
    fields: [
      { key: 'date', kind: 'date', required: true, synonyms: S.date },
      { key: 'amount', kind: 'amount', synonyms: S.amount },
      { key: 'moneyIn', kind: 'amount', synonyms: S.in },
      { key: 'moneyOut', kind: 'amount', synonyms: S.out },
      { key: 'description', kind: 'text', synonyms: S.description },
      { key: 'payee', kind: 'text', synonyms: S.payee },
      { key: 'category', kind: 'list', synonyms: S.category },
      { key: 'notes', kind: 'text', synonyms: S.notes },
    ],
    build(ctx, v, o, allowDuplicate) {
      if (!o.accountId) ACCOUNT_REQUIRED();
      const account = getAccount(o.accountId!);
      const d = date(v, 'date', o) ?? rowError('date', 'Date is required');
      let signed: string | null;
      if (o.amountMode === 'split') {
        const inn = amount(v, 'moneyIn', o);
        const out = amount(v, 'moneyOut', o);
        const a = inn && Number(inn) !== 0 ? Math.abs(Number(inn)) : 0;
        const b = out && Number(out) !== 0 ? Math.abs(Number(out)) : 0;
        if (a && b) rowError('moneyIn', 'Both money in and money out are filled');
        signed = a ? String(inn).replace('-', '') : b ? `-${String(out).replace('-', '')}` : null;
      } else signed = amount(v, 'amount', o);
      if (!signed || Number(signed) === 0) rowError(o.amountMode === 'split' ? 'moneyIn' : 'amount', 'No amount');
      const isIncome = Number(signed) > 0;
      const kind = isIncome ? 'income' : 'expense';
      const warnings: string[] = [];
      // Category by name (English or Arabic, case-insensitive) of the right kind, else your default for that kind.
      const wanted = text(v.category)?.toLowerCase();
      const cats = listCategories().filter((c) => c.kind === kind);
      let categoryId = wanted ? cats.find((c) => c.name.toLowerCase() === wanted || c.nameAr?.toLowerCase() === wanted)?.id : undefined;
      if (wanted && !categoryId) warnings.push(`Category “${v.category}” not found — default used`);
      categoryId ??= (isIncome ? o.defaultIncomeCategoryId : o.defaultExpenseCategoryId) ?? undefined;
      if (!categoryId) rowError('category', `No ${kind} category — pick a default ${kind} category`);
      const description = text(v.description);
      const t = createTransaction(ctx, {
        type: kind,
        date: d,
        amount: signed!.replace('-', ''),
        accountId: account.id,
        categoryId,
        payee: text(v.payee),
        description: description?.slice(0, 300) ?? null,
        notes: text(v.notes),
        workspaceId: o.workspaceId ?? account.workspaceId ?? null,
        allowDuplicate,
      });
      return { id: t.id, summary: `${d} · ${isIncome ? '+' : '−'}${signed!.replace('-', '')} ${account.currency} · ${description ?? text(v.payee) ?? ''}`.trim(), warnings };
    },
    undo: deleteTransaction,
  },

  people: {
    entityType: 'person',
    fields: [
      { key: 'fullName', kind: 'text', required: true, synonyms: S.name },
      { key: 'phone', kind: 'text', synonyms: S.phone },
      { key: 'email', kind: 'text', synonyms: S.email },
      { key: 'company', kind: 'text', synonyms: S.company },
      { key: 'role', kind: 'text', synonyms: ['role', 'title', 'job title', 'position', 'المسمى الوظيفي'] },
      { key: 'relationship', kind: 'list', synonyms: ['relationship', 'type', 'العلاقة'] },
      { key: 'city', kind: 'text', synonyms: S.city },
      { key: 'birthday', kind: 'date', synonyms: ['birthday', 'birth date', 'date of birth', 'dob', 'تاريخ الميلاد'] },
      { key: 'notes', kind: 'text', synonyms: S.notes },
      { key: 'tags', kind: 'text', synonyms: S.tags },
    ],
    build(ctx, v, o) {
      const warnings: string[] = [];
      const p = createPerson(ctx, {
        fullName: text(v.fullName) ?? rowError('fullName', 'Name is required'),
        phone: text(v.phone),
        email: text(v.email),
        company: text(v.company),
        role: text(v.role),
        relationship: pick(v.relationship, RELATIONSHIPS, 'other', 'Relationship', warnings)!,
        city: text(v.city),
        birthday: date(v, 'birthday', o),
        notes: text(v.notes),
        workspaceId: o.workspaceId ?? null,
        tags: tagsOf(v.tags),
      });
      return { id: p.id, summary: [p.fullName, text(v.phone), text(v.email)].filter(Boolean).join(' · '), warnings };
    },
    undo: deletePerson,
  },

  organizations: {
    entityType: 'organization',
    fields: [
      { key: 'name', kind: 'text', required: true, synonyms: ['name', 'company', 'company name', 'organization', 'الاسم', 'الشركة'] },
      { key: 'type', kind: 'list', synonyms: ['type', 'النوع'] },
      { key: 'industry', kind: 'text', synonyms: ['industry', 'sector', 'المجال'] },
      { key: 'phone', kind: 'text', synonyms: S.phone },
      { key: 'email', kind: 'text', synonyms: S.email },
      { key: 'website', kind: 'text', synonyms: ['website', 'web', 'url', 'site', 'الموقع'] },
      { key: 'city', kind: 'text', synonyms: S.city },
      { key: 'address', kind: 'text', synonyms: ['address', 'العنوان'] },
      { key: 'notes', kind: 'text', synonyms: S.notes },
    ],
    build(ctx, v) {
      const warnings: string[] = [];
      const org = createOrganization(ctx, {
        name: text(v.name) ?? rowError('name', 'Name is required'),
        type: pick(v.type, ORG_TYPES, 'company', 'Type', warnings)!,
        industry: text(v.industry),
        phone: text(v.phone),
        email: text(v.email),
        website: text(v.website),
        city: text(v.city),
        address: text(v.address),
        notes: text(v.notes),
      });
      return { id: org.id, summary: [org.name, text(v.city)].filter(Boolean).join(' · '), warnings };
    },
    undo: deleteOrganization,
  },

  tasks: {
    entityType: 'task',
    fields: [
      { key: 'title', kind: 'text', required: true, synonyms: ['title', 'task', 'name', 'subject', 'المهمة', 'العنوان'] },
      { key: 'dueDate', kind: 'date', synonyms: ['due', 'due date', 'deadline', 'date', 'الموعد', 'تاريخ الاستحقاق'] },
      { key: 'priority', kind: 'number', synonyms: ['priority', 'الأولوية'] },
      { key: 'status', kind: 'list', synonyms: ['status', 'state', 'الحالة'] },
      { key: 'area', kind: 'list', synonyms: ['area', 'المجال'] },
      { key: 'description', kind: 'text', synonyms: ['description', 'details', 'notes', 'الوصف'] },
      { key: 'tags', kind: 'text', synonyms: S.tags },
    ],
    build(ctx, v, o) {
      const warnings: string[] = [];
      const pr = text(v.priority);
      let priority = 3;
      if (pr) {
        const n = Number(pr);
        if (Number.isInteger(n) && n >= 1 && n <= 4) priority = n;
        else warnings.push(`Priority “${pr}” not 1–4 — 3 used`);
      }
      const due = date(v, 'dueDate', o);
      const t = createTask(ctx, {
        title: text(v.title) ?? rowError('title', 'Title is required'),
        dueDate: due,
        priority,
        status: pick(v.status, TASK_STATUSES, due ? 'planned' : 'inbox', 'Status', warnings)!,
        area: pick(v.area, LIFE_AREAS, null, 'Area', warnings),
        description: text(v.description),
        workspaceId: o.workspaceId ?? null,
        tags: tagsOf(v.tags),
      });
      return { id: t.id, summary: [t.title, due].filter(Boolean).join(' · '), warnings };
    },
    undo: deleteTask,
  },

  assets: {
    entityType: 'asset',
    fields: [
      { key: 'name', kind: 'text', required: true, synonyms: ['name', 'asset', 'الأصل', 'الاسم'] },
      { key: 'type', kind: 'list', synonyms: ['type', 'kind', 'النوع'] },
      { key: 'currentValue', kind: 'amount', required: true, synonyms: ['value', 'current value', 'worth', 'market value', 'القيمة', 'القيمة الحالية'] },
      { key: 'purchasePrice', kind: 'amount', synonyms: ['purchase price', 'cost', 'bought for', 'سعر الشراء'] },
      { key: 'purchaseDate', kind: 'date', synonyms: ['purchase date', 'bought on', 'date', 'تاريخ الشراء'] },
      { key: 'quantity', kind: 'number', synonyms: ['quantity', 'qty', 'units', 'الكمية'] },
      { key: 'unit', kind: 'text', synonyms: ['unit', 'الوحدة'] },
      { key: 'currency', kind: 'text', synonyms: ['currency', 'العملة'] },
      { key: 'liquidity', kind: 'list', synonyms: ['liquidity', 'السيولة'] },
      { key: 'notes', kind: 'text', synonyms: S.notes },
    ],
    build(ctx, v, o) {
      const warnings: string[] = [];
      const type = pick(v.type, ASSET_TYPES, 'other', 'Type', warnings)!;
      const q = text(v.quantity);
      const qn = q ? Number(parseAmount(q, o.decimal)) : null;
      if (q && (qn == null || Number.isNaN(qn))) rowError('quantity', `“${q}” is not a number`);
      const currentValue = amount(v, 'currentValue', o) ?? rowError('currentValue', 'Value is required');
      const a = createAsset(ctx, {
        name: text(v.name) ?? rowError('name', 'Name is required'),
        type,
        liquidity: pick(v.liquidity, ASSET_LIQUIDITY, ['gold', 'stocks', 'fund', 'crypto'].includes(type) ? 'liquid' : 'non_liquid', 'Liquidity', warnings)!,
        currency: (text(v.currency) ?? getSettings().baseCurrency).toUpperCase(),
        currentValue,
        purchasePrice: amount(v, 'purchasePrice', o),
        purchaseDate: date(v, 'purchaseDate', o),
        quantity: qn,
        unit: text(v.unit),
        notes: text(v.notes),
        workspaceId: o.workspaceId ?? null,
      });
      return { id: a.id, summary: `${a.name} · ${currentValue} ${a.currency}`, warnings };
    },
    undo: deleteAsset,
  },

  applications: {
    entityType: 'job_application',
    fields: [
      { key: 'company', kind: 'text', required: true, synonyms: ['company', 'employer', 'organization', 'الشركة'] },
      { key: 'position', kind: 'text', required: true, synonyms: ['position', 'role', 'job', 'job title', 'title', 'الوظيفة', 'المسمى الوظيفي'] },
      { key: 'appliedDate', kind: 'date', synonyms: ['applied', 'applied on', 'date applied', 'application date', 'date', 'تاريخ التقديم'] },
      { key: 'status', kind: 'list', synonyms: ['status', 'stage', 'الحالة'] },
      { key: 'source', kind: 'text', synonyms: ['source', 'via', 'platform', 'المصدر'] },
      { key: 'location', kind: 'text', synonyms: ['location', 'city', 'المكان'] },
      { key: 'url', kind: 'text', synonyms: ['url', 'link', 'job link', 'الرابط'] },
      { key: 'salaryMin', kind: 'amount', synonyms: ['salary', 'salary from', 'salary min', 'الراتب'] },
      { key: 'salaryMax', kind: 'amount', synonyms: ['salary to', 'salary max'] },
      { key: 'notes', kind: 'text', synonyms: S.notes },
    ],
    build(ctx, v, o) {
      const warnings: string[] = [];
      const wanted = text(v.status)?.toLowerCase();
      const st = wanted ? listStatuses().find((s) => s.name.toLowerCase() === wanted) : undefined;
      if (wanted && !st) warnings.push(`Status “${v.status}” not found — set from the applied date`);
      const a = createApplication(ctx, {
        company: text(v.company) ?? rowError('company', 'Company is required'),
        position: text(v.position) ?? rowError('position', 'Position is required'),
        appliedDate: date(v, 'appliedDate', o),
        statusId: st?.id ?? null,
        source: text(v.source),
        location: text(v.location),
        url: text(v.url),
        salaryMin: amount(v, 'salaryMin', o),
        salaryMax: amount(v, 'salaryMax', o),
        notes: text(v.notes),
      });
      return { id: a.id, summary: `${a.position} — ${a.company} · ${a.statusName}`, warnings };
    },
    undo: deleteApplication,
  },
};
