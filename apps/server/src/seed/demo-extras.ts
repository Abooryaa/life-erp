import { Readable } from 'node:stream';
import { addDays, addMonths, defaultReviewPeriod, monthStart } from '@life-erp/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { goals, jobApplications, learningItems, opportunities, projects, tasks } from '../db/schema';
import { setValues } from '../modules/automation/custom-fields';
import { listDefs } from '../modules/automation/custom-fields';
import { commitImport, savePreset } from '../modules/automation/import';
import { withoutAutomations } from '../modules/automation/engine';
import { addRelation, createOrganization, listOrganizations } from '../modules/business/organizations';
import { createOpportunity, listOpportunities, listPipelines, moveOpportunity } from '../modules/business/pipeline';
import { addMilestone, createProject, listProjects, updateProject } from '../modules/business/projects';
import { addInterview, createApplication, listApplications, listStatuses } from '../modules/career/applications';
import { listEmployments, listLearning } from '../modules/career/profile';
import { createDocument } from '../modules/documents/service';
import { storeUpload } from '../modules/documents/files';
import { listAccounts } from '../modules/finance/accounts';
import { listCategories } from '../modules/finance/categories';
import { todayLocal } from '../modules/finance/jobs';
import { createTransaction, listTransactions } from '../modules/finance/transactions';
import { saveReview } from '../modules/insights/reviews';
import { createScenario } from '../modules/insights/scenarios';
import { createEvent } from '../modules/life/events';
import { addCheckin } from '../modules/life/goals';
import { createNote } from '../modules/life/notes';
import { addInteraction, createPerson, listPeople } from '../modules/life/people';
import { createTask, updateTask } from '../modules/life/tasks';
import { getConfig } from '../runtime';

type Ctx = { userId: string };
type Ws = { personal: string; mma: string; basira: string };

/**
 * Everything that makes the demo feel lived-in: a year of business history, documents,
 * a fuller network of people, finished work, reviews and the automation/import features in use.
 * Demo data only — runs exclusively against the separate demo data folder.
 */
export async function seedDemoExtras(ctx: Ctx, ws: Ws) {
  const today = todayLocal();
  // History is written with automations off — only today's activity (in seedToolsInUse) triggers rules.
  const people = withoutAutomations(() => {
    const p = seedPeople(ctx, ws, today);
    seedBusinessHistory(ctx, ws, today);
    seedWorkHistory(ctx, ws, today);
    seedCareerHistory(ctx, today);
    return p;
  });
  await seedDocuments(ctx, ws, today, people);
  seedToolsInUse(ctx, ws, today);
  createScenario(ctx, {
    name: 'Buy a bigger apartment',
    horizonMonths: 24,
    adjustments: [
      { label: 'Down payment', amount: '-600000', kind: 'once', startMonth: 6 },
      { label: 'Mortgage instalment', amount: '-18500', kind: 'monthly', startMonth: 7 },
      { label: 'Rent no longer paid', amount: '12000', kind: 'monthly', startMonth: 7 },
      { label: 'Sell the current flat (net)', amount: '450000', kind: 'once', startMonth: 8 },
    ],
    notes: 'Prices from the New Cairo compound brochure; check with the bank before deciding.',
  });
  seedReviews(ctx, today);
}

/** Pretend old records were created back then (demo only — real data is never backdated). */
const backdate = <T extends typeof tasks | typeof opportunities | typeof projects | typeof learningItems>(table: T, id: string, values: Record<string, unknown>) =>
  getDb().update(table).set(values as never).where(eq(table.id, id)).run();

// ---------- people & conversations ----------

