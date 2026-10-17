import type { Logger, PrismaClient } from '@proctor/database';
import { hashIp, redactForAudit, redactUserAgent } from './crypto.js';

/**
 * Audit logging.
 *
 * Records administrative and security-relevant actions. Written inside the same
 * transaction as the mutation wherever possible, so an action can never succeed
 * without leaving a trace. Values pass through `redactForAudit`, which guarantees
 * candidate content and secrets are never written here.
 */

export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.locked'
  | 'auth.totp_enabled'
  | 'user.created'
  | 'user.updated'
  | 'user.roles_changed'
  | 'user.deactivated'
  | 'job.created'
  | 'job.updated'
  | 'job.status_changed'
  | 'job.archived'
  | 'job.deleted'
  | 'question.created'
  | 'question.updated'
  | 'question.published'
  | 'question.unpublished'
  | 'question.deleted'
  | 'question.import_validated'
  | 'question.import_applied'
  | 'scoring.changed'
  | 'candidate.viewed'
  | 'candidate.deleted'
  | 'candidate.exported'
  | 'recording.accessed'
  | 'review.submitted'
  | 'review.overridden'
  | 'report.exported'
  | 'settings.changed'
  | 'language.created'
  | 'language.updated'
  | 'language.deleted'
  | 'session.started'
  | 'session.completed'
  | 'session.cancelled'
  | 'proctor.reviewed';

export interface AuditActor {
  id?: string | null;
  email?: string | null;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface AuditInput {
  action: AuditAction | string;
  entityType: string;
  entityId?: string | null;
  previous?: unknown;
  next?: unknown;
  actor?: AuditActor;
  /** Supply a Prisma transaction client to make the log atomic with the change. */
  tx?: {
    auditLog: {
      create(args: {
        data: {
          actorId?: string | null;
          actorEmail?: string | null;
          action: string;
          entityType: string;
          entityId?: string | null;
          previous?: unknown;
          next?: unknown;
          ipHash?: string | null;
          userAgent?: string | null;
        };
      }): Promise<unknown>;
    };
  };
}

export class AuditService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
    private readonly ipSalt: string,
  ) {}

  async record(input: AuditInput): Promise<void> {
    const client = input.tx ?? this.prisma;
    const data = {
      ...(input.actor?.id ? { actorId: input.actor.id } : {}),
      actorEmail: input.actor?.email ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      ...(input.previous !== undefined ? { previous: redactForAudit(input.previous) as never } : {}),
      ...(input.next !== undefined ? { next: redactForAudit(input.next) as never } : {}),
      ipHash: hashIp(input.actor?.ip, this.ipSalt),
      userAgent: redactUserAgent(input.actor?.userAgent) ?? null,
    };

    try {
      await client.auditLog.create({ data });
    } catch (err) {
      // Audit failure must not break the user's action, but it must be loud.
      this.logger.error('audit_write_failed', {
        err,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
      });
    }
  }

  /** Computes a field-level diff limited to keys present in `next`. */
  static diff<T extends Record<string, unknown>>(previous: T | null, next: Partial<T>): Record<string, { from: unknown; to: unknown }> {
    const out: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, value] of Object.entries(next)) {
      const before = previous?.[key];
      if (JSON.stringify(before) !== JSON.stringify(value)) {
        out[key] = { from: redactForAudit(before), to: redactForAudit(value) };
      }
    }
    return out;
  }
}