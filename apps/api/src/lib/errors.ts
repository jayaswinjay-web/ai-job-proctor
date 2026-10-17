import { newErrorId } from '@proctor/database';
import { CANDIDATE_SAFE_MESSAGES, ERROR_CODES, type ErrorCode } from '@proctor/types';

/**
 * Error model.
 *
 * Every error surfaced by the API carries three separate things:
 *  - `code`        machine-readable, for the client to branch on
 *  - `userMessage` spoken-safe text a candidate can be shown (never technical)
 *  - `errorId`     correlation id that also appears in the server log
 *
 * The candidate never sees a stack trace, a Prisma message or an HTTP status.
 */
export class AppError extends Error {
  readonly code: ErrorCode | string;
  readonly statusCode: number;
  readonly userMessage: string;
  readonly errorId: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(
    code: ErrorCode | string,
    statusCode: number,
    userMessage: string,
    options: { details?: unknown; cause?: unknown; errorId?: string } = {},
  ) {
    super(code, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.userMessage = userMessage;
    this.errorId = options.errorId ?? newErrorId();
    this.details = options.details;
    this.expose = statusCode < 500;
  }

  /** Admin-facing: the message is specific and safe to render in the dashboard. */
  static validation(message: string, details?: unknown): AppError {
    return new AppError(ERROR_CODES.VALIDATION_ERROR, 400, message, { details });
  }
  static unauthenticated(message = 'Sign in to continue.'): AppError {
    return new AppError(ERROR_CODES.UNAUTHENTICATED, 401, message);
  }
  static forbidden(message = 'You do not have permission to do that.'): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN, 403, message);
  }
  static notFound(message = 'That record could not be found.'): AppError {
    return new AppError(ERROR_CODES.NOT_FOUND, 404, message);
  }
  static conflict(message: string, details?: unknown): AppError {
    return new AppError(ERROR_CODES.CONFLICT, 409, message, { details });
  }
  static rateLimited(message = 'Too many attempts. Please wait a moment.'): AppError {
    return new AppError(ERROR_CODES.RATE_LIMITED, 429, message);
  }
  static locked(message = 'This session is locked and can no longer be changed.'): AppError {
    return new AppError(ERROR_CODES.SESSION_LOCKED, 409, message);
  }
  /** Candidate-facing: `message` goes to the log, the candidate hears safe copy. */
  static providerFailure(message: string, cause?: unknown): AppError {
    return new AppError(ERROR_CODES.PROVIDER_ERROR, 502, CANDIDATE_SAFE_MESSAGES[ERROR_CODES.PROVIDER_ERROR]!, {
      cause,
      details: message,
    });
  }
  static storage(message: string, cause?: unknown): AppError {
    return new AppError(ERROR_CODES.STORAGE_ERROR, 500, CANDIDATE_SAFE_MESSAGES[ERROR_CODES.STORAGE_ERROR]!, {
      cause,
      details: message,
    });
  }
  static internal(message = 'Something went wrong.', cause?: unknown): AppError {
    return new AppError(ERROR_CODES.INTERNAL_ERROR, 500, CANDIDATE_SAFE_MESSAGES[ERROR_CODES.INTERNAL_ERROR]!, {
      cause,
      details: message,
    });
  }

  /** Discriminatory content blocked by policy — an admin-facing, actionable error. */
  static discriminatory(message: string, details?: unknown): AppError {
    return new AppError(ERROR_CODES.DISCRIMINATORY_CONTENT, 422, message, { details });
  }

  /** Attempt to mutate an immutable historical record. */
  static immutable(message = 'Completed interviews cannot be changed.'): AppError {
    return new AppError(ERROR_CODES.IMMUTABLE_RECORD, 409, message);
  }

  /**
   * The LiveKit Cloud voice agent or its credentials are absent.
   *
   * A configuration fault, not a candidate fault: surfaced clearly so an operator fixes
   * it rather than the kiosk silently pretending to work (spec §29).
   */
  static voiceAiNotConfigured(message = 'Voice AI service is not configured.'): AppError {
    return new AppError(ERROR_CODES.VOICE_AI_NOT_CONFIGURED, 503, message, {
      details: 'Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET and AGENT_API_KEY.',
    });
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  // Fastify raises its own failures for a malformed body, an unsupported content type, an
  // oversized payload and the like. They carry a 4xx status; treating them as internal
  // would blame the server for the caller's mistake, log them in the 5xx stream and hand a
  // candidate a "technical problem" message for something they could fix by retrying.
  const status = (err as { statusCode?: unknown } | null | undefined)?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return new AppError(ERROR_CODES.VALIDATION_ERROR, status, 'The request could not be understood.', {
      details: err instanceof Error ? err.message : undefined,
      cause: err,
    });
  }

  return AppError.internal('Unexpected error', err);
}