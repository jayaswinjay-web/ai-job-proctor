import type { Container } from '../container.js';
import { AuthService } from './auth.service.js';
import { JobService } from './job.service.js';
import { QuestionService } from './question.service.js';
import { ImportService } from './import.service.js';
import { SessionService } from './session.service.js';
import { ProctoringService } from './proctoring.service.js';
import { AnalyticsService } from './analytics.service.js';
import { ReviewService } from './review.service.js';
import { RetentionService } from './retention.service.js';
import { AudioService } from './audio.service.js';
import { ExportService } from './export.service.js';
import type { AuditService } from '../lib/audit.js';
import type { SystemSettings } from '@proctor/types';

/**
 * Service graph.
 *
 * Every service receives *providers* rather than snapshots for anything an administrator
 * can change at runtime (settings, audio retention). That is what makes a settings
 * change take effect on the next turn without a process restart, while still giving a
 * single turn one consistent view.
 */
export interface Services {
  auth: AuthService;
  jobs: JobService;
  questions: QuestionService;
  imports: ImportService;
  sessions: SessionService;
  proctoring: ProctoringService;
  analytics: AnalyticsService;
  reviews: ReviewService;
  retention: RetentionService;
  audio: AudioService;
  exports: ExportService;
}

export function registerServices(container: Container, audit: AuditService): Services {
  const { prisma, logger, ai, settings, storage, env } = container;
  const settingsProvider = () => settings.get();

  return {
    auth: new AuthService(prisma, env),
    jobs: new JobService(prisma, logger, audit),
    questions: new QuestionService({ prisma, logger, audit, llm: ai.llm, settings: settingsProvider }),
    imports: new ImportService(prisma, logger, audit),
    sessions: new SessionService({
      prisma,
      logger,
      ai: { llm: ai.llm, evaluation: ai.evaluation },
      settings: settingsProvider,
      demoMode: env.DEMO_MODE,
      storage,
      retainAudio: true,
    }),
    proctoring: new ProctoringService(prisma, logger, storage),
    analytics: new AnalyticsService(prisma),
    reviews: new ReviewService(prisma, logger, audit, settingsProvider),
    retention: new RetentionService(prisma, storage, logger),
    audio: new AudioService(
      prisma,
      storage,
      logger,
      audit,
      settingsProvider,
      env.IP_HASH_SALT || env.AUTH_SECRET,
    ),
    exports: new ExportService(prisma, logger, audit),
  };
}

export type { SystemSettings };