function seedPeople(ctx: Ctx, ws: Ws, today: string) {
  const orgs = listOrganizations();
  const org = (n: string) => orgs.find((o) => o.name === n);
  const law = createOrganization(ctx, { name: 'Mostafa & Partners Law Firm', type: 'client', industry: 'Legal services', city: 'Maadi' });
  const nile = createOrganization(ctx, { name: 'Nile Retail Group', type: 'employer', industry: 'Retail', city: 'Cairo', website: 'https://example.com/nile-retail' });
  const textiles = createOrganization(ctx, { name: 'Nile Textiles', type: 'client', industry: 'Clothing manufacturing', city: 'Mahalla' });
  addRelation(ctx, { workspaceId: ws.mma, organizationId: law.id, role: 'prospect' });
  addRelation(ctx, { workspaceId: ws.basira, organizationId: textiles.id, role: 'client' });

  const hany = createPerson(ctx, { fullName: 'Hany Mostafa', relationship: 'client', organizationId: law.id, company: 'Mostafa & Partners', role: 'Managing partner', phone: '01223344556', workspaceId: ws.mma, source: 'Referral', nextFollowUp: addDays(today, 3), followUpNote: 'Send the office fit-out mood board' });
  const ahmed = createPerson(ctx, { fullName: 'Ahmed Samir', relationship: 'supplier', organizationId: org('Cairo Gypsum Co.')?.id, company: 'Cairo Gypsum Co.', role: 'Sales engineer', phone: '01005556677', workspaceId: ws.mma });
  const dina = createPerson(ctx, { fullName: 'Dina Kamal', relationship: 'partner', company: 'Studio DK', role: 'Interior designer', email: 'dina@example.com', workspaceId: ws.mma, instagram: 'https://instagram.com/example' });
  const mahmoud = createPerson(ctx, { fullName: 'Mahmoud Adel', relationship: 'professional', company: 'Adel Accounting', role: 'Accountant', phone: '01112345678', nextFollowUp: addDays(today, 10), followUpNote: 'Quarterly VAT filing for MMA Spaces' });
  const laila = createPerson(ctx, { fullName: 'Laila Youssef', relationship: 'client', organizationId: org('Delta Garments')?.id, company: 'Delta Garments', role: 'Quality manager', workspaceId: ws.basira });
  const tarek = createPerson(ctx, { fullName: 'Tarek Saleh', relationship: 'client', organizationId: textiles.id, company: 'Nile Textiles', role: 'Plant manager', workspaceId: ws.basira });
  createPerson(ctx, { fullName: 'Youssef (best friend)', relationship: 'friend', birthday: `1993-${addDays(today, 20).slice(5)}`, phone: '01099887766' });
  createPerson(ctx, { fullName: 'Rania Fawzy', relationship: 'colleague', organizationId: nile.id, company: 'Nile Retail Group', role: 'Head of Commercial' });

  const all = listPeople();
  const p = (n: string) => all.find((x) => x.fullName === n)!;
  const talk = (who: string, kind: 'call' | 'whatsapp' | 'meeting' | 'email', daysAgo: number, summary: string) => addInteraction(ctx, { personId: p(who).id, kind, date: addDays(today, -daysAgo), summary });
  talk('Hany Mostafa', 'meeting', 9, 'Visited the Maadi office floor. 220 m², wants a meeting room and a reception with branding.');
  talk('Hany Mostafa', 'call', 2, 'Asked for the price range before the next partners’ meeting.');
  talk('Ahmed Samir', 'whatsapp', 15, 'Gypsum board prices up 6% from next month — ordered villa boards at the old price.');
  talk('Dina Kamal', 'meeting', 21, 'Agreed she designs, MMA executes; 10% referral both ways.');
  talk('Mahmoud Adel', 'email', 35, 'Sent Q2 invoices and receipts for the VAT return.');
  talk('Laila Youssef', 'meeting', 12, 'Walked through the defects data; 3 lines record rejects on paper only.');
  talk('Tarek Saleh', 'call', 30, 'Pilot went well — wants a yearly licence for 2 plants.');
  talk('Eng. Karim Hassan', 'call', 40, 'Finished electrical work at Sheikh Zayed on time.');
  talk('Nour El-Sayed', 'whatsapp', 1, 'Approved the kitchen layout, still deciding on the marble.');
  talk('Omar Fathy', 'meeting', 25, 'First look at Basira. Interested if setup takes under 2 weeks.');
  talk('Mona (sister)', 'call', 4, 'Planning mum’s birthday dinner.');
  talk('Sara Ibrahim', 'email', 16, 'Shared two analytics manager roles; sent the updated CV.');
  return { hany, ahmed, dina, mahmoud, laila, tarek };
}

// ---------- a year of business ----------

