import type { ZodError } from 'zod';

export interface FieldError {
  path: string;
  message: string;
}

/** An error whose message is safe and useful to show to the user. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: FieldError[],
  ) {
    super(message);
  }
}

export const notFound = (what = 'Record') => new AppError(404, 'not_found', `${what} not found`);
export const badRequest = (message: string, code = 'bad_request') => new AppError(400, code, message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const unauthorized = (message = 'Please sign in') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new AppError(403, 'forbidden', message);

export function fromZod(err: ZodError): AppError {
  const fields = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = fields[0];
  const message = first ? (first.path ? `${first.path}: ${first.message}` : first.message) : 'Invalid input';
  return new AppError(400, 'validation', message, fields);
}
