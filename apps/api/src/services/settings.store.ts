import { systemSettingsSchema, type SystemSettings } from '@proctor/types';
import type { Env } from '@proctor/config';
import type { Logger, PrismaClient } from '@proctor/database';
import { deepMerge } from '../lib/merge.js';

/**
 * System settings store.
 *
 * Layers two sources, in priority order:
 *   1. the `SystemSetting` row an administrator has edited
 *   2. environment defaults, so a fresh deployment is fully configured
 *
 * Read-through with a short TTL cache: the interview engine reads settings on every
 * turn, and a database round-trip per turn would add latency to a live conversation.
 * Writes invalidate the cache immediately and bump the row version, so two API
 * instances converge without a restart.
 */
export class SettingsStore {
  private cache: { value: SystemSettings; expiresAt: number } | null = null;
  private inflight: Promise<SystemSettings> | null = null;
  private readonly ttlMs = 5_000;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env,
    private readonly logger: Logger,
  ) {}

  /** Values derived purely from environment variables. */
  envDefaults(): SystemSettings {
    return systemSettingsSchema.parse({
      general: {
        siteName: 'Rajapalayam Mills (Ramco Group)',
        defaultLanguage: this.env.DEFAULT_LANGUAGE,
        fallbackLanguage: this.env.FALLBACK_LANGUAGE,
        supportedLanguages: this.env.SUPPORTED_LANGUAGES,
        timezone: 'Asia/Kolkata',
        privacyNoticeRequired: this.env.PRIVACY_NOTICE_REQUIRED,
        jurisdictionNote: this.env.JURISDICTION_NOTE,
      },
      voice: {
        provider: this.env.STT_PROVIDER,
        ttsProvider: this.env.TTS_PROVIDER,
        sttProvider: this.env.STT_PROVIDER,
        rate: this.env.TTS_RATE,
        pitch: this.env.TTS_PITCH,
        volume: this.env.TTS_VOLUME,
        slowRate: this.env.TTS_SLOW_RATE,
        interruptible: this.env.BARGE_IN_ENABLED,
        maxAnswerSeconds: this.env.STT_MAX_ANSWER_SECONDS,
        silenceTimeoutSeconds: this.env.STT_SILENCE_TIMEOUT_SECONDS,
        bargeInEnabled: this.env.BARGE_IN_ENABLED,
      },
      interview: {
        maxDurationMinutes: this.env.INTERVIEW_MAX_DURATION_MINUTES,
        retryLimit: this.env.INTERVIEW_RETRY_LIMIT,
        simplifyAfterAttempts: Math.max(1, this.env.INTERVIEW_RETRY_LIMIT),
        followUpMode: this.env.FOLLOW_UP_MODE,
        maxFollowUpsPerQuestion: this.env.MAX_FOLLOW_UPS_PER_QUESTION,
        repeatWelcome: false,
        sessionIdleResetMinutes: this.env.SESSION_TIMEOUT_MINUTES,
        kioskResetDelaySeconds: this.env.KIOSK_RESET_DELAY_SECONDS,
        interviewerPromptOverride: '',
        discloseScoreToCandidate: false,
      },
      scoring: {
        strictness: this.env.SCORING_STRICTNESS,
        passingScore: this.env.DEFAULT_PASSING_SCORE,
        confidenceFloor: this.env.SCORING_CONFIDENCE_FLOOR,
        requireHumanReviewBelowConfidence: this.env.REQUIRE_HUMAN_REVIEW_BELOW_CONFIDENCE,
        autoRecommend: this.env.AUTO_RECOMMEND,
      },
      proctoring: {
        level: this.env.PROCTOR_LEVEL,
        cameraEnabled: this.env.PROCTOR_CAMERA_ENABLED,
        detectMultiplePeople: true,
        detectFacingAway: false,
        facingAwaySeconds: 20,
        kioskFullscreenEnforced: this.env.KIOSK_ENFORCE_FULLSCREEN,
        snapshotOnEvent: false,
      },
      recording: {
        storeAudio: true,
        storeTranscript: true,
        recordingRetentionDays: this.env.RECORDING_RETENTION_DAYS,
        transcriptRetentionDays: this.env.TRANSCRIPT_RETENTION_DAYS,
        candidateDataRetentionDays: this.env.CANDIDATE_DATA_RETENTION_DAYS,
        signedUrlTtlSeconds: this.env.SIGNED_URL_TTL_SECONDS,
        anonymizeTranscriptsAfterDays: null,
      },
      ai: {
        llmProvider: this.env.LLM_PROVIDER,
        evaluationProvider: this.env.EVALUATION_PROVIDER,
        model: this.env.LLM_MODEL,
        evaluationModel: this.env.EVALUATION_MODEL,
        temperature: this.env.LLM_TEMPERATURE,
        maxTokens: this.env.LLM_MAX_TOKENS,
        demoMode: this.env.DEMO_MODE,
      },
      kiosk: {
        kioskId: this.env.KIOSK_ID,
        sessionTimeoutMinutes: this.env.SESSION_TIMEOUT_MINUTES,
        preventRefresh: true,
        clearLocalDataOnReset: true,
        autoStartAudio: true,
        requireWakeWord: false,
        accessibility: { reducedMotion: false, highContrast: false, largeText: true },
      },
    });
  }

  async get(): Promise<SystemSettings> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      const base = this.envDefaults();
      let merged = base;
      try {
        const row = await this.prisma.systemSetting.findUnique({ where: { scope: 'global' } });
        if (row?.payload) {
          merged = systemSettingsSchema.parse(deepMerge(base, row.payload as Record<string, unknown>));
        }
      } catch (err) {
        // A corrupt settings row must never take the kiosk offline.
        this.logger.error('settings_read_failed_using_env_defaults', { err });
        merged = base;
      }
      this.cache = { value: merged, expiresAt: Date.now() + this.ttlMs };
      this.inflight = null;
      return merged;
    })();

    return this.inflight;
  }

  /** Merges a partial patch, validates the result, and persists it. */
  async update(patch: Record<string, unknown>, actorId: string | null): Promise<SystemSettings> {
    const current = await this.get();
    const candidate = systemSettingsSchema.parse(deepMerge(current, patch));
    await this.prisma.systemSetting.upsert({
      where: { scope: 'global' },
      create: {
        scope: 'global',
        payload: candidate as never,
        version: 1,
        changedById: actorId,
        changedAt: new Date(),
      },
      update: {
        payload: candidate as never,
        version: { increment: 1 },
        changedById: actorId,
        changedAt: new Date(),
      },
    });
    this.cache = { value: candidate, expiresAt: Date.now() + this.ttlMs };
    return candidate;
  }

  invalidate(): void {
    this.cache = null;
  }

  /** Removes admin overrides, returning the deployment to environment defaults. */
  async reset(actorId: string | null): Promise<SystemSettings> {
    // Record who reverted the deployment to environment defaults.
    await this.prisma.auditLog.create({
      data: { action: 'settings.changed', entityType: 'system_setting', entityId: 'global', next: { reset: true, actorId } },
    });
    await this.prisma.systemSetting.deleteMany({ where: { scope: 'global' } });
    this.invalidate();
    return this.get();
  }
}