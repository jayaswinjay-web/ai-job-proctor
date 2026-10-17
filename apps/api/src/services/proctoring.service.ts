import type { PrismaClient } from '@proctor/database';
import { PROCTOR_EVENT_TYPES, type ProctorEventDto, type ProctorEventType } from '@proctor/types';

type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
import type { Logger } from '@proctor/database';
import type { StorageDriver } from '../storage/index.js';
import { AppError } from '../lib/errors.js';

/**
 * Proctoring.
 *
 * Ethical and legal position, encoded in this module's behaviour:
 *
 *  * Events are labelled "PROCTORING EVENT DETECTED", never "cheating". A detection
 *    is an automated observation, not a finding.
 *  * A proctoring event never affects a candidate's score and never, on its own,
 *    produces a `NOT_RECOMMENDED` recommendation. `deriveRecommendation` never sees it.
 *  * Only presence/attention signals are used: someone left the kiosk, more than one
 *    person is present, the candidate turned away, or a device disconnected. There is
 *    no identity recognition, no face matching, no emotion or personality inference,
 *    and no scoring of trustworthiness or intelligence from a face or a voice.
 *  * Events requiring attention set `requiresHumanReview` so they land in a reviewer's
 *    queue; they never auto-resolve.
 *  * Snapshots are opt-in, short-lived, and access-controlled exactly like interview audio.
 */

export interface ProctorReportInput {
  type: ProctorEventType;
  confidence: number;
  occurredAt?: string;
  stageKind?: string;
  description?: string;
  reference?: string;
  snapshotBase64?: string;
}

export interface ProctoringConfig {
  level: 'DISABLED' | 'BASIC' | 'STANDARD' | 'ENHANCED';
  cameraEnabled: boolean;
  detectMultiplePeople: boolean;
  detectFacingAway: boolean;
  facingAwaySeconds: number;
  snapshotOnEvent: boolean;
}

/** Which events each level permits, and how serious each is treated. */
const LEVEL_MATRIX: Record<
  ProctoringConfig['level'],
  { allowed: Set<ProctorEventType>; severity: Partial<Record<ProctorEventType, Severity>>; requiresReview: Set<ProctorEventType> }
> = {
  DISABLED: {
    allowed: new Set(),
    severity: {},
    requiresReview: new Set(),
  },
  BASIC: {
    allowed: new Set(['MIC_DISCONNECTED', 'NETWORK_INTERRUPTED', 'CAMERA_UNAVAILABLE']),
    severity: { MIC_DISCONNECTED: 'MEDIUM', NETWORK_INTERRUPTED: 'LOW', CAMERA_UNAVAILABLE: 'INFO' },
    requiresReview: new Set(),
  },
  STANDARD: {
    allowed: new Set([
      'MIC_DISCONNECTED',
      'CAMERA_DISCONNECTED',
      'CAMERA_UNAVAILABLE',
      'NETWORK_INTERRUPTED',
      'FULLSCREEN_EXITED',
      'TAB_CHANGED',
      'WINDOW_BLURRED',
      'CANDIDATE_LEFT_KIOSK',
    ]),
    severity: {
      MIC_DISCONNECTED: 'MEDIUM',
      CAMERA_DISCONNECTED: 'MEDIUM',
      CAMERA_UNAVAILABLE: 'INFO',
      NETWORK_INTERRUPTED: 'LOW',
      FULLSCREEN_EXITED: 'LOW',
      TAB_CHANGED: 'MEDIUM',
      WINDOW_BLURRED: 'LOW',
      CANDIDATE_LEFT_KIOSK: 'MEDIUM',
    },
    requiresReview: new Set(['CANDIDATE_LEFT_KIOSK', 'TAB_CHANGED']),
  },
  ENHANCED: {
    allowed: new Set(PROCTOR_EVENT_TYPES),
    severity: {
      MULTIPLE_PEOPLE_DETECTED: 'HIGH',
      FACING_AWAY: 'LOW',
      UNUSUAL_INTERRUPTION: 'LOW',
      CANDIDATE_LEFT_KIOSK: 'HIGH',
      TAB_CHANGED: 'HIGH',
      WINDOW_BLURRED: 'MEDIUM',
      FULLSCREEN_EXITED: 'MEDIUM',
      MIC_DISCONNECTED: 'MEDIUM',
      CAMERA_DISCONNECTED: 'MEDIUM',
      CAMERA_UNAVAILABLE: 'INFO',
      NETWORK_INTERRUPTED: 'LOW',
    },
    requiresReview: new Set(['CANDIDATE_LEFT_KIOSK', 'MULTIPLE_PEOPLE_DETECTED', 'TAB_CHANGED', 'UNUSUAL_INTERRUPTION']),
  },
};

