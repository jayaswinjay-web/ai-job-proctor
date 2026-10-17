import type { Logger, PrismaClient } from '@proctor/database';
import type { SystemSettings } from '@proctor/types';
import { AppError } from '../lib/errors.js';
import { AuditService, type AuditActor } from '../lib/audit.js';
import { buildObjectKey, extensionFor, type StorageDriver } from '../storage/index.js';
import { hashIp } from '../lib/crypto.js';

/**
 * Interview audio handling.
 *
 * Privacy properties enforced here
 * ---------------------------------
 *  * Recording is opt-in per deployment. When `recording.storeAudio` is false, no
 *    upload ticket is ever issued, so a kiosk cannot retain audio even if it tries.
 *  * Consent must have been recorded before a ticket is issued.
 *  * Access is always through a short-lived signed URL; the storage key alone is never
 *    sufficient, and every access is written to the audit log.
 *  * Each recording carries a `purgeAfter` timestamp derived from the retention
 *    setting, so the storage layer can delete objects without consulting the app.
 */
export class AudioService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageDriver,
    private readonly logger: Logger,
    private readonly audit: AuditService,
    private readonly settingsProvider: () => Promise<SystemSettings>,
    private readonly ipSalt: string,
  ) {}

  /**
   * Issues a signed upload target. The kiosk either PUTs straight to storage or falls
   * back to `uploadDirect` when the storage driver cannot accept a browser PUT.
   */
  async createUploadTicket(
    sessionId: string,
    input: { answerId: string | null; kind: 'ANSWER' | 'FULL_SESSION'; contentType: string; durationMs: number },
  ): Promise<{ uploadUrl: string; objectKey: string; expiresAt: string; method: 'PUT'; headers: Record<string, string> }> {
    const settings = await this.settingsProvider();
    if (!settings.recording.storeAudio) {
      throw AppError.validation('Audio recording is disabled on this kiosk.');
    }

    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      select: { publicId: true, consentRecorded: true, isLocked: true },
    });
    if (!session) throw AppError.notFound('That session could not be found.');
    if (!session.consentRecorded) {
      throw AppError.forbidden('Recording requires the candidate to have agreed to the privacy notice.');
    }
    if (session.isLocked) throw AppError.locked('This interview has finished; audio can no longer be added.');

    const key = buildObjectKey({
      sessionPublicId: session.publicId,
      kind: 'audio',
      extension: extensionFor(input.contentType, 'webm'),
    });
    const purgeAfter = new Date(Date.now() + settings.recording.recordingRetentionDays * 86_400_000);
    const ticket = await this.storage.presignUpload(key, input.contentType, settings.recording.signedUrlTtlSeconds);

    // Register the row up front so an orphaned object can still be found and purged.
    const recording = await this.prisma.audioRecording.create({
      data: {
        sessionId,
        answerId: input.answerId,
        kind: input.kind,
        objectKey: key,
        contentType: input.contentType,
        durationMs: input.durationMs,
        encrypted: true,
        consentBasis: 'CONSENT_RECORDED',
        purgeAfter,
      },
    });

    this.logger.info('audio_upload_ticket_issued', {
      sessionId,
      recordingId: recording.id,
      kind: input.kind,
      contentType: input.contentType,
      durationMs: input.durationMs,
    });

    return {
      uploadUrl: ticket.uploadUrl,
      objectKey: ticket.objectKey,
      expiresAt: ticket.expiresAt.toISOString(),
      method: ticket.method,
      headers: ticket.headers,
    };
  }

  /** Server-side upload path, used when the kiosk cannot PUT to storage directly. */
  async uploadDirect(
    sessionId: string,
    body: Buffer,
    input: { answerId: string | null; contentType: string; durationMs: number },
  ): Promise<{ id: string; objectKey: string }> {
    const settings = await this.settingsProvider();
    if (!settings.recording.storeAudio) throw AppError.validation('Audio recording is disabled on this kiosk.');
    if (body.byteLength === 0) throw AppError.validation('The recording was empty.');
    if (body.byteLength > 8 * 1024 * 1024) throw AppError.validation('The recording is larger than this kiosk accepts.');

    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      select: { publicId: true, consentRecorded: true, isLocked: true },
    });
    if (!session) throw AppError.notFound('That session could not be found.');
    if (!session.consentRecorded) throw AppError.forbidden('Recording requires the candidate to have agreed.');
    if (session.isLocked) throw AppError.locked('This interview has finished.');

    const key = buildObjectKey({
      sessionPublicId: session.publicId,
      kind: 'audio',
      extension: extensionFor(input.contentType, 'webm'),
    });
    await this.storage.put(key, body, input.contentType);
    const recording = await this.prisma.audioRecording.create({
      data: {
        sessionId,
        answerId: input.answerId,
        kind: 'ANSWER',
        objectKey: key,
        contentType: input.contentType,
        durationMs: input.durationMs,
        sizeBytes: body.byteLength,
        encrypted: true,
        consentBasis: 'CONSENT_RECORDED',
        purgeAfter: new Date(Date.now() + settings.recording.recordingRetentionDays * 86_400_000),
      },
    });
    return { id: recording.id, objectKey: key };
  }

  /** Records that a direct-to-storage upload landed, so size and duration are accurate. */
  async confirmUpload(recordingId: string, sizeBytes: number, durationMs: number): Promise<void> {
    await this.prisma.audioRecording.update({
      where: { id: recordingId },
      data: { sizeBytes, durationMs },
    });
  }

  async listForSession(sessionId: string): Promise<Array<{ id: string; kind: string; durationMs: number; createdAt: string }>> {
    const rows = await this.prisma.audioRecording.findMany({
      where: { sessionId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, kind: r.kind, durationMs: r.durationMs, createdAt: r.createdAt.toISOString() }));
  }

  /**
   * Issues a short-lived signed URL for a reviewer. Every issuance is audited, so
   * "who listened to this recording and when" is always answerable.
   */
  async signedUrl(recordingId: string, actor: AuditActor, settings?: SystemSettings): Promise<{ url: string; expiresAt: string }> {
    const recording = await this.prisma.audioRecording.findFirst({
      where: { id: recordingId, deletedAt: null },
      include: { session: { select: { publicId: true, id: true } } },
    });
    if (!recording) throw AppError.notFound('That recording could not be found.');

    const ttl = settings?.recording.signedUrlTtlSeconds ?? 300;
    const signed = await this.storage.presignDownload(
      recording.objectKey,
      ttl,
      `answer-${recording.id}.${extensionFor(recording.contentType, 'webm')}`,
    );

    await this.audit.record({
      action: 'recording.accessed',
      entityType: 'audio_recording',
      entityId: recording.id,
      next: { sessionPublicId: recording.session.publicId, expiresAt: signed.expiresAt.toISOString() },
      actor,
    });

    this.logger.info('recording_access_granted', {
      recordingId,
      sessionId: recording.session.id,
      actor: actor.id,
      ipHash: hashIp(actor.ip, this.ipSalt),
      ttlSeconds: ttl,
    });

    return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
  }

  async deleteRecording(recordingId: string, actor: AuditActor): Promise<void> {
    const recording = await this.prisma.audioRecording.findFirst({ where: { id: recordingId } });
    if (!recording) throw AppError.notFound('That recording could not be found.');
    await this.storage.delete(recording.objectKey);
    await this.prisma.audioRecording.update({ where: { id: recordingId }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: 'candidate.deleted',
      entityType: 'audio_recording',
      entityId: recordingId,
      next: { deleted: true, reason: 'recording_removed_by_reviewer' },
      actor,
    });
    this.logger.info('recording_deleted', { recordingId, actor: actor.id });
  }

  /**
   * Verifies a kiosk upload signature issued by the local storage driver.
   *
   * For S3 the browser PUTs straight to object storage with its own pre-signed URL, so
   * nothing traverses this API and there is nothing to verify. For the local driver we
   * check the HMAC on the exact (purpose, key, expiry, content-type, length) tuple.
   */
  async verifyUploadSignature(input: {
    key: string;
    contentType: string;
    expiresAt: string;
    signature: string;
    contentLength?: number;
  }): Promise<boolean> {
    const local = this.storage as unknown as {
      verifySignature?: (purpose: string, key: string, expiresAtIso: string, token: string, extra?: string) => boolean;
    };
    if (typeof local.verifySignature !== 'function') return true;
    const extra = input.contentLength === undefined ? '' : `${input.contentType}:${input.contentLength}`;
    return local.verifySignature('PUT', input.key, input.expiresAt, input.signature, extra);
  }
}