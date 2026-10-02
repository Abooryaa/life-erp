import { addDays, parseQuickTask, TASK_STATUSES } from '@life-erp/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf, type Q } from '../../http';
import { badRequest } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { today } from './common';
import { createEvent, deleteEvent, getEvent, updateEvent } from './events';
import { addCheckin, createGoal, deleteCheckin, deleteGoal, getGoal, listGoals, updateGoal } from './goals';
import { createNote, deleteNote, getNote, listNotes, updateNote } from './notes';
import { addInteraction, createPerson, deleteInteraction, deletePerson, getPerson, listPeople, updatePerson } from './people';
import { createTask, deleteTask, getTask, listTasks, setTaskStatus, taskCounts, updateTask, type TaskView } from './tasks';
import { calendarFeed, todayView } from './today';

type Id = { Params: { id: string } };
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

export async function lifeRoutes(app: FastifyInstance) {
  // ---------- today & calendar ----------
  app.get<{ Querystring: Q }>('/api/today', async (req) => todayView(req.query.workspaceId));
  app.get<{ Querystring: Q }>('/api/calendar', async (req) => {
    const from = req.query.from ?? today();
    const to = req.query.to ?? addDays(from, 41);
    if (!dateRe.test(from) || !dateRe.test(to)) throw badRequest('from/to must be YYYY-MM-DD');
    if (to < from) throw badRequest('to must be after from');
    if (Date.parse(to) - Date.parse(from) > 400 * 86_400_000) throw badRequest('Range too large (max 400 days)');
    return calendarFeed(from, to, req.query.workspaceId);
  });

  // ---------- tasks ----------
  app.get<{ Querystring: Q }>('/api/tasks', async (req) => {
    const q = req.query;
    return listTasks({
      view: q.view as TaskView | undefined,
      workspaceId: q.workspaceId,
      goalId: q.goalId,
      personId: q.personId,
      projectId: q.projectId,
      area: q.area,
      q: q.q,
      tag: q.tag,
      from: q.from,
      to: q.to,
    });
  });
  app.get<{ Querystring: Q }>('/api/tasks/counts', async (req) => taskCounts(req.query.workspaceId));
  app.get<Id>('/api/tasks/:id', async (req) => getTask(req.params.id));
  app.post('/api/tasks', async (req) => createTask(ctxOf(req), req.body as never));
  /** Natural-language quick capture: "Call Ahmed tomorrow 3pm !high #mma". */
  app.post('/api/tasks/quick', async (req) => {
    const { text, workspaceId } = parse(z.object({ text: z.string().trim().min(1, 'Required').max(500), workspaceId: z.string().nullable().optional() }), req.body);
    const p = parseQuickTask(text, today());
    return createTask(ctxOf(req), { title: p.title, dueDate: p.dueDate, dueTime: p.dueTime, priority: p.priority ?? 3, tags: p.tags, workspaceId: workspaceId ?? null });
  });
  app.put<Id>('/api/tasks/:id', async (req) => updateTask(ctxOf(req), req.params.id, req.body as never));
  app.post<Id>('/api/tasks/:id/status', async (req) => {
    const { status } = parse(z.object({ status: z.enum(TASK_STATUSES) }), req.body);
    return setTaskStatus(ctxOf(req), req.params.id, status);
  });
  app.delete<Id>('/api/tasks/:id', async (req) => {
    deleteTask(ctxOf(req), req.params.id);
    return { ok: true };
  });

  // ---------- events ----------
  app.get<Id>('/api/events/:id', async (req) => getEvent(req.params.id));
  app.post('/api/events', async (req) => createEvent(ctxOf(req), req.body as never));
  app.put<Id>('/api/events/:id', async (req) => updateEvent(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/events/:id', async (req) => {
    deleteEvent(ctxOf(req), req.params.id);
    return { ok: true };
  });

  // ---------- goals ----------
  app.get<{ Querystring: Q }>('/api/goals', async (req) => listGoals({ workspaceId: req.query.workspaceId, status: req.query.status }));
  app.get<Id>('/api/goals/:id', async (req) => getGoal(req.params.id));
  app.post('/api/goals', async (req) => createGoal(ctxOf(req), req.body as never));
  app.put<Id>('/api/goals/:id', async (req) => updateGoal(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/goals/:id', async (req) => {
    deleteGoal(ctxOf(req), req.params.id);
    return { ok: true };
  });
  app.post<Id>('/api/goals/:id/checkins', async (req) => addCheckin(ctxOf(req), req.params.id, req.body));
  app.delete<{ Params: { id: string; cid: string } }>('/api/goals/:id/checkins/:cid', async (req) => deleteCheckin(ctxOf(req), req.params.id, req.params.cid));

  // ---------- notes ----------
  app.get<{ Querystring: Q }>('/api/notes', async (req) => listNotes({ q: req.query.q, workspaceId: req.query.workspaceId, tag: req.query.tag, archived: req.query.archived === '1' }));
  app.get<Id>('/api/notes/:id', async (req) => getNote(req.params.id));
  app.post('/api/notes', async (req) => createNote(ctxOf(req), req.body as never));
  app.put<Id>('/api/notes/:id', async (req) => updateNote(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/notes/:id', async (req) => {
    deleteNote(ctxOf(req), req.params.id);
    return { ok: true };
  });

  // ---------- people ----------
  app.get<{ Querystring: Q }>('/api/people', async (req) =>
    listPeople({ q: req.query.q, relationship: req.query.relationship, workspaceId: req.query.workspaceId, tag: req.query.tag, followUpDue: req.query.followUp === '1' }),
  );
  app.get<Id>('/api/people/:id', async (req) => getPerson(req.params.id));
  app.post('/api/people', async (req) => createPerson(ctxOf(req), req.body as never));
  app.put<Id>('/api/people/:id', async (req) => updatePerson(ctxOf(req), req.params.id, req.body as never));
  app.delete<Id>('/api/people/:id', async (req) => {
    deletePerson(ctxOf(req), req.params.id);
    return { ok: true };
  });
  app.post('/api/interactions', async (req) => addInteraction(ctxOf(req), req.body));
  app.delete<Id>('/api/interactions/:id', async (req) => deleteInteraction(ctxOf(req), req.params.id));
}