function seedBusinessHistory(ctx: Ctx, ws: Ws, today: string) {
  const cats = listCategories();
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const mmaBank = listAccounts().find((a) => a.name.startsWith('MMA Spaces'))!;
  const people = listPeople();
  const mma = listPipelines(ws.mma)[0].stages;
  const stage = (n: string) => mma.find((s) => s.name === n)!.id;

  // Deals won and lost over the year (closing dates in the past, so the analytics show them).
  const past: [string, string, number, 'Won' | 'Lost', string?][] = [
    ['Duplex Rehab – finishing', '720000', 10, 'Won'],
    ['Pharmacy fit-out – Heliopolis', '310000', 8, 'Won'],
    ['Apartment Zamalek – kitchen & living', '480000', 7, 'Won'],
    ['Restaurant concept – Zamalek', '900000', 6, 'Lost', 'Chose a cheaper contractor'],
    ['Studio apartment – Mokattam', '160000', 4, 'Won'],
    ['Coworking space – Dokki', '650000', 3, 'Lost', 'Project postponed by the owner'],
    ['Villa garden pavilion', '240000', 2, 'Won'],
  ];
  for (const [title, value, monthsAgo, result, reason] of past) {
    const o = createOpportunity(ctx, { title, workspaceId: ws.mma, value, stageId: stage(result), source: monthsAgo % 2 ? 'Instagram' : 'Referral' });
    const closed = addDays(addMonths(today, -monthsAgo), 3);
    backdate(opportunities, o.id, { closedAt: closed, createdAt: `${addDays(closed, -40)}T10:00:00.000Z`, ...(reason ? { lostReason: reason } : {}) });
  }

  // The running Sheikh Zayed project started 40 days ago — its deal was won just before that.
  const zayedDeal = listOpportunities({ workspaceId: ws.mma }).find((o) => o.title === 'Apartment Sheikh Zayed');
  if (zayedDeal) backdate(opportunities, zayedDeal.id, { closedAt: addDays(today, -45), createdAt: `${addDays(today, -80)}T10:00:00.000Z` });

  // A project finished a few months ago, with its money linked: shows profit and the "done" state.
  const zamalek = listOpportunities({ workspaceId: ws.mma }).find((o) => o.title.startsWith('Apartment Zamalek'))!;
  const done = createProject(ctx, {
    name: 'Apartment Zamalek – kitchen & living',
    workspaceId: ws.mma,
    status: 'active',
    startDate: addMonths(today, -7),
    deadline: addMonths(today, -4),
    budget: '300000',
    contractValue: '480000',
    personId: people.find((x) => x.fullName === 'Dina Kamal')?.id,
  });
  backdate(projects, done.id, { opportunityId: zamalek.id });
  for (const [title, monthsAgo] of [
    ['Demolition', 7],
    ['Kitchen cabinets installed', 6],
    ['Living room ceiling & lighting', 5],
    ['Handover & snag list', 4],
  ] as const) {
    addMilestone(ctx, done.id, { title, dueDate: addMonths(today, -monthsAgo), done: true });
  }
  const t = (type: 'income' | 'expense', monthsAgo: number, day: number, amount: string, category: string, payee: string) =>
    createTransaction(ctx, { type, date: `${addMonths(today, -monthsAgo).slice(0, 7)}-${String(day).padStart(2, '0')}`, amount, accountId: mmaBank.id, categoryId: cat(category), payee, workspaceId: ws.mma, projectId: done.id, allowDuplicate: true });
  t('income', 7, 4, '144000', 'Business income', 'Zamalek client – 30% down payment');
  t('expense', 7, 12, '38000', 'Contractors', 'Demolition crew');
  t('income', 6, 3, '144000', 'Business income', 'Zamalek client – 2nd payment');
  t('expense', 6, 8, '96000', 'Materials', 'Kitchen cabinets – Mobica');
  t('expense', 5, 15, '61000', 'Contractors', 'Hassan Electric');
  t('expense', 5, 20, '44000', 'Materials', 'Cairo Gypsum Co.');
  t('income', 4, 10, '192000', 'Business income', 'Zamalek client – final payment');
  updateProject(ctx, done.id, { status: 'completed' });
  backdate(projects, done.id, { completedAt: `${addMonths(today, -4).slice(0, 7)}-12` });

  // Basira's first paying customer.
  const basira = listPipelines(ws.basira)[0].stages;
  const pilot = createOpportunity(ctx, { title: 'Nile Textiles – yearly licence (2 plants)', workspaceId: ws.basira, value: '96000', stageId: basira.find((s) => s.kind === 'won')!.id, organizationId: listOrganizations().find((o) => o.name === 'Nile Textiles')?.id });
  backdate(opportunities, pilot.id, { closedAt: addDays(today, -28) });
  createOpportunity(ctx, { title: 'Delta Garments – QA dashboards add-on', workspaceId: ws.basira, value: '30000', stageId: basira.find((s) => s.name === 'Qualified')?.id ?? basira[0].id, nextAction: 'Prepare a sample defects dashboard', nextActionDate: addDays(today, 4) });
  createOpportunity(ctx, { title: 'Office fit-out – Mostafa & Partners', workspaceId: ws.mma, value: '980000', stageId: stage('Proposal'), personId: people.find((x) => x.fullName === 'Hany Mostafa')?.id, expectedClose: addDays(today, 30), nextAction: 'Send mood board and price range', nextActionDate: addDays(today, 3), source: 'Referral' });
}

