import type { z } from 'zod';
import { AppError } from './errors.js';

/**
 * Request validation helpers.
 *
 * Every route validates its input with a zod schema before a handler runs, so a handler
 * can treat its input as typed without defensive checks. Validation failures produce a
 * field-keyed `details` payload the admin UI can render inline.
 */

export interface ValidatedRequest<T> {
  body: T;
  query: T;
  params: T;
}

type PreHandler = (req: unknown) => Promise<unknown>;

export function zodBody<S extends z.ZodTypeAny>(schema: S): PreHandler {
  return async (req: unknown): Promise<unknown> => {
    const request = req as { body: unknown };
    const parsed = schema.safeParse(request.body ?? {});
    if (!parsed.success) throw validationError(parsed.error);
    (request as { body: unknown }).body = parsed.data;
    return undefined;
  };
}

export function zodQuery<S extends z.ZodTypeAny>(schema: S): PreHandler {
  return async (req: unknown): Promise<unknown> => {
    const request = req as { query: unknown };
    const parsed = schema.safeParse(request.query ?? {});
    if (!parsed.success) throw validationError(parsed.error);
    (request as { query: unknown }).query = parsed.data;
    return undefined;
  };
}

export function zodParams<S extends z.ZodTypeAny>(schema: S): PreHandler {
  return async (req: unknown): Promise<unknown> => {
    const request = req as { params: unknown };
    const parsed = schema.safeParse(request.params ?? {});
    if (!parsed.success) throw validationError(parsed.error);
    (request as { params: unknown }).params = parsed.data;
    return undefined;
  };
}

/** Combines validation with the permission check for a route. */
export function zodValidated<S extends z.ZodTypeAny>(schema: S, source: 'body' | 'query' | 'params' = 'body'): PreHandler {
  const validator = source === 'query' ? zodQuery(schema) : source === 'params' ? zodParams(schema) : zodBody(schema);
  return async (req: unknown): Promise<unknown> => validator(req);
}

function validationError(error: z.ZodError): AppError {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    fields[path] = fields[path] ?? [];
    fields[path]!.push(issue.message);
  }
  const summary =
    error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || 'request'}: ${i.message}`)
      .join('; ') || 'The request could not be processed.';
  return AppError.validation(summary, fields);
}