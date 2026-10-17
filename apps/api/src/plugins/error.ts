import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@proctor/database';
import { AppError, toAppError } from '../lib/errors.js';
import type { Logger } from '@proctor/database';
import { newErrorId } from '@proctor/database';

export interface ErrorPluginOptions {
  logger: Logger;
  isProduction: boolean;
  /** Used to shape the 404 body for API vs non-API paths. */
  apiBasePath: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Candidate-safe speech copy for an error code. */
    candidateMessage: (code: string) => string;
  }
}

/**
 * Central error handler.
 *
 * Guarantees:
 *  * The response body always matches `{ error: { code, message, userMessage, errorId } }`.
 *  * `message` is safe for the admin UI (never a stack trace or driver message).
 *  * `userMessage` is safe to speak aloud to a candidate.
 *  * Every 5xx is logged with the same `errorId` the client receives, so a candidate
 *    can read the code on screen while support finds the log line.
 */
export default fp<ErrorPluginOptions>(async (app: FastifyInstance, options) => {
  const { logger, isProduction } = options;

  app.decorate('candidateMessage', () => 'There is a small technical problem. Please wait a moment.');

  /**
   * Single not-found handler for the whole instance.
   *
   * Kept here so a 404 always matches the same error envelope as every other failure,
   * including the base path, which tells a caller they reached the wrong origin.
   */
  app.setNotFoundHandler((req, reply) => {
    const isApiPath = options.apiBasePath ? req.url.startsWith(options.apiBasePath) : true;
    const message = isApiPath
      ? `No route matches ${req.method} ${req.url}`
      : // A bare "Not found" tells a browser user nothing about where the app lives. A
        // 404 outside the API base path almost always means someone opened the API origin
        // instead of the kiosk or admin console, so point them at both.
        `Nothing is served at ${req.url}. The kiosk and admin console are separate apps — see README.md, or GET / for their locations.`;

    void reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message,
        userMessage: null,
        errorId: null,
      },
    });
  });

  app.setErrorHandler((err, req: FastifyRequest, reply: FastifyReply) => {
    const errorId = err instanceof AppError ? err.errorId : newErrorId();
    const appError = toAppError(err);

    const logFields = {
      errorId,
      code: appError.code,
      statusCode: appError.statusCode,
      method: req.method,
      route: req.routeOptions?.url ?? req.url,
      sessionPublicId: (req.body as { publicId?: string } | undefined)?.publicId,
      err: isProduction ? { name: appError.name, message: appError.message } : err,
    };

    if (appError.statusCode >= 500) {
      logger.error('request_failed', logFields);
    } else {
      logger.warn('request_rejected', logFields);
    }

    // Surface Zod details to the admin UI but never candidate-facing surfaces.
    const details =
      appError.details ??
      (err instanceof Prisma.PrismaClientKnownRequestError
        ? { dbCode: err.code, target: (err.meta as { target?: string } | undefined)?.target }
        : undefined);

    void reply.status(appError.statusCode).send({
      error: {
        code: appError.code,
        message: isProduction && appError.statusCode >= 500 ? appError.userMessage : appError.userMessage,
        userMessage: appError.userMessage,
        errorId: appError.statusCode >= 500 ? errorId : undefined,
        ...(details && !isProduction ? { details } : {}),
      },
    });
  });
});