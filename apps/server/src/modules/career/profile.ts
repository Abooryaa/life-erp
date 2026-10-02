import {
  achievementSchema,
  cvBullet,
  employmentSchema,
  learningSchema,
  minorToInput,
  skillSchema,
  tenureMonths,
  type AchievementInput,
  type EmploymentInput,
  type LearningInput,
  type SkillInput,
} from '@life-erp/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, tx } from '../../db/client';
import { achievementSkills, achievements, employments, learningItems, skills } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { AppError, conflict, notFound } from '../../lib/errors';
import { newId, nowIso } from '../../lib/ids';
import { registerEntity } from '../../lib/registry';
import { parse } from '../../lib/validate';
import { assertOrganization } from '../business/organizations';
import { assertCurrency, minorOf } from '../finance/currency';
import { assertGoal, assertPerson, today } from '../life/common';
import { reindexEntity } from '../search/service';
import { getTagsFor, setTagsFor } from '../tags/service';

const liveEmp = isNull(employments.deletedAt);
const liveSkill = isNull(skills.deletedAt);
const liveAch = isNull(achievements.deletedAt);
const liveLearn = isNull(learningItems.deletedAt);

// ---------- employment ----------

function withTenure<T extends { startDate: string; endDate: string | null }>(e: T) {
  return { ...e, current: !e.endDate || e.endDate >= today(), months: tenureMonths(e.startDate, e.endDate ?? today()) };
}

export function listEmployments() {
  return getDb().select().from(employments).where(liveEmp).orderBy(sql`case when ${employments.endDate} is null then 0 else 1 end`, desc(employments.startDate)).all().map(withTenure);
}

export function getEmployment(id: string) {
  const e = getDb().select().from(employments).where(and(eq(employments.id, id), liveEmp)).get();
  if (!e) throw notFound('Job');
  return { ...withTenure(e), achievements: listAchievements({ employmentId: id }), tags: getTagsFor('employment', id) };
}

function validateEmployment(data: ReturnType<typeof employmentSchema.parse>) {
  assertOrganization(data.organizationId);
  assertPerson(data.managerPersonId, 'managerPersonId');
  assertCurrency(data.currency);
  const { tags: _t, ...row } = data;
  return {
    ...row,
    organizationId: data.organizationId ?? null,
    managerPersonId: data.managerPersonId ?? null,
    endDate: data.endDate ?? null,
    salary: data.salary ? minorOf(data.salary, data.currency, 'salary') : null,
  };
}

export function createEmployment(ctx: AuditContext, input: EmploymentInput) {
  const data = parse(employmentSchema, input);
  const row = validateEmployment(data);
  const id = newId();
  getDb().insert(employments).values({ id, ...row }).run();
  if (data.tags?.length) setTagsFor('employment', id, data.tags);
  audit(ctx, 'employment.create', { type: 'employment', id }, `Added job: ${row.position} at ${row.company}`);
  reindexEntity('employment', id);
  return getEmployment(id);
}

export function updateEmployment(ctx: AuditContext, id: string, input: Partial<EmploymentInput>) {
  const before = getEmployment(id);
  const data = parse(employmentSchema, { ...before, salary: before.salary == null ? null : minorToInput(before.salary, before.currency), ...input });
  getDb().update(employments).set({ ...validateEmployment(data), updatedAt: nowIso() }).where(eq(employments.id, id)).run();
  if (input.tags) setTagsFor('employment', id, input.tags);
  audit(ctx, 'employment.update', { type: 'employment', id }, `Updated job at ${data.company}`, before, data);
  reindexEntity('employment', id);
  return getEmployment(id);
}

export function deleteEmployment(ctx: AuditContext, id: string) {
  const e = getEmployment(id);
  getDb().update(achievements).set({ employmentId: null }).where(eq(achievements.employmentId, id)).run();
  getDb().update(employments).set({ deletedAt: nowIso() }).where(eq(employments.id, id)).run();
  audit(ctx, 'employment.delete', { type: 'employment', id }, `Deleted job at ${e.company}`, e);
  reindexEntity('employment', id);
}

// ---------- skills ----------

export function listSkills() {
  const rows = getDb().select().from(skills).where(liveSkill).orderBy(asc(skills.category), asc(skills.name)).all();
  const counts = new Map(
    getDb()
      .select({ id: achievementSkills.skillId, n: sql<number>`count(*)` })
      .from(achievementSkills)
      .groupBy(achievementSkills.skillId)
      .all()
      .map((r) => [r.id, r.n]),
  );
  return rows.map((s) => ({ ...s, achievementCount: counts.get(s.id) ?? 0, gap: s.targetLevel == null ? 0 : Math.max(0, s.targetLevel - s.level) }));
}