// ---------- finished work: tasks, goals, notes, events ----------

function seedWorkHistory(ctx: Ctx, ws: Ws, today: string) {
  const doneTasks: [string, number, string | null][] = [
    ['Send BOQ for the duplex', 110, ws.mma],
    ['Collect final payment – Duplex Rehab', 98, ws.mma],
    ['Pay car insurance', 95, null],
    ['Book dentist appointment', 90, null],
    ['Prepare pharmacy fit-out drawings', 84, ws.mma],
    ['Interview 2 site supervisors', 80, ws.mma],
    ['Set up Basira landing page', 76, ws.basira],
    ['File Q2 VAT documents', 70, ws.mma],
    ['Renew gym membership', 66, null],
    ['Buy Eid gifts', 62, null],
    ['Sketch Basira data model', 58, ws.basira],
    ['Order kitchen cabinets – Zamalek', 55, ws.mma],
    ['Call 5 garment factories', 50, ws.basira],
    ['Update CV', 46, null],
    ['Snag list walk-through – Zamalek', 42, ws.mma],
    ['Ask Uncle Hassan about the repayment plan', 38, null],
    ['Instagram post: Zamalek before/after', 35, ws.mma],
    ['Write Basira pilot agreement', 31, ws.basira],
    ['Pick tiles with Nour', 27, ws.mma],
    ['Monthly budget review', 24, null],
    ['Demo Basira to Delta Garments', 20, ws.basira],
    ['Fix leaking kitchen tap', 17, null],
    ['Send Sheikh Zayed progress photos', 13, ws.mma],
    ['Prepare MenaPay HR call', 9, null],
    ['Pay Vodafone Cash bills', 6, null],
    ['Weekly review', 5, null],
    ['Order paint samples', 3, ws.mma],
    ['Reply to Sara about the roles', 1, null],
  ];
  // Older months: the routine work that got done before.
  const routine: [string, string | null][] = [
    ['Monthly budget review', null],
    ['Send progress photos to clients', ws.mma],
    ['Pay credit card bill', null],
    ['Follow up on open proposals', ws.mma],
  ];
  for (let monthsAgo = 11; monthsAgo >= 4; monthsAgo--) {
    routine.forEach(([title, wsId], i) => {
      if ((monthsAgo + i) % 4 === 3) return; // not every task every month
      doneTasks.push([title, monthsAgo * 30 + i * 6, wsId]);
    });
  }
  for (const [title, daysAgo, wsId] of doneTasks) {
    const task = createTask(ctx, { title, status: 'planned', dueDate: addDays(today, -daysAgo), workspaceId: wsId });
    updateTask(ctx, task.id, { status: 'done' });
    backdate(tasks, task.id, { completedAt: `${addDays(today, -daysAgo)}T15:30:00.000Z`, createdAt: `${addDays(today, -daysAgo - 4)}T09:00:00.000Z` });
  }

  // Monthly check-ins so goal charts and health have a trend.
  const goal = (title: string) => getDb().select().from(goals).where(eq(goals.title, title)).get();
  const weight = goal('Reach 80 kg');
  if (weight) for (const [d, v] of [[55, 91.2], [45, 90.4], [15, 89.6], [8, 89]] as const) addCheckin(ctx, weight.id, { date: addDays(today, -d), value: v });
  const mmaGoal = goal('MMA Spaces: 12 completed projects this year');
  if (mmaGoal) {
    const yearStart = `${today.slice(0, 4)}-01-01`;
    [1, 2, 3, 4, 5].forEach((v, i) => {
      const d = addMonths(yearStart, i * 2 + 1);
      if (d < addDays(today, -20)) addCheckin(ctx, mmaGoal.id, { date: d, value: v });
    });
  }

  createNote(ctx, {
    title: 'Meeting – Delta Garments QA',
    body: `**${addDays(today, -12)}** with Laila Youssef\n\n- 3 sewing lines record rejects on paper\n- Wants weekly defect rates per line and per operator\n- Could be the first module after the [[Basira workflow]] health check\n\nNext: sample dashboard (see [[Basira pricing]] for the add-on price).`,
    workspaceId: ws.basira,
    tags: ['basira'],
  });
  createNote(ctx, {
    title: 'Book notes – Data-Driven Business',
    body: '## Key ideas\n- Start from the decision, not the data\n- One metric per team that everyone understands\n- Dashboards nobody opens should be deleted\n\n> “What gets measured gets managed — but only if someone looks.”',
    tags: ['learning'],
  });
  createNote(ctx, {
    title: 'Car maintenance log',
    body: '| Date | Km | Work | Cost |\n|---|---|---|---|\n| 2025-12 | 41,200 | Oil + filters | 2,100 |\n| 2026-03 | 46,800 | Brake pads | 3,400 |\n| 2026-06 | 51,900 | 50k service | 4,200 |',
    pinned: false,
  });
  createNote(ctx, {
    title: 'MMA marketing ideas',
    body: '- Before/after reels of every handover\n- Ask happy clients for Google reviews\n- Partner with designers (see Dina) — 10% referral\n- Use the [[MMA – standard BOQ checklist]] as a free downloadable lead magnet',
    workspaceId: ws.mma,
    tags: ['mma'],
  });

  createEvent(ctx, { title: 'MMA team sync', kind: 'meeting', date: addDays(today, -21), startTime: '09:30', endTime: '10:00', recurrence: 'weekly', workspaceId: ws.mma });
  createEvent(ctx, { title: 'Dentist – check-up', kind: 'appointment', date: addDays(today, -18), startTime: '18:00', location: 'Dr. Ahmed clinic, Nasr City' });
  createEvent(ctx, { title: 'Handover – Villa garden pavilion', kind: 'meeting', date: addDays(today, -52), startTime: '12:00', workspaceId: ws.mma });
  createEvent(ctx, { title: 'Partners’ meeting – Mostafa & Partners', kind: 'meeting', date: addDays(today, 8), startTime: '10:00', endTime: '11:00', location: 'Maadi', workspaceId: ws.mma, reminderMinutes: 60 });
  createEvent(ctx, { title: 'Pay VAT return', kind: 'deadline', date: addDays(today, 14), allDay: true, workspaceId: ws.mma });
}

