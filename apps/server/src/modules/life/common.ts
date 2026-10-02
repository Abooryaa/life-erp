import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { goals, people } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { localDateTime } from '../../lib/dates';
import { getSettings } from '../settings/service';

/** Today's date in the user's time zone. */
export function today() {
  return localDateTime(getSettings().timezone).date;
}

export function nowLocal() {
  return localDateTime(getSettings().timezone);
}

function refError(field: string, message: string): never {
  throw new AppError(400, 'validation', message, [{ path: field, message }]);
}

export function assertPerson(id: string | null | undefined, field = 'personId') {
  if (!id) return;
  const p = getDb().select({ id: people.id, deletedAt: people.deletedAt }).from(people).where(eq(people.id, id)).get();
  if (!p || p.deletedAt) refError(field, 'Contact not found');
}

export function assertGoal(id: string | null | undefined, field = 'goalId') {
  if (!id) return;
  const g = getDb().select({ id: goals.id, deletedAt: goals.deletedAt }).from(goals).where(eq(goals.id, id)).get();
  if (!g || g.deletedAt) refError(field, 'Goal not found');
}