function getSkill(id: string) {
  const s = getDb().select().from(skills).where(and(eq(skills.id, id), liveSkill)).get();
  if (!s) throw notFound('Skill');
  return s;
}

export function createSkill(ctx: AuditContext, input: SkillInput) {
  const data = parse(skillSchema, input);
  assertGoal(data.goalId);
  if (getDb().select().from(skills).where(and(liveSkill, sql`lower(${skills.name}) = lower(${data.name})`)).get()) throw conflict(`You already track “${data.name}”`);
  const id = newId();
  getDb()
    .insert(skills)
    .values({ id, ...data, targetLevel: data.targetLevel ?? null, lastUsed: data.lastUsed ?? null, goalId: data.goalId ?? null })
    .run();
  audit(ctx, 'skill.create', { type: 'skill', id }, `Added skill ${data.name} (level ${data.level})`);
  reindexEntity('skill', id);
  return getSkill(id);
}

export function updateSkill(ctx: AuditContext, id: string, input: Partial<SkillInput>) {
  const before = getSkill(id);
  const data = parse(skillSchema, { ...before, ...input });
  assertGoal(data.goalId);
  getDb()
    .update(skills)
    .set({ ...data, targetLevel: data.targetLevel ?? null, lastUsed: data.lastUsed ?? null, goalId: data.goalId ?? null, updatedAt: nowIso() })
    .where(eq(skills.id, id))
    .run();
  audit(ctx, before.level !== data.level ? 'skill.level' : 'skill.update', { type: 'skill', id }, before.level !== data.level ? `${data.name}: level ${before.level} → ${data.level}` : `Updated skill ${data.name}`, before, data);
  reindexEntity('skill', id);
  return getSkill(id);
}

export function deleteSkill(ctx: AuditContext, id: string) {
  const s = getSkill(id);
  getDb().update(learningItems).set({ skillId: null }).where(eq(learningItems.skillId, id)).run();
  getDb().delete(achievementSkills).where(eq(achievementSkills.skillId, id)).run();
  getDb().update(skills).set({ deletedAt: nowIso() }).where(eq(skills.id, id)).run();
  audit(ctx, 'skill.delete', { type: 'skill', id }, `Deleted skill ${s.name}`, s);
  reindexEntity('skill', id);
}

// ---------- achievements ----------

export function listAchievements(f: { employmentId?: string; skillId?: string } = {}) {
  const conds = [liveAch];
  if (f.employmentId) conds.push(eq(achievements.employmentId, f.employmentId));
  if (f.skillId) {
    const ids = getDb().select({ id: achievementSkills.achievementId }).from(achievementSkills).where(eq(achievementSkills.skillId, f.skillId)).all().map((r) => r.id);
    conds.push(inArray(achievements.id, ids.length ? ids : ['-']));
  }
  const rows = getDb().select().from(achievements).where(and(...conds)).orderBy(desc(achievements.date)).all();
  const links = rows.length
    ? getDb()
        .select({ achievementId: achievementSkills.achievementId, skillId: skills.id, name: skills.name })
        .from(achievementSkills)
        .innerJoin(skills, eq(skills.id, achievementSkills.skillId))
        .where(inArray(achievementSkills.achievementId, rows.map((r) => r.id)))
        .all()
    : [];
  return rows.map((a) => {
    const sk = links.filter((l) => l.achievementId === a.id);
    return {
      ...a,
      skills: sk.map((l) => ({ id: l.skillId, name: l.name })),
      // Your own wording wins; otherwise a bullet assembled from the facts you recorded.
      bullet: a.cvBullet || cvBullet({ title: a.title, metric: a.metric, impact: a.impact, skills: sk.map((l) => l.name) }),
    };
  });
}

function getAchievement(id: string) {
  const a = listAchievements().find((x) => x.id === id);
  if (!a) throw notFound('Achievement');
  return { ...a, tags: getTagsFor('achievement', id) };
}

function writeAchievement(id: string, data: ReturnType<typeof achievementSchema.parse>, isNew: boolean) {
  const emp = data.employmentId ? getEmployment(data.employmentId) : null;
  for (const sid of data.skillIds) getSkill(sid);
  const row = {
    date: data.date,
    employmentId: data.employmentId ?? null,
    company: data.company ?? emp?.company ?? null,
    role: data.role ?? emp?.position ?? null,
    title: data.title,
    description: data.description,
    metric: data.metric,
    impact: data.impact,
    cvRelevance: data.cvRelevance,
    cvBullet: data.cvBullet,
  };
  tx((db) => {
    if (isNew) db.insert(achievements).values({ id, ...row }).run();
    else db.update(achievements).set({ ...row, updatedAt: nowIso() }).where(eq(achievements.id, id)).run();
    db.delete(achievementSkills).where(eq(achievementSkills.achievementId, id)).run();
    for (const sid of new Set(data.skillIds)) db.insert(achievementSkills).values({ achievementId: id, skillId: sid }).run();
    // Using a skill for an achievement keeps "last used" current.
    if (data.skillIds.length) db.update(skills).set({ lastUsed: data.date }).where(and(inArray(skills.id, data.skillIds), sql`coalesce(${skills.lastUsed}, '') < ${data.date}`)).run();
  });
}