// ---------- career history ----------

function seedCareerHistory(ctx: Ctx, today: string) {
  const statuses = listStatuses();
  const st = (name: string) => statuses.find((s) => s.name === name)!.id;
  const old: [string, string, number, string, string?][] = [
    ['Edita Food Industries', 'Senior Data Analyst', 150, 'Rejected', 'Wanted FMCG experience'],
    ['Talabat', 'Analytics Lead', 120, 'Withdrawn', 'Salary below current package'],
    ['Vodafone Egypt', 'BI Manager', 95, 'Rejected', 'Final interview — chose an internal candidate'],
  ];
  for (const [company, position, daysAgo, status, outcome] of old) {
    const a = createApplication(ctx, { company, position, appliedDate: addDays(today, -daysAgo), source: 'LinkedIn' });
    addInterview(ctx, { applicationId: a.id, stage: 'HR call', date: addDays(today, -daysAgo + 10), mode: 'phone', outcome: 'passed' });
    if (status !== 'Withdrawn') addInterview(ctx, { applicationId: a.id, stage: 'Technical interview', date: addDays(today, -daysAgo + 20), mode: 'video', outcome: status === 'Rejected' ? 'failed' : 'pending' });
    getDb().update(jobApplications).set({ statusId: st(status), outcome, closedAt: addDays(today, -daysAgo + 30) }).where(eq(jobApplications.id, a.id)).run();
  }
  // The finished course was finished months ago, not today.
  const course = listLearning().find((l) => l.status === 'completed');
  if (course) backdate(learningItems, course.id, { completedAt: addDays(today, -130), startDate: addDays(today, -190) });
}

