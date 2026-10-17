import { Hono } from 'hono';
import { z } from 'zod';
import { createLogger, newErrorId } from '@proctor/database';
import { voiceAiConfigured } from '@proctor/config';
import {
  audioUploadTicketSchema,
  proctorEventReportSchema,
  restVoiceTurnSchema,
  sessionIdParamSchema,
  startSessionSchema,
} from '@proctor/types';
import { AppError, toAppError } from './lib/errors.js';
import { deriveKioskKey } from './lib/crypto.js';
import { bearerToken, isTrustedAgent } from './lib/livekit.js';
import { createLivekitToken, livekitRoomName } from './lib/livekit.js';
import { toClientPayload } from './lib/client-payload.js';
import { parseJobProctoring } from './services/plan-builder.js';
import { AuditService } from './lib/audit.js';
import { registerServices, type Services } from './services/registry.js';
import { createWorkerContainer, type WorkerContainer } from './worker-container.js';

/**
 * Cloudflare Worker surface for the VoiceHire API.
 *
 * The deployed runtime. It wires the same services as the Fastify app so interview
 * behaviour is identical; only the HTTP layer differs, because a Worker has no Node
 * `http` server for Fastify to bind to. Route shapes mirror `routes/agent.routes.ts`
 * and `routes/kiosk.routes.ts` deliberately, so both surfaces stay comparable.
 *
 * Not carried over from the Node surface: the raw-body audio upload, media
 * upload/download and server-side transcription endpoints. Those serve the browser
 * speech fallback, which the LiveKit voice flow replaces; the kiosk records no audio
 * that this API must store.
 */

type Bindings = Record<string, unknown>;

/** Routes accept JSON bodies; parse with the same schemas the Node surface validates with. */
async function jsonBody<T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw AppError.validation('Request body must be valid JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw AppError.validation('Invalid request body.', parsed.error.flatten());
  return parsed.data;
}