export function createAchievement(ctx: AuditContext, input: AchievementInput) {
  const data = parse(achievementSchema, input);
  const id = newId();
  writeAchievement(id, data, true);
  if (data.tags?.length) setTagsFor('achievement', id, data.tags);
  audit(ctx, 'achievement.create', { type: 'achievement', id }, `Achievement: ${data.title}`);
  reindexEntity('achievement', id);
  return getAchievement(id);
}

export function updateAchievement(ctx: AuditContext, id: string, input: Partial<AchievementInput>) {
  const before = getAchievement(id);
  const data = parse(achievementSchema, { ...before, skillIds: before.skills.map((s) => s.id), ...input });
  writeAchievement(id, data, false);
  if (input.tags) setTagsFor('achievement', id, input.tags);
  audit(ctx, 'achievement.update', { type: 'achievement', id }, `Updated achievement: ${data.title}`, before, data);
  reindexEntity('achievement', id);
  return getAchievement(id);
}

export function deleteAchievement(ctx: AuditContext, id: string) {
  const a = getAchievement(id);
  getDb().update(achievements).set({ deletedAt: nowIso() }).where(eq(achievements.id, id)).run();
  audit(ctx, 'achievement.delete', { type: 'achievement', id }, `Deleted achievement: ${a.title}`, a);
  reindexEntity('achievement', id);
}

/**
 * CV bullets grouped by job (most relevant first) as plain text/Markdown, ready to paste into a CV.
 * Only facts you recorded are used.
 */
export function cvExport(minRelevance = 1) {
  const all = listAchievements().filter((a) => a.cvRelevance >= minRelevance);
  const jobs = listEmployments();
  const lines: string[] = [];
  for (const j of jobs) {
    const mine = all.filter((a) => a.employmentId === j.id).sort((a, b) => b.cvRelevance - a.cvRelevance || b.date.localeCompare(a.date));
    if (!mine.length) continue;
    lines.push(`## ${j.position} — ${j.company} (${j.startDate.slice(0, 7)} – ${j.endDate ? j.endDate.slice(0, 7) : 'present'})`, '');
    for (const a of mine) lines.push(`- ${a.bullet}`);
    lines.push('');
  }
  const other = all.filter((a) => !a.employmentId);
  if (other.length) {
    lines.push('## Other achievements', '');
    for (const a of other) lines.push(`- ${a.bullet}`);
  }
  return lines.join('\n').trim();
}

// ---------- learning ----------

export function listLearning(f: { status?: string; skillId?: string } = {}) {
  const conds = [liveLearn];
  if (f.status) conds.push(eq(learningItems.status, f.status));
  if (f.skillId) conds.push(eq(learningItems.skillId, f.skillId));
  return getDb()
    .select({ l: learningItems, skillName: skills.name })
    .from(learningItems)
    .leftJoin(skills, eq(skills.id, learningItems.skillId))
    .where(and(...conds))
    .orderBy(sql`case ${learningItems.status} when 'in_progress' then 0 when 'planned' then 1 when 'paused' then 2 else 3 end`, asc(learningItems.deadline))
    .all()
    .map((x) => ({ ...x.l, skillName: x.skillName }));
}

function getLearning(id: string) {
  const l = listLearning().find((x) => x.id === id);
  if (!l) throw notFound('Learning item');
  return { ...l, tags: getTagsFor('learning', id) };
}

function validateLearning(data: ReturnType<typeof learningSchema.parse>) {
  if (data.skillId) getSkill(data.skillId);
  assertGoal(data.goalId);
  assertCurrency(data.currency);
  if (data.startDate && data.deadline && data.deadline < data.startDate) throw new AppError(400, 'validation', 'Deadline must be after the start date', [{ path: 'deadline', message: 'Must be after the start date' }]);
  // Completing means 100%; reaching 100% means completed.
  const status = data.progress === 100 && data.status !== 'dropped' ? 'completed' : data.status;
  const progress = status === 'completed' ? 100 : data.progress;
  const { tags: _t, ...row } = data;
  return {
    ...row,
    status,
    progress,
    skillId: data.skillId ?? null,
    goalId: data.goalId ?? null,
    // Starting now is assumed only when that can't contradict an earlier deadline.
    startDate: data.startDate ?? (status === 'in_progress' && (!data.deadline || data.deadline >= today()) ? today() : null),
    deadline: data.deadline ?? null,
    cost: data.cost ? minorOf(data.cost, data.currency, 'cost') : null,
  };
}