// ---------- documents (small real PDFs) ----------

/** A minimal, valid one-page PDF with a title and some lines of text (ASCII only). */
function makePdf(title: string, lines: string[]): Buffer {
  const clean = (s: string) =>
    s
      .replace(/[–—]/g, '-')
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/([()\\])/g, '\\$1');
  const body = [`BT /F2 18 Tf 50 780 Td (${clean(title)}) Tj ET`, 'BT /F1 9 Tf 50 760 Td (DEMO DOCUMENT - sample data, not a real record) Tj ET'];
  lines.forEach((l, i) => body.push(`BT /F1 11 Tf 50 ${730 - i * 18} Td (${clean(l)}) Tj ET`));
  const content = body.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function seedDocuments(ctx: Ctx, ws: Ws, today: string, people: ReturnType<typeof seedPeople>) {
  const cfg = getConfig();
  const add = async (
    fileName: string,
    meta: { title: string; docType: string; workspaceId?: string | null; documentDate?: string | null; expiresOn?: string | null; description?: string; tags?: string[] },
    lines: string[],
    attachTo?: { type: string; id: string } | null,
  ) => {
    const file = await storeUpload(Readable.from(makePdf(meta.title, lines)), fileName, { files: cfg.paths.files, tmp: cfg.paths.tmp });
    return createDocument(ctx, file, fileName, meta as never, attachTo ?? null);
  };
  const accounts = listAccounts();
  const acct = (n: string) => accounts.find((a) => a.name === n)!;
  const opp = (t: string) => listOpportunities({}).find((o) => o.title.startsWith(t));
  const project = (n: string) => listProjects({}).find((p) => p.name.startsWith(n));
  const job = listEmployments().find((e) => e.current);
  const application = listApplications().find((a) => a.company === 'Fashion Hub Egypt');
  const course = listLearning().find((l) => l.status === 'completed');
  const gypsumTx = listTransactions({ q: 'Cairo Gypsum', limit: 1 }).items[0];

  await add('national-id.pdf', { title: 'National ID card', docType: 'id', documentDate: addMonths(today, -84), expiresOn: addDays(today, 25), tags: ['personal'] }, ['Name: Demo User', 'ID number: 2 9X XXXX XXXX XXXX (sample)', `Expires: ${addDays(today, 25)}`]);
  await add('passport.pdf', { title: 'Passport', docType: 'id', documentDate: addMonths(today, -79), expiresOn: addMonths(today, 5) }, ['Passport no. A0000000 (sample)', `Valid until: ${addMonths(today, 5)}`]);
  await add('car-license.pdf', { title: 'Car license – Hyundai Elantra', docType: 'certificate', expiresOn: addDays(today, 12), description: 'Renew at the Nasr City traffic unit; needs the insurance certificate.' }, ['Vehicle: Hyundai Elantra 2022', 'Plate: XXX 0000 (sample)', `License valid until: ${addDays(today, 12)}`]);
  await add('rental-contract.pdf', { title: 'Apartment rental contract', docType: 'contract', documentDate: addMonths(today, -7), expiresOn: addMonths(today, 5), tags: ['personal'] }, ['Landlord: (sample)', 'Monthly rent: EGP 12,000', 'Term: 12 months', 'Deposit: EGP 24,000']);
  if (job) await add('employment-contract.pdf', { title: `Employment contract – ${job.company}`, docType: 'employment_letter', documentDate: job.startDate, tags: ['career'] }, [`Position: ${job.position}`, `Start date: ${job.startDate}`, 'Probation: 3 months', 'Annual leave: 21 days'], { type: 'employment', id: job.id });
  await add('cv-2026.pdf', { title: 'CV – 2026', docType: 'cv', documentDate: addDays(today, -46), tags: ['career'] }, ['Senior BI Analyst - Nile Retail Group', 'SQL, Power BI, Python, forecasting', 'Automated the weekly sales pack (2 days -> 1 hour)'], application ? { type: 'job_application', id: application.id } : null);
  if (course) await add('certificate-time-series.pdf', { title: 'Certificate – Time series forecasting', docType: 'certificate', documentDate: addDays(today, -130), tags: ['career'] }, ['Coursera - Time series forecasting', 'Completed with distinction'], { type: 'learning', id: course.id });

  const villa = opp('Villa New Cairo');
  if (villa) await add('proposal-villa-new-cairo.pdf', { title: 'Proposal – Villa New Cairo', docType: 'proposal', workspaceId: ws.mma, documentDate: addDays(today, -4), tags: ['mma'] }, ['Full finishing - 420 m2', 'Total: EGP 1,200,000', 'Payment: 30% / 40% / 30%', 'Duration: 4 months'], { type: 'opportunity', id: villa.id });
  const zayed = project('Apartment Sheikh Zayed');
  if (zayed) await add('boq-sheikh-zayed.pdf', { title: 'BOQ – Apartment Sheikh Zayed', docType: 'boq', workspaceId: ws.mma, documentDate: addDays(today, -42), tags: ['mma'] }, ['Demolition .......... EGP 42,000', 'Electrical .......... EGP 68,000', 'Gypsum & ceilings ... EGP 55,000', 'Paint & flooring .... EGP 120,000', 'Total ............... EGP 285,000'], { type: 'project', id: zayed.id });
  if (gypsumTx) await add('invoice-cairo-gypsum.pdf', { title: 'Invoice – Cairo Gypsum Co.', docType: 'invoice', workspaceId: ws.mma, documentDate: gypsumTx.date, tags: ['mma', 'receipt'] }, ['Gypsum boards 12.5 mm x 180', 'Metal studs and tracks', `Total: EGP ${Math.abs(gypsumTx.amount / 100).toLocaleString('en')}`], { type: 'transaction', id: gypsumTx.id });
  const pilot = opp('Delta Garments – Basira pilot');
  if (pilot) await add('basira-pilot-agreement.pdf', { title: 'Basira pilot agreement (draft)', docType: 'contract', workspaceId: ws.basira, documentDate: addDays(today, -31), tags: ['basira'] }, ['Pilot: 3 months, free of charge', 'Scope: data input, validation, health check', 'Data stays the property of the factory'], { type: 'opportunity', id: pilot.id });
  await add('cib-statement.pdf', { title: `CIB statement – ${addMonths(today, -1).slice(0, 7)}`, docType: 'statement', documentDate: monthStart(today), tags: ['finance'] }, ['Account: CIB Current **** 4821', 'Opening and closing balances as per bank', '(sample statement)'], { type: 'account', id: acct('CIB Current').id });
  await add('quote-office-fit-out.pdf', { title: 'Price range – Mostafa & Partners office', docType: 'proposal', workspaceId: ws.mma, documentDate: addDays(today, -1), tags: ['mma'] }, ['Office fit-out - 220 m2, Maadi', 'Range: EGP 900,000 - 1,050,000', 'Includes reception branding and meeting room'], { type: 'person', id: people.hany.id });
}