const DEFAULT_DESCRIPTIONS: Record<ProctorEventType, string> = {
  CANDIDATE_LEFT_KIOSK:
    'No person was detected in front of the kiosk for a sustained period. This can also be caused by moving out of frame or a lighting change.',
  MULTIPLE_PEOPLE_DETECTED:
    'More than one person was detected near the kiosk. This may be a helper, a supervisor or a passer-by.',
  FACING_AWAY: 'The candidate was facing away from the kiosk for an extended period.',
  MIC_DISCONNECTED: 'The microphone stopped delivering audio.',
  CAMERA_DISCONNECTED: 'The camera stopped delivering video.',
  CAMERA_UNAVAILABLE: 'The camera is not available, so camera-based checks are disabled for this session.',
  TAB_CHANGED: 'The kiosk browser left the interview tab.',
  WINDOW_BLURRED: 'The kiosk window lost focus.',
  NETWORK_INTERRUPTED: 'The connection to the server dropped. Answers are queued locally and will synchronise.',
  UNUSUAL_INTERRUPTION: 'An unusual pattern of interruptions was detected.',
  FULLSCREEN_EXITED: 'The kiosk left fullscreen mode.',
};

export class ProctoringService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
    private readonly storage: StorageDriver,
  ) {}

  async record(sessionId: string, input: ProctorReportInput, config: ProctoringConfig): Promise<ProctorEventDto | null> {
    if (config.level === 'DISABLED') {
      // Still log device faults so an administrator can see hardware problems.
      if (input.type === 'MIC_DISCONNECTED' || input.type === 'CAMERA_UNAVAILABLE') {
        this.logger.warn('proctor_hardware_fault', { sessionId, type: input.type });
      }
      return null;
    }

    const matrix = LEVEL_MATRIX[config.level];
    if (!matrix.allowed.has(input.type)) {
      this.logger.debug('proctor_event_below_configured_level', { sessionId, type: input.type, level: config.level });
      return null;
    }

    // Suppress duplicates of the same type within a short window; kiosk detectors fire
    // repeatedly and a spam of identical events is useless to a reviewer.
    const recent = await this.prisma.proctoringEvent.findFirst({
      where: {
        sessionId,
        type: input.type,
        occurredAt: { gte: new Date(Date.now() - 90_000) },
      },
      orderBy: { occurredAt: 'desc' },
    });
    if (recent && recent.confidence >= input.confidence - 0.05) {
      this.logger.debug('proctor_event_deduplicated', { sessionId, type: input.type });
      return null;
    }

    const severity = matrix.severity[input.type] ?? 'INFO';
    const requiresHumanReview = matrix.requiresReview.has(input.type);

    const snapshotKey = await this.storeSnapshot(sessionId, input, config);

    const event = await this.prisma.proctoringEvent.create({
      data: {
        sessionId,
        type: input.type,
        severity,
        confidence: clamp(input.confidence, 0, 1),
        description: sanitise(input.description ?? DEFAULT_DESCRIPTIONS[input.type]),
        reference: input.reference ? input.reference.slice(0, 300) : null,
        snapshotKey,
        stageKind: (input.stageKind as never) ?? null,
        requiresHumanReview,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      },
    });

    await appendSessionTimeline(this.prisma, sessionId, 'proctoring_event', event.type);

    this.logger.info('proctoring_event_recorded', {
      sessionId,
      type: event.type,
      severity,
      confidence: event.confidence,
      requiresHumanReview,
    });

    return toDto(event, false);
  }

  async listForSession(sessionId: string): Promise<ProctorEventDto[]> {
    const events = await this.prisma.proctoringEvent.findMany({
      where: { sessionId },
      orderBy: { occurredAt: 'asc' },
    });
    return events.map((e) => toDto(e, false));
  }

  /** Reviewer acknowledgement. Records who looked and what they concluded. */
  async acknowledge(eventId: string, reviewerId: string, note?: string): Promise<void> {
    const event = await this.prisma.proctoringEvent.findUnique({ where: { id: eventId } });
    if (!event) throw AppError.notFound('That proctoring event could not be found.');
    await this.prisma.proctoringEvent.update({
      where: { id: eventId },
      data: { acknowledged: true, acknowledgedById: reviewerId, acknowledgedAt: new Date() },
    });
    if (note) {
      await this.prisma.reviewerNote.create({
        data: { sessionId: event.sessionId, authorId: reviewerId, note: `Proctoring event ${event.type}: ${note}`, decision: 'PROCTORING_ACKNOWLEDGED' },
      });
    }
    this.logger.info('proctoring_event_acknowledged', { eventId, reviewerId, type: event.type });
  }

  async setRequiresReview(_sessionId: string, eventId: string, required: boolean): Promise<void> {
    await this.prisma.proctoringEvent.update({ where: { id: eventId }, data: { requiresHumanReview: required } });
  }

  /** Short-lived signed URL for a snapshot. Never a public object URL. */
  async snapshotUrl(eventId: string, ttlSeconds: number): Promise<{ url: string; expiresAt: Date }> {
    const event = await this.prisma.proctoringEvent.findUnique({ where: { id: eventId } });
    if (!event?.snapshotKey) throw AppError.notFound('No snapshot is available for that event.');
    return this.storage.presignDownload(event.snapshotKey, ttlSeconds, `proctoring-${event.type}-${event.id}.jpg`);
  }

  private async storeSnapshot(
    sessionId: string,
    input: ProctorReportInput,
    config: ProctoringConfig,
  ): Promise<string | null> {
    if (!config.snapshotOnEvent || !input.snapshotBase64) return null;
    try {
      const { base64, contentType } = decodeBase64Image(input.snapshotBase64);
      if (!base64) return null;
      const key = `snapshots/${sessionId}/${Date.now()}-${input.type}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
      await this.storage.put(key, base64, contentType);
      return key;
    } catch (err) {
      this.logger.warn('proctor_snapshot_store_failed', { sessionId, type: input.type, err });
      return null;
    }
  }
}

/**
 * Appends to a session timeline.
 *
 * Read-modify-write, because Prisma's JSON `push` operator is written literally by the
 * client and would replace the array with an object rather than extending it.
 */
async function appendSessionTimeline(
  prisma: PrismaClient,
  sessionId: string,
  kind: string,
  detail: string,
): Promise<void> {
  const row = await prisma.interviewSession.findUnique({
    where: { id: sessionId },
    select: { timeline: true },
  });
  const current = Array.isArray(row?.timeline) ? (row!.timeline as unknown[]) : [];
  const next = [...current.slice(-199), { at: new Date().toISOString(), kind, detail }];
  await prisma.interviewSession.update({ where: { id: sessionId }, data: { timeline: next as never } });
}

function decodeBase64Image(data: string): { base64: Buffer | null; contentType: string } {
  const match = data.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (match) {
    return { base64: Buffer.from(match[2]!, 'base64'), contentType: match[1]!.replace('jpg', 'jpeg') };
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(data) && data.length > 128) {
    return { base64: Buffer.from(data, 'base64'), contentType: 'image/jpeg' };
  }
  return { base64: null, contentType: 'image/jpeg' };
}

function toDto(
  event: {
    id: string;
    type: ProctorEventType;
    occurredAt: Date;
    confidence: number;
    severity: Severity;
    description: string;
    reference: string | null;
    snapshotKey: string | null;
    stageKind: string | null;
    acknowledged: boolean;
    requiresHumanReview: boolean;
  },
  withSnapshotUrl: boolean,
): ProctorEventDto {
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    confidence: event.confidence,
    severity: event.severity,
    description: event.description,
    reference: event.reference,
    snapshotUrl: withSnapshotUrl && event.snapshotKey ? '/api/v1/admin/proctoring/snapshots' : null,
    stageKind: event.stageKind,
    acknowledged: event.acknowledged,
  };
}

/** Prevents log/DB injection through a free-text description. */
function sanitise(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}