export function createLearning(ctx: AuditContext, input: LearningInput) {
  const data = parse(learningSchema, input);
  const row = validateLearning(data);
  const id = newId();
  getDb()
    .insert(learningItems)
    .values({ id, ...row, completedAt: row.status === 'completed' ? today() : null })
    .run();
  if (data.tags?.length) setTagsFor('learning', id, data.tags);
  audit(ctx, 'learning.create', { type: 'learning', id }, `Learning: ${row.title}`);
  reindexEntity('learning', id);
  return getLearning(id);
}

export function updateLearning(ctx: AuditContext, id: string, input: Partial<LearningInput>) {
  const before = getLearning(id);
  const data = parse(learningSchema, { ...before, cost: before.cost == null ? null : minorToInput(before.cost, before.currency), ...input });
  const row = validateLearning(data);
  getDb()
    .update(learningItems)
    .set({ ...row, completedAt: row.status === 'completed' ? (before.completedAt ?? today()) : null, updatedAt: nowIso() })
    .where(eq(learningItems.id, id))
    .run();
  if (input.tags) setTagsFor('learning', id, input.tags);
  audit(ctx, row.status === 'completed' && before.status !== 'completed' ? 'learning.complete' : 'learning.update', { type: 'learning', id }, `${row.title}: ${row.status} ${row.progress}%`);
  reindexEntity('learning', id);
  return getLearning(id);
}

export function deleteLearning(ctx: AuditContext, id: string) {
  const l = getLearning(id);
  getDb().update(learningItems).set({ deletedAt: nowIso() }).where(eq(learningItems.id, id)).run();
  audit(ctx, 'learning.delete', { type: 'learning', id }, `Deleted learning item ${l.title}`, l);
  reindexEntity('learning', id);
}

// ---------- registry (links, tags, search) ----------

registerEntity({
  type: 'employment',
  exists: (id) => !!getDb().select({ id: employments.id }).from(employments).where(and(eq(employments.id, id), liveEmp)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(employments)
      .where(and(inArray(employments.id, ids), liveEmp))
      .all()
      .map((e) => ({ id: e.id, type: 'employment', title: `${e.position} — ${e.company}`, url: `/career/jobs/${e.id}`, subtitle: e.startDate })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(employments)
      .where(ids ? and(inArray(employments.id, ids), liveEmp) : liveEmp)
      .all()
      .map((e) => ({ id: e.id, title: `${e.position} — ${e.company}`, body: [e.department, e.location, e.responsibilities, e.notes].filter(Boolean).join('\n') })),
});
registerEntity({
  type: 'skill',
  exists: (id) => !!getDb().select({ id: skills.id }).from(skills).where(and(eq(skills.id, id), liveSkill)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(skills)
      .where(and(inArray(skills.id, ids), liveSkill))
      .all()
      .map((s) => ({ id: s.id, type: 'skill', title: s.name, url: `/career/skills?open=${s.id}`, subtitle: `Level ${s.level}` })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(skills)
      .where(ids ? and(inArray(skills.id, ids), liveSkill) : liveSkill)
      .all()
      .map((s) => ({ id: s.id, title: s.name, body: [s.category, s.evidence, s.notes].filter(Boolean).join('\n') })),
});
registerEntity({
  type: 'achievement',
  exists: (id) => !!getDb().select({ id: achievements.id }).from(achievements).where(and(eq(achievements.id, id), liveAch)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(achievements)
      .where(and(inArray(achievements.id, ids), liveAch))
      .all()
      .map((a) => ({ id: a.id, type: 'achievement', title: a.title, url: `/career/achievements?open=${a.id}`, subtitle: a.company })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(achievements)
      .where(ids ? and(inArray(achievements.id, ids), liveAch) : liveAch)
      .all()
      .map((a) => ({ id: a.id, title: a.title, body: [a.description, a.metric, a.impact, a.company, a.role].filter(Boolean).join('\n') })),
});
registerEntity({
  type: 'learning',
  exists: (id) => !!getDb().select({ id: learningItems.id }).from(learningItems).where(and(eq(learningItems.id, id), liveLearn)).get(),
  resolve: (ids) =>
    getDb()
      .select()
      .from(learningItems)
      .where(and(inArray(learningItems.id, ids), liveLearn))
      .all()
      .map((l) => ({ id: l.id, type: 'learning', title: l.title, url: `/career/learning?open=${l.id}`, subtitle: l.provider })),
  searchDocs: (ids) =>
    getDb()
      .select()
      .from(learningItems)
      .where(ids ? and(inArray(learningItems.id, ids), liveLearn) : liveLearn)
      .all()
      .map((l) => ({ id: l.id, title: l.title, body: [l.provider, l.type, l.notes].filter(Boolean).join('\n') })),
});