// ---------- automation, custom fields and import in use ----------

function seedToolsInUse(ctx: Ctx, ws: Ws, today: string) {
  // Custom field values.
  const people = listPeople();
  const pref = listDefs('person').find((d) => d.label === 'Preferred contact');
  if (pref) {
    for (const [name, v] of [['Nour El-Sayed', 'WhatsApp'], ['Hany Mostafa', 'Call'], ['Dina Kamal', 'Email'], ['Eng. Karim Hassan', 'WhatsApp']] as const) {
      const p = people.find((x) => x.fullName === name);
      if (p) setValues(ctx, 'person', p.id, { [pref.id]: v });
    }
  }
  const projDefs = listDefs('project');
  const plot = projDefs.find((d) => d.label.startsWith('Plot'));
  const visit = projDefs.find((d) => d.label.startsWith('Site visit'));
  for (const [name, plotNo, visited] of [['Apartment Sheikh Zayed', 'Bldg 14, unit 6 – Beverly Hills', 'true'], ['Apartment Zamalek', '12 Brazil St., 4th floor', 'true']] as const) {
    const p = listProjects({}).find((x) => x.name.startsWith(name));
    if (p && plot && visit) setValues(ctx, 'project', p.id, { [plot.id]: plotNo, [visit.id]: visited });
  }

  // Automations actually running: a big expense today and a deal won today.
  const cats = listCategories();
  createTransaction(ctx, { type: 'expense', date: today, amount: '38500', accountId: listAccounts().find((a) => a.name === 'CIB Current')!.id, categoryId: cats.find((c) => c.name === 'Electronics')!.id, payee: 'Dell Store', description: 'Laptop for Basira work', workspaceId: ws.basira, allowDuplicate: true });
  const kitchen = listOpportunities({ workspaceId: ws.mma }).find((o) => o.title === 'Apartment kitchen & bath');
  const won = listPipelines(ws.mma)[0].stages.find((s) => s.kind === 'won');
  if (kitchen && won) moveOpportunity(ctx, kitchen.id, won.id);

  // A past import (Vodafone Cash statement) and a saved bank mapping.
  const vf = listAccounts().find((a) => a.name === 'Vodafone Cash')!;
  const m = addMonths(today, -1).slice(0, 7);
  const csv = ['Date,Description,Amount', `${m}-04,Talabat order,-285.50`, `${m}-09,Fawry – water bill,-160`, `${m}-15,Cash in from Ahmed,1000`, `${m}-21,Talabat order,-312`].join('\n');
  commitImport(ctx, {
    target: 'transactions',
    fileName: `vodafone-cash-${m}.csv`,
    content: csv,
    format: 'csv',
    mapping: { date: 'Date', description: 'Description', amount: 'Amount' },
    options: { dateFormat: 'yyyy-MM-dd', decimal: '.', amountMode: 'signed', accountId: vf.id, defaultExpenseCategoryId: cats.find((c) => c.name === 'Restaurants')!.id, defaultIncomeCategoryId: cats.find((c) => c.name === 'Other income')!.id },
  });
  savePreset(ctx, { name: 'CIB statement', target: 'transactions', mapping: { date: 'Booking Date', description: 'Details', moneyOut: 'Debit', moneyIn: 'Credit' }, options: { dateFormat: 'dd/MM/yyyy', decimal: ',', amountMode: 'split' } });
}

