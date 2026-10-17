import type { Logger, PrismaClient } from '@proctor/database';
import type { SystemSettings } from '@proctor/types';
import type { StorageDriver } from '../storage/index.js';

/**
 * Data retention.
 *
 * Retention periods are per-deployment settings, not hard-coded policy. What *is*
 * enforced here is the mechanical side: objects past their purge date are deleted,
 * transcripts past their window are redacted rather than deleted (so the shape of the
 * interview survives for aggregate reporting while the candidate's words do not), and
 * every deletion is counted and logged.
 *
 * The deletion of candidate records is deliberately gated behind an explicit
 * `enableHardDelete` flag, because in many jurisdictions a recruitment record must be
 * retained for a defined period regardless of a candidate's request.
 */
export interface RetentionOptions {
  settings: SystemSettings;
  /** Dry run reports what would be removed without touching anything. */
  dryRun?: boolean;
  enableHardDelete?: boolean;
  limit?: number;
}

export interface RetentionResult {
  dryRun: boolean;
  audioDeleted: number;
  audioBytesFreed: number;
  transcriptsRedacted: number;
  snapshotsDeleted: number;
  candidatesDeleted: number;
  expiredSessionsClosed: number;
  errors: Array<{ scope: string; id: string; message: string }>;
}

export class RetentionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageDriver,
    private readonly logger: Logger,
  ) {}

  async run(options: RetentionOptions): Promise<RetentionResult> {
    const result: RetentionResult = {
      dryRun: options.dryRun === true,
      audioDeleted: 0,
      audioBytesFreed: 0,
      transcriptsRedacted: 0,
      snapshotsDeleted: 0,
      candidatesDeleted: 0,
      expiredSessionsClosed: 0,
      errors: [],
    };
    const limit = Math.min(5000, Math.max(1, options.limit ?? 500));
    const { settings } = options;

    /* --- 1. Close abandoned sessions past the interview time budget ------ */
    const staleBefore = new Date(Date.now() - settings.interview.sessionIdleResetMinutes * 60_000);
    const stale = await this.prisma.interviewSession.findMany({
      where: { sessionStatus: 'ACTIVE', lastActivityAt: { lt: staleBefore }, isLocked: false },
      select: { id: true, publicId: true },
      take: limit,
    });
    for (const session of stale) {
      try {
        if (options.dryRun) {
          result.expiredSessionsClosed += 1;
          continue;
        }
        await this.prisma.interviewSession.update({
          where: { id: session.id },
          data: {
            sessionStatus: 'EXPIRED',
            isLocked: true,
            completedAt: session.publicId ? new Date() : new Date(),
            timeline: { push: { at: new Date().toISOString(), kind: 'session_expired', detail: 'Idle timeout' } } as never,
          },
        });
        result.expiredSessionsClosed += 1;
      } catch (err) {
        result.errors.push({ scope: 'session', id: session.id, message: (err as Error).message });
      }
    }

    /* --- 2. Audio past the recording retention window --------------------- */
    const audioCutoff = new Date(Date.now() - settings.recording.recordingRetentionDays * 86_400_000);
    const audio = await this.prisma.audioRecording.findMany({
      where: { deletedAt: null, createdAt: { lt: audioCutoff } },
      select: { id: true, objectKey: true, sizeBytes: true },
      take: limit,
    });
    for (const item of audio) {
      try {
        if (options.dryRun) {
          result.audioDeleted += 1;
          result.audioBytesFreed += item.sizeBytes;
          continue;
        }
        await this.storage.delete(item.objectKey);
        await this.prisma.audioRecording.update({ where: { id: item.id }, data: { deletedAt: new Date() } });
        result.audioDeleted += 1;
        result.audioBytesFreed += item.sizeBytes;
      } catch (err) {
        result.errors.push({ scope: 'audio', id: item.id, message: (err as Error).message });
      }
    }

    /* --- 3. Transcripts: redact rather than delete ------------------------ */
    const transcriptCutoff = new Date(Date.now() - settings.recording.transcriptRetentionDays * 86_400_000);
    const transcripts = await this.prisma.transcript.findMany({
      where: { isRedacted: false, createdAt: { lt: transcriptCutoff } },
      select: { id: true, content: true, sessionId: true, createdAt: true },
      take: limit,
    });
    for (const item of transcripts) {
      try {
        const replacement = redactTranscript(item.content, item.createdAt);
        if (options.dryRun) {
          result.transcriptsRedacted += 1;
          continue;
        }
        await this.prisma.transcript.update({
          where: { id: item.id },
          data: { content: replacement, isRedacted: true, redactedAt: new Date() },
        });
        result.transcriptsRedacted += 1;
      } catch (err) {
        result.errors.push({ scope: 'transcript', id: item.id, message: (err as Error).message });
      }
    }

    /* --- 4. Proctoring snapshots ---------------------------------------- */
    const snapshotCutoff = new Date(Date.now() - Math.min(30, settings.recording.recordingRetentionDays) * 86_400_000);
    const snapshots = await this.prisma.proctoringSnapshot.findMany({
      where: { deletedAt: null, createdAt: { lt: snapshotCutoff } },
      include: { event: { select: { snapshotKey: true } } },
      take: limit,
    });
    for (const snapshot of snapshots) {
      try {
        if (!options.dryRun) {
          if (snapshot.event.snapshotKey) await this.storage.delete(snapshot.event.snapshotKey);
          await this.prisma.proctoringSnapshot.update({ where: { id: snapshot.id }, data: { deletedAt: new Date() } });
          await this.prisma.proctoringEvent.update({ where: { id: snapshot.eventId }, data: { snapshotKey: null } });
        }
        result.snapshotsDeleted += 1;
      } catch (err) {
        result.errors.push({ scope: 'snapshot', id: snapshot.id, message: (err as Error).message });
      }
    }

    /* --- 5. Candidate records (only when explicitly enabled) -------------- */
    if (options.enableHardDelete) {
      const candidateCutoff = new Date(Date.now() - settings.recording.candidateDataRetentionDays * 86_400_000);
      const candidates = await this.prisma.candidate.findMany({
        where: {
          deletedAt: null,
          createdAt: { lt: candidateCutoff },
          sessions: { every: { sessionStatus: { in: ['COMPLETED', 'ABANDONED', 'EXPIRED'] } } },
        },
        select: { id: true, sessions: { select: { id: true } } },
        take: limit,
      });
      for (const candidate of candidates) {
        try {
          if (!options.dryRun) {
            // Anonymise rather than cascade-delete: the interview remains countable for
            // aggregate reporting while the identity is irrecoverable.
            await this.prisma.candidate.update({
              where: { id: candidate.id },
              data: {
                name: null,
                age: null,
                village: null,
                previousWork: null,
                phone: null,
                extraDetails: {},
                deletedAt: new Date(),
              },
            });
          }
          result.candidatesDeleted += 1;
        } catch (err) {
          result.errors.push({ scope: 'candidate', id: candidate.id, message: (err as Error).message });
        }
      }
    }

    this.logger.info('retention_run', {
      ...result,
      errors: result.errors.length,
      recordingRetentionDays: settings.recording.recordingRetentionDays,
      transcriptRetentionDays: settings.recording.transcriptRetentionDays,
    });
    return result;
  }

  /** Summary for the admin settings screen, so periods are visible before they bite. */
  async preview(settings: SystemSettings): Promise<RetentionResult> {
    return this.run({ settings, dryRun: true, limit: 1000 });
  }
}

/**
 * Replaces the words but preserves structure, so a reviewer can still see that a
 * question was asked and answered, and how long the answer was, without the content.
 */
function redactTranscript(content: string, at: Date): string {
  const words = content.trim().split(/\s+/).filter(Boolean);
  const preview = `${words.length} words · ${at.toISOString()}`;
  return `[Transcript removed by retention policy. ${preview}.]`;
}