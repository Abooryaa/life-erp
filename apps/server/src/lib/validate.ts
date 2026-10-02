import type { z } from 'zod';
import { fromZod } from './errors';

/** Parse untrusted input with a Zod schema, throwing a user-friendly 400 on failure. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw fromZod(r.error);
  return r.data;
}