// ---------- reviews ----------

function seedReviews(ctx: Ctx, today: string) {
  const week = defaultReviewPeriod('weekly', today, 6);
  const weekly = [
    [21, 'Signed the garden pavilion handover. Basira landing page live.', 'Two site visits clashed with work meetings.', 'Put site visits on Saturdays only.', 'Finish Zamalek snag list\nCall 5 factories for Basira\nGym 3×'],
    [14, 'Delta Garments liked the Basira demo. Paid the car insurance early.', 'Spent too much on eating out.', 'Cook at home on weekdays.', 'Send Delta the pilot agreement\nTiles with Nour\nBudget review'],
  ] as const;
  for (const [daysBack, wins, challenges, lessons, priorities] of weekly) {
    saveReview(ctx, { type: 'weekly', periodStart: addDays(week.start, -daysBack), wins, challenges, lessons, priorities, rating: daysBack === 21 ? 3 : 4, completed: true });
  }
  const month = defaultReviewPeriod('monthly', today, 6);
  saveReview(ctx, {
    type: 'monthly',
    periodStart: addMonths(month.start, -1),
    wins: 'Garden pavilion delivered with a healthy margin. First Basira pilot started.',
    challenges: 'MMA income dipped; two deals slipped to next month.',
    lessons: 'Follow up every proposal within 3 days.',
    priorities: 'Win the Maadi office fit-out\nGet Basira to a paying customer\nKeep savings rate above 30%',
    rating: 4,
    completed: true,
  });
  saveReview(ctx, {
    type: 'monthly',
    periodStart: month.start,
    wins: 'Nile Textiles signed a yearly Basira licence. Interviews progressing at MenaPay.',
    challenges: 'Big laptop purchase and Eid spending.',
    lessons: 'Plan the yearly costs (insurance, gifts) as monthly savings.',
    priorities: 'Close the villa proposal\nPrepare the MenaPay technical interview\nStart the PL-300 course',
    rating: 4,
    completed: true,
  });
}