export function createWorkerApp(bindings: Bindings) {
  const app = new Hono<{ Bindings: Bindings }>();

  // One container per isolate, built on first use so module scope can run without
  // secrets (it cannot read .env) and a cold isolate pays construction only once.
  let container: WorkerContainer | undefined;
  let services: Services | undefined;

  const ctx = () => {
    if (!container) {
      container = createWorkerContainer(bindings);
      const audit = new AuditService(
        container.prisma,
        container.logger,
        container.env.IP_HASH_SALT || container.env.AUTH_SECRET,
      );
      services = registerServices(container, audit);
    }
    return { container, services: services! };
  };

  app.onError((err, c) => {
    const error = toAppError(err);
    const errorId = err instanceof AppError ? err.errorId : newErrorId();
    const maybe = ctx();
    const logFields = {
      errorId,
      code: error.code,
      statusCode: error.statusCode,
      method: c.req.method,
      route: c.req.path,
    };
    if (error.statusCode >= 500) maybe.container?.logger.error('request_failed', { ...logFields, err });
    else maybe.container?.logger.warn('request_rejected', logFields);
    return c.json(
      {
        error: {
          code: error.code,
          message: error.userMessage,
          userMessage: error.userMessage,
          errorId,
        },
      },
      error.statusCode as 400,
    );
  });

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: `Nothing is served at ${c.req.path}.`,
          userMessage: null,
          errorId: null,
        },
      },
      404,
    ),
  );

  /* ---- health + discovery ---------------------------------------------- */
  app.get('/healthz', (c) => {
    const { container } = ctx();
    return c.json({ status: 'ok', version: container.version, demoMode: container.env.DEMO_MODE });
  });

  app.get('/', (c) => {
    const { container } = ctx();
    return c.json({
      service: 'Voice Screening Kiosk API',
      version: container.version,
      demoMode: container.env.DEMO_MODE,
      api: container.env.API_BASE_PATH,
      health: container.env.HEALTHCHECK_PATH,
    });
  });

  /* ===================================================================== */
  /* Cloud voice agent                                                     */
  /* ===================================================================== */
  const agent = new Hono<{ Bindings: Bindings }>();
  agent.use('*', async (c, next) => {
    const { container } = ctx();
    const trusted = isTrustedAgent(container.env, bearerToken(c.req.header('authorization')));
    if (!trusted) throw AppError.unauthenticated('Agent credentials are required.');
    await next();
  });

  /** Everything the agent needs to greet the candidate and let them choose by voice. */
  agent.get('/agent/context', async (c) => {
    const { container, services } = ctx();
    const settings = await container.settings.get();
    const [jobs, languages] = await Promise.all([
      services.jobs.publicList(),
      container.prisma.language.findMany({ where: { enabled: true, deletedAt: null }, orderBy: { sortOrder: 'asc' } }),
    ]);
    return c.json({
      defaultLanguage: container.env.VOICE_DEFAULT_LANGUAGE,
      supportedLanguages: settings.general.supportedLanguages,
      privacyNoticeRequired: settings.general.privacyNoticeRequired,
      jurisdictionNote: settings.general.jurisdictionNote,
      candidateNameRequired: true,
      jobs: jobs.map((j) => ({ id: j.id, title: j.title, description: j.description })),
      languages: languages.map((l) => ({
        code: l.code,
        name: l.name,
        nativeName: l.nativeName,
        sttLocale: l.sttLocale,
        ttsVoiceHint: l.ttsVoiceHint,
      })),
    });
  });

  agent.post('/agent/sessions', async (c) => {
    const { container, services } = ctx();
    const body = await jsonBody(
      c,
      z.object({
        roomName: z.string().min(1).max(128),
        jobId: z.string().uuid(),
        languageCode: z.string().min(2).max(12),
        consentGiven: z.boolean().optional(),
      }),
    );
    services.sessions.resetSettingsCache();
    const started = await services.sessions.start({
      jobId: body.jobId,
      kioskId: `voice-${body.roomName}`.slice(0, 64),
      languageCode: body.languageCode,
      ...(body.consentGiven !== undefined ? { consentGiven: body.consentGiven } : {}),
    });
    const job = await container.prisma.job.findUnique({ where: { id: body.jobId }, select: { title: true } });
    await container.prisma.interviewSession.update({
      where: { id: started.sessionId },
      data: { voiceTransport: 'livekit', livekitRoomName: body.roomName, voiceConnectedAt: new Date() },
    });
    return c.json({
      sessionId: started.sessionId,
      publicId: started.publicId,
      sessionSecret: deriveKioskKey(started.publicId, container.env.AUTH_SECRET).slice(0, 24),
      languageCode: started.languageCode,
      totalQuestions: started.totalQuestions,
      jobTitle: job?.title ?? '',
      state: started.state,
    });
  });

  agent.get('/agent/sessions/:publicId/context', async (c) => {
    const { container } = ctx();
    const publicId = c.req.param('publicId');
    const session = await container.prisma.interviewSession.findUnique({
      where: { publicId },
      select: {
        id: true,
        publicId: true,
        sessionState: true,
        stageKind: true,
        languageCode: true,
        totalQuestions: true,
        isLocked: true,
        consentRecorded: true,
        job: { select: { id: true, title: true, description: true } },
      },
    });
    if (!session) throw AppError.notFound('Unknown interview session.');
    const settings = await container.settings.get();
    const languages = await container.prisma.language.findMany({
      where: { enabled: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return c.json({
      sessionId: session.id,
      publicId: session.publicId,
      state: session.sessionState,
      stage: session.stageKind,
      languageCode: session.languageCode,
      totalQuestions: session.totalQuestions,
      isLocked: session.isLocked,
      consentRecorded: session.consentRecorded,
      job: session.job,
      defaultLanguage: container.env.VOICE_DEFAULT_LANGUAGE,
      supportedLanguages: settings.general.supportedLanguages,
      languages: languages.map((l) => ({ code: l.code, name: l.name, nativeName: l.nativeName, sttLocale: l.sttLocale })),
    });
  });

  /** Resolves a public id to the internal session id the services expect. */
  const agentSessionId = async (publicId: string) => {
    const { container } = ctx();
    const session = await container.prisma.interviewSession.findUnique({
      where: { publicId },
      select: { id: true },
    });
    if (!session) throw AppError.notFound('Unknown interview session.');
    return session.id;
  };

  agent.post('/agent/sessions/:publicId/consent', async (c) => {
    const { services } = ctx();
    const body = await jsonBody(c, z.object({ given: z.boolean() }));
    const id = await agentSessionId(c.req.param('publicId'));
    services.sessions.resetSettingsCache();
    return c.json(toClientPayload(await services.sessions.recordConsent(id, body.given)));
  });

  agent.post('/agent/sessions/:publicId/language', async (c) => {
    const { services } = ctx();
    const body = await jsonBody(c, z.object({ languageCode: z.string().min(2).max(12) }));
    const id = await agentSessionId(c.req.param('publicId'));
    services.sessions.resetSettingsCache();
    return c.json(toClientPayload(await services.sessions.changeLanguage(id, body.languageCode)));
  });

  /** The main voice turn: the agent submits what the candidate said. */
  agent.post('/agent/sessions/:publicId/turns', async (c) => {
    const { services } = ctx();
    const body = await jsonBody(
      c,
      z.object({
        transcript: z.string().max(4000),
        spokenLanguage: z.string().max(12).nullable().optional(),
        confidence: z.number().min(0).max(1).optional(),
        durationMs: z.number().int().min(0).optional(),
      }),
    );
    const id = await agentSessionId(c.req.param('publicId'));
    services.sessions.resetSettingsCache();
    await services.sessions.assertWithinTimeBudget(id);
    return c.json(
      toClientPayload(
        await services.sessions.handleVoiceTurn(id, {
          transcript: body.transcript.slice(0, 4000),
          spokenLanguage: body.spokenLanguage ?? null,
          confidence: body.confidence ?? 0.8,
          durationMs: body.durationMs ?? 0,
        }),
      ),
    );
  });

  agent.post('/agent/sessions/:publicId/advance', async (c) => {
    const { services } = ctx();
    const id = await agentSessionId(c.req.param('publicId'));
    services.sessions.resetSettingsCache();
    return c.json(toClientPayload(await services.sessions.advance(id)));
  });

  agent.post('/agent/sessions/:publicId/finish', async (c) => {
    const { container, services } = ctx();
    const id = await agentSessionId(c.req.param('publicId'));
    services.sessions.resetSettingsCache();
    await services.sessions.finaliseSession(id);
    const settings = await container.settings.get();
    return c.json({
      completed: true,
      revealScore: settings.interview.discloseScoreToCandidate,
      resetDelaySeconds: settings.interview.kioskResetDelaySeconds,
    });
  });

  agent.post('/agent/sessions/:publicId/agent-session', async (c) => {
    const { container } = ctx();
    const body = await jsonBody(
      c,
      z.object({ voiceAgentSessionId: z.string().min(1).max(128), roomName: z.string().min(1).max(128) }),
    );
    const session = await container.prisma.interviewSession.update({
      where: { publicId: c.req.param('publicId') },
      data: {
        voiceAgentSessionId: body.voiceAgentSessionId,
        livekitRoomName: body.roomName,
        voiceConnectedAt: new Date(),
      },
      select: { id: true, publicId: true },
    });
    return c.json({ recorded: true, sessionId: session.id });
  });

  app.route('/', agent);

  /* ===================================================================== */
  /* Kiosk                                                                 */
  /* ===================================================================== */

  /** Stable kiosk identifier; mirrors `kioskIdFor` in the Node surface. */
  function kioskIdFor(ip: string, header: string | undefined): string {
    if (header && header.trim()) return header.trim().slice(0, 64);
    const cleaned = ip.replace(/[^A-Za-z0-9]/g, '').slice(-12);
    return `kiosk-${cleaned || 'default'}`;
  }

  /**
   * Verifies the per-session secret.
   *
   * The secret is derived server-side from the public id, so guessing a UUID is not
   * enough; every kiosk write must present it.
   */
  async function requireSessionSecret(sessionId: string, secret: string): Promise<void> {
    const { container } = ctx();
    const session = await container.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      select: { publicId: true, isLocked: true, sessionState: true },
    });
    if (!session) throw AppError.notFound('This session could not be found.');
    if (session.isLocked && (session.sessionState === 'COMPLETED' || session.sessionState === 'CANCELLED')) {
      throw AppError.locked('This interview has already finished.');
    }
    if (deriveKioskKey(session.publicId, container.env.AUTH_SECRET).slice(0, 24) !== secret) {
      container.logger.warn('kiosk_session_secret_mismatch', { sessionId });
      throw AppError.forbidden('This session is not valid on this kiosk.');
    }
  }

  async function requireSessionSecretForFinish(sessionId: string, secret: string): Promise<void> {
    const { container } = ctx();
    const session = await container.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      select: { publicId: true },
    });
    if (!session) throw AppError.notFound('This session could not be found.');
    if (deriveKioskKey(session.publicId, container.env.AUTH_SECRET).slice(0, 24) !== secret) {
      throw AppError.forbidden('This session is not valid on this kiosk.');
    }
  }

  const kiosk = new Hono<{ Bindings: Bindings }>();

  kiosk.get('/kiosk/bootstrap', async (c) => {
    const { container, services } = ctx();
    const settings = await container.settings.get();
    const languages = await container.prisma.language.findMany({
      where: { enabled: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    const jobs = await services.jobs.publicList();
    const kioskId = kioskIdFor(
      c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown',
      c.req.header('x-kiosk-id'),
    );
    const candidates = await services.analytics.activeSessionsForKiosk(
      kioskId,
      settings.interview.sessionIdleResetMinutes,
    );
    const first = candidates[0];
    const resume = first
      ? {
          sessionId: first.sessionId,
          publicId: first.publicId,
          state: first.state,
          jobTitle: first.jobTitle,
          questionIndex: first.questionIndex,
          totalQuestions: first.totalQuestions,
        }
      : null;

    return c.json({
      siteName: settings.general.siteName,
      demoMode: settings.ai.demoMode,
      providers: { stt: settings.voice.sttProvider, tts: settings.voice.ttsProvider },
      languages: languages.map((l) => ({
        code: l.code,
        name: l.name,
        nativeName: l.nativeName,
        sttLocale: l.sttLocale,
        ttsVoiceHint: l.ttsVoiceHint,
      })),
      jobs,
      privacyNoticeRequired: settings.general.privacyNoticeRequired,
      defaultLanguage: settings.general.defaultLanguage,
      consentPhraseKey: settings.general.privacyNoticeRequired ? 'consent_notice' : null,
      jurisdictionNote: settings.general.jurisdictionNote,
      kiosk: settings.kiosk,
      voice: {
        rate: settings.voice.rate,
        pitch: settings.voice.pitch,
        volume: settings.voice.volume,
        slowRate: settings.voice.slowRate,
        interruptible: settings.voice.interruptible,
        bargeInEnabled: settings.voice.bargeInEnabled,
        maxAnswerSeconds: settings.voice.maxAnswerSeconds,
        silenceTimeoutSeconds: settings.voice.silenceTimeoutSeconds,
      },
      scoring: {
        discloseScoreToCandidate: settings.interview.discloseScoreToCandidate,
        passingScore: settings.scoring.passingScore,
      },
      resetDelaySeconds: settings.interview.kioskResetDelaySeconds,
      sessionTimeoutMinutes: settings.interview.sessionIdleResetMinutes,
      demoScriptEnabled: settings.ai.demoMode,
      resume,
      voiceAi: {
        mode: container.env.VOICE_MODE,
        configured: voiceAiConfigured(container.env),
        defaultLanguage: container.env.VOICE_DEFAULT_LANGUAGE,
        livekitUrl: container.env.LIVEKIT_URL || null,
        agentName: container.env.VOICE_AGENT_NAME,
        allowBrowserFallback: container.env.ALLOW_BROWSER_VOICE_FALLBACK,
      },
    });
  });

  /** LiveKit token for the pre-interview intake conversation (no session exists yet). */
  kiosk.post('/kiosk/voice/intake-token', async (c) => {
    const { container } = ctx();
    if (!voiceAiConfigured(container.env)) {
      throw AppError.voiceAiNotConfigured(
        'Voice AI service is not configured. Please configure LiveKit Cloud and the required AI provider credentials.',
      );
    }
    const body = await jsonBody(c, z.object({ kioskId: z.string().min(1).max(64) }));
    const kioskId = body.kioskId.slice(0, 32);
    const roomName = `intake-${kioskId}-${Date.now().toString(36)}`;
    const identity = `kiosk-${kioskId}`;
    const token = createLivekitToken(container.env, {
      identity,
      name: 'Kiosk',
      room: roomName,
      metadata: JSON.stringify({ intake: true, kioskId, defaultLanguage: container.env.VOICE_DEFAULT_LANGUAGE }),
    });
    return c.json({
      url: container.env.LIVEKIT_URL,
      roomName,
      identity,
      token,
      expiresInSeconds: container.env.LIVEKIT_TOKEN_TTL_MINUTES * 60,
      agentName: container.env.VOICE_AGENT_NAME,
      defaultLanguage: container.env.VOICE_DEFAULT_LANGUAGE,
    });
  });

  kiosk.post('/kiosk/sessions', async (c) => {
    const { container, services } = ctx();
    const body = await jsonBody(c, startSessionSchema);
    services.sessions.resetSettingsCache();
    const started = await services.sessions.start({
      jobId: body.jobId,
      kioskId: (body.kioskId ?? 'kiosk').slice(0, 64),
      ...(body.languageCode ? { languageCode: body.languageCode } : {}),
      ...(body.consentGiven !== undefined ? { consentGiven: body.consentGiven } : {}),
      ...(body.demoMode !== undefined ? { demoMode: body.demoMode } : {}),
    });
    const job = await container.prisma.job.findUniqueOrThrow({
      where: { id: body.jobId },
      select: { proctoring: true, title: true },
    });
    const settings = await container.settings.get();
    const jobProctoring = parseJobProctoring(job.proctoring);
    return c.json({
      sessionId: started.sessionId,
      publicId: started.publicId,
      sessionSecret: deriveKioskKey(started.publicId, container.env.AUTH_SECRET).slice(0, 24),
      state: started.state,
      languageCode: started.languageCode,
      totalQuestions: started.totalQuestions,
      jobTitle: job.title,
      proctoring: {
        level: settings.proctoring.level === 'DISABLED' ? 'DISABLED' : jobProctoring.level,
        cameraEnabled: jobProctoring.cameraEnabled && settings.proctoring.cameraEnabled,
        detectMultiplePeople: jobProctoring.detectMultiplePeople,
        detectFacingAway: jobProctoring.detectFacingAway,
        facingAwaySeconds: settings.proctoring.facingAwaySeconds,
        kioskFullscreenEnforced: jobProctoring.kioskFullscreenEnforced,
        snapshotOnEvent: settings.proctoring.snapshotOnEvent,
      },
    });
  });

  const sessionIdSchema = sessionIdParamSchema;

  kiosk.get('/kiosk/sessions/:id', async (c) => {
    const { services } = ctx();
    const { id } = sessionIdSchema.parse({ id: c.req.param('id') });
    const loaded = await services.sessions.loadState(id);
    if (!loaded) throw AppError.notFound('This session could not be resumed. Please start again.');
    const row = await services.prisma.interviewSession.findUnique({ where: { id }, select: { publicId: true } });
    return c.json({
      sessionId: id,
      publicId: row?.publicId ?? '',
      state: loaded.state.state,
      stage: loaded.state.stageKind,
      languageCode: loaded.languageCode,
      answered: Object.keys(loaded.state.answers).length,
      total: loaded.state.plan.questions.length,
      locked: loaded.isLocked,
    });
  });

  /** Short-lived LiveKit token for the interview room. */
  kiosk.post('/kiosk/sessions/:id/voice-token', async (c) => {
    const { container } = ctx();
    if (!voiceAiConfigured(container.env)) {
      throw AppError.voiceAiNotConfigured('Voice AI service is not configured.');
    }
    const { id } = sessionIdSchema.parse({ id: c.req.param('id') });
    const body = await jsonBody(c, z.object({ sessionSecret: z.string().min(8).max(128) }));
    await requireSessionSecret(id, body.sessionSecret, requireSessionSecretForFinishCheck());

    const session = await container.prisma.interviewSession.findUnique({
      where: { id },
      select: { publicId: true, languageCode: true, sessionState: true, isLocked: true },
    });
    if (!session) throw AppError.notFound('This session could not be found.');
    if (session.isLocked) throw AppError.locked('This interview has already finished.');

    const roomName = livekitRoomName(session.publicId);
    const token = createLivekitToken(container.env, {
      identity: `kiosk-${session.publicId}`,
      name: 'Kiosk',
      room: roomName,
      metadata: JSON.stringify({ sessionId: id, publicId: session.publicId, languageCode: session.languageCode }),
    });
    await container.prisma.interviewSession.update({
      where: { id },
      data: { voiceTransport: 'livekit', livekitRoomName: roomName, voiceConnectedAt: new Date() },
    });
    return c.json({
      url: container.env.LIVEKIT_URL,
      roomName,
      identity: `kiosk-${session.publicId}`,
      token,
      expiresInSeconds: container.env.LIVEKIT_TOKEN_TTL_MINUTES * 60,
      agentName: container.env.VOICE_AGENT_NAME,
      languageCode: session.languageCode,
    });
  });

  kiosk.post('/kiosk/sessions/:id/consent', async (c) => {
    const { services } = ctx();
    const { id } = sessionIdSchema.parse({ id: c.req.param('id') });
    const body = await jsonBody(c, z.object({ given: z.boolean(), sessionSecret: z.string().min(8).max(128) }));
    await requireSessionSecret(id, body.sessionSecret, requireSessionSecretForFinishCheck());
    services.sessions.resetSettingsCache();
    return c.json(toClientPayload(await services.sessions.recordConsent(id, body.given)));
  });

  kiosk.post('/kiosk/sessions/:id/language', async (c) => {
    const { services } = ctx();
    const { id } = sessionIdSchema.parse({ id: c.req.param('id') });
    const body = await jsonBody(c, z.object({ languageCode: z.string().min(2).max(12), sessionSecret: z.string().min(8).max(128) }));
    await requireSessionSecret(id, body.sessionSecret, requireSessionSecretForFinishCheck());
    services.sessions.resetSettingsCache();
    return c.json(toClientPayload(await services.sessions.changeLanguage(id, body.languageCode)));
  });

  /** REST fallback for a kiosk that cannot hold the interview WebSocket open. */
  kiosk.post('/kiosk/sessions/:id/turns', async (c) => {
    const { services } = ctx();
    const { id } = sessionIdSchema.parse({ id: c.req.param('id') });
    const body = await jsonBody(c, restVoiceTurnSchema);
    await requireSessionSecret(id, body.sessionSecret, requireSessionSecretForFinishCheck());
    services.sessions.resetSettingsCache();
    await services.sessions.assertWithinTimeBudget(id);
    return c.json(
      toClientPayload(
        await services.sessions.handleVoiceTurn(id, {
          transcript: body.transcript.slice(0, 4000),
          spokenLanguage: body.spokenLanguage,
          confidence: body.confidence,
          durationMs: body.durationMs,
        }),
      ),
    );
  });

  kiosk.post('/kiosk/sessions/:id/advance', async (c) => {
    const { services } = ctx();
    const { id } = sessionIdSchema.parse({ id: c.req.param('id') });
    const body = await jsonBody(c, z.object({ sessionSecret: z.string().min(8).max(128) }));
    await requireSessionSecret(id, body.sessionSecret, requireSessionSecretForFinishCheck());
    services.sessions.resetSettingsCache();
    return c.json(toClientPayload(await services.sessions.advance(id)));
  });

  /** Idempotent: a double tap, retry or reconnect must all resolve to the same report. */
  kiosk.post('/kiosk/sessions/:id/finish', async (c) => {
    const { container, services } = ctx();
    const { id } = sessionIdSchema.parse({ id: c.req.param('id') });
    const body = await jsonBody(c, z.object({ sessionSecret: z.string().min(8).max(128) }));
    await requireSessionSecretForFinish(id, body.sessionSecret);
    services.sessions.resetSettingsCache();
    await services.sessions.finaliseSession(id);
    const settings = await container.settings.get();
    return c.json({
      completed: true,
      message: 'interview_complete',
      revealScore: settings.interview.discloseScoreToCandidate,
      resetDelaySeconds: settings.interview.kioskResetDelaySeconds,
    });
  });

  kiosk.post('/kiosk/sessions/:id/cancel', async (c) => {
    const { container } = ctx();
    const { id } = sessionIdSchema.parse({ id: c.req.param('id') });
    const body = await jsonBody(
      c,
      z.object({ reason: z.string().max(200).optional(), sessionSecret: z.string().min(8).max(128) }),
    );
    await requireSessionSecret(id, body.sessionSecret, requireSessionSecretForFinishCheck());
    const timeline = await container.prisma.interviewSession.findUnique({
      where: { id },
      select: { timeline: true },
    });
    const existing = Array.isArray(timeline?.timeline) ? (timeline!.timeline as unknown[]) : [];
    await container.prisma.interviewSession.update({
      where: { id },
      data: {
        sessionStatus: 'ABANDONED',
        sessionState: 'CANCELLED',
        isLocked: true,
        completedAt: new Date(),
        timeline: [
          ...existing.slice(-199),
          { at: new Date().toISOString(), kind: 'cancelled', detail: body.reason ?? 'Candidate stopped' },
        ] as never,
      },
    });
    return c.json({ cancelled: true });
  });

  kiosk.post('/kiosk/sessions/:id/proctoring', async (c) => {
    const { container, services } = ctx();
    const { id } = sessionIdSchema.parse({ id: c.req.param('id') });
    const body = await jsonBody(c, proctorEventReportSchema.and(z.object({ sessionSecret: z.string().min(8).max(128) })));
    await requireSessionSecret(id, body.sessionSecret, requireSessionSecretForFinishCheck());
    const session = await container.prisma.interviewSession.findUnique({
      where: { id },
      select: { job: { select: { proctoring: true } } },
    });
    if (!session) throw AppError.notFound('This session could not be found.');
    const settings = await container.settings.get();
    const jobConfig = parseJobProctoring(session.job.proctoring);
    const event = await services.proctoring.record(
      id,
      {
        type: body.type,
        confidence: body.confidence,
        ...(body.occurredAt ? { occurredAt: body.occurredAt } : {}),
        ...(body.stageKind ? { stageKind: body.stageKind } : {}),
        ...(body.description ? { description: body.description } : {}),
        ...(body.reference ? { reference: body.reference } : {}),
        ...(body.snapshotBase64 ? { snapshotBase64: body.snapshotBase64 } : {}),
      },
      {
        ...jobConfig,
        level: settings.proctoring.level === 'DISABLED' ? 'DISABLED' : jobConfig.level,
        snapshotOnEvent: settings.proctoring.snapshotOnEvent,
      },
    );
    return c.json({ accepted: event !== null, event });
  });

  /** Non-fatal client telemetry; a report must never fail an interview. */
  kiosk.post('/kiosk/report-error', async (c) => {
    const { services } = ctx();
    const body = await jsonBody(
      c,
      z.object({
        sessionId: z.string().uuid().optional(),
        publicId: z.string().max(64).optional(),
        message: z.string().max(2000),
        stack: z.string().max(4000).optional(),
      }),
    );
    const id = body.sessionId ?? (body.publicId ? undefined : undefined);
    void services;
    void id;
    if (!id) return c.json({ received: true });
    const { container } = ctx();
    const row = await container.prisma.interviewSession.findUnique({
      where: { id },
      select: { timeline: true },
    });
    const existing = Array.isArray(row?.timeline) ? (row!.timeline as unknown[]) : [];
    await container.prisma.interviewSession.update({
      where: { id },
      data: {
        timeline: [
          ...existing.slice(-199),
          { at: new Date().toISOString(), kind: 'client_error', detail: body.message.slice(0, 500) },
        ] as never,
      },
    });
    return c.json({ received: true });
  });

  /** Audio upload ticket; the ticket itself is minted but the blob goes to memory. */
  kiosk.post('/kiosk/sessions/:id/audio/ticket', async (c) => {
    const { services } = ctx();
    const { id } = sessionIdSchema.parse({ id: c.req.param('id') });
    const body = await jsonBody(c, audioUploadTicketSchema.and(z.object({ sessionSecret: z.string().min(8).max(128) })));
    await requireSessionSecret(id, body.sessionSecret, requireSessionSecretForFinishCheck());
    return c.json(
      await services.audio.createUploadTicket(id, {
        answerId: body.answerId,
        kind: body.kind,
        contentType: body.contentType,
        durationMs: body.durationMs,
      }),
    );
  });

  app.route('/', kiosk);

  return app;
}
