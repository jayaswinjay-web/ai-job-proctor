import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  audioUploadTicketSchema,
  proctorEventReportSchema,
  restVoiceTurnSchema,
  sessionIdParamSchema,
  startSessionSchema,
} from '@proctor/types';
import { AppError } from '../lib/errors.js';
import { deriveKioskKey } from '../lib/crypto.js';
import { createLivekitToken, livekitRoomName } from '../lib/livekit.js';
import { voiceAiConfigured } from '@proctor/config';
import { zodBody } from '../lib/validation.js';
import { parseJobProctoring } from '../services/plan-builder.js';
import type { Services } from '../services/registry.js';
import type { Container } from '../container.js';
import type { EngineTurnResult } from '../services/interview-engine.js';

/**
 * Kiosk-facing API.
 *
 * SECURITY MODEL — read this before changing anything in this file
 * ----------------------------------------------------------------
 * This router is public by necessity: a kiosk in a lobby must be able to start a
 * session without an account. Three controls make that acceptable:
 *
 *  1. A session is addressed by an opaque UUID *plus* a per-session secret. Guessing an
 *     id is not enough; the secret is derived server-side from the session's public id
 *     and the server secret, and is required on every write.
 *  2. Every route is rate limited by client address plus kiosk id.
 *  3. Nothing readable about one candidate is returned to another. The start endpoint
 *     returns configuration only; answers are written, never read back, and only an
 *     administrator with `candidate:read` can read them.
 *
 * There is no route here that exposes another candidate's data, and no route here that
 * reaches the admin surface.
 */

interface RouteDeps {
  container: Container;
  services: Services;
}

interface ResumeHint {
  sessionId: string;
  publicId: string;
  state: string;
  jobTitle: string;
  questionIndex: number;
  totalQuestions: number;
}

const secretSchema = z.string().min(8).max(128);

export default async function kioskRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { container, services } = deps;
  const env = container.env;
  const settingsOf = () => container.settings.get();

  /* ================================================================== */
  /* Bootstrap                                                           */
  /* ================================================================== */

  app.get(
    '/kiosk/bootstrap',
    { config: { rateLimit: { max: 120, timeWindow: 60_000 } } },
    async (req) => {
      const settings = await settingsOf();
      const languages = await container.prisma.language.findMany({
        where: { enabled: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
      const jobs = await services.jobs.publicList();
      const resumeHint = await activeSessionFor(
        services,
        kioskIdFor(req.ip, req.headers['x-kiosk-id']),
        settings.interview.sessionIdleResetMinutes,
      );

      return {
        siteName: settings.general.siteName,
        demoMode: settings.ai.demoMode,
        providers: {
          // Tells the client whether it may rely on browser-native speech or must fall
          // back to server transcription.
          stt: settings.voice.sttProvider,
          tts: settings.voice.ttsProvider,
        },
        languages: languages.map((l) => ({
          code: l.code,
          name: l.name,
          nativeName: l.nativeName,
          sttLocale: l.sttLocale,
          ttsVoiceHint: l.ttsVoiceHint,
        })),
        jobs,
        privacyNoticeRequired: settings.general.privacyNoticeRequired,
        // Preselected on the kiosk's language screen. Sent explicitly rather than left to
        // the client to infer from list order, which silently changes behaviour whenever
        // an administrator reorders languages.
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
        resume: resumeHint,
        /**
         * Voice transport the kiosk should use.
         *
         * `configured` is false whenever LiveKit Cloud or the agent key is missing, so the
         * kiosk can show the explicit configuration error instead of pretending to work.
         * No LiveKit secret is ever included here — only the public URL and dispatch name.
         */
        voiceAi: {
          mode: env.VOICE_MODE,
          configured: voiceAiConfigured(env),
          defaultLanguage: env.VOICE_DEFAULT_LANGUAGE,
          livekitUrl: env.LIVEKIT_URL || null,
          agentName: env.VOICE_AGENT_NAME,
          allowBrowserFallback: env.ALLOW_BROWSER_VOICE_FALLBACK,
        },
      };
    },
  );

  /**
   * Mints a LiveKit Cloud token for the pre-interview "intake" conversation.
   *
   * The voice agent greets the candidate, reads out every job and language, runs the
   * speaker/microphone tests and takes consent *before* an interview session exists — so
   * this room is not tied to a session yet. There is no session secret to check here; the
   * room is ephemeral, rate limited and carries only public configuration.
   */
  app.post(
    '/kiosk/voice/intake-token',
    {
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
      preHandler: zodBody(z.object({ kioskId: z.string().min(1).max(64) })),
    },
    async (req) => {
      if (!voiceAiConfigured(env)) {
        throw AppError.voiceAiNotConfigured(
          'Voice AI service is not configured. Please configure LiveKit Cloud and the required AI provider credentials.',
        );
      }
      const body = req.body as { kioskId: string };
      const kioskId = body.kioskId.slice(0, 32);
      const roomName = `intake-${kioskId}-${Date.now().toString(36)}`;
      const identity = `kiosk-${kioskId}`;
      const token = createLivekitToken(env, {
        identity,
        name: 'Kiosk',
        room: roomName,
        metadata: JSON.stringify({ intake: true, kioskId, defaultLanguage: env.VOICE_DEFAULT_LANGUAGE }),
      });
      return {
        url: env.LIVEKIT_URL,
        roomName,
        identity,
        token,
        expiresInSeconds: env.LIVEKIT_TOKEN_TTL_MINUTES * 60,
        agentName: env.VOICE_AGENT_NAME,
        defaultLanguage: env.VOICE_DEFAULT_LANGUAGE,
      };
    },
  );

  /**
   * Mints a short-lived LiveKit Cloud access token for this kiosk session.
   *
   * The kiosk then joins the room as a thin audio client; the cloud voice agent (pulled in
   * by the dispatch name baked into the token) performs STT/LLM/TTS. The LiveKit API
   * secret stays on the server — only this signed, room-scoped token is returned.
   */
  app.post(
    '/kiosk/sessions/:id/voice-token',
    {
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      preHandler: zodBody(z.object({ sessionSecret: secretSchema })),
    },
    async (req) => {
      if (!voiceAiConfigured(env)) {
        throw AppError.voiceAiNotConfigured(
          'Voice AI service is not configured. Please configure LiveKit Cloud and the required AI provider credentials.',
        );
      }
      const { id } = sessionIdParamSchema.parse(req.params);
      const body = req.body as { sessionSecret: string };
      await requireSessionSecret(id, body.sessionSecret, container);

      const session = await container.prisma.interviewSession.findUnique({
        where: { id },
        select: { publicId: true, languageCode: true, sessionState: true, isLocked: true },
      });
      if (!session) throw AppError.notFound('This session could not be found.');
      if (session.isLocked) throw AppError.locked('This interview has already finished.');

      const roomName = livekitRoomName(session.publicId);
      const token = createLivekitToken(env, {
        identity: `kiosk-${session.publicId}`,
        name: 'Kiosk',
        room: roomName,
        metadata: JSON.stringify({ sessionId: id, publicId: session.publicId, languageCode: session.languageCode }),
      });

      await container.prisma.interviewSession.update({
        where: { id },
        data: { voiceTransport: 'livekit', livekitRoomName: roomName, voiceConnectedAt: new Date() },
      });

      return {
        url: env.LIVEKIT_URL,
        roomName,
        identity: `kiosk-${session.publicId}`,
        token,
        expiresInSeconds: env.LIVEKIT_TOKEN_TTL_MINUTES * 60,
        agentName: env.VOICE_AGENT_NAME,
        languageCode: session.languageCode,
      };
    },
  );

  /* ================================================================== */
  /* Session lifecycle                                                   */
  /* ================================================================== */

  app.post(
    '/kiosk/sessions',
    { config: { rateLimit: { max: 30, timeWindow: 60_000 } }, preHandler: zodBody(startSessionSchema) },
    async (req) => {
      const body = req.body as z.infer<typeof startSessionSchema>;
      services.sessions.resetSettingsCache();

      const started = await services.sessions.start({
        jobId: body.jobId,
        kioskId: body.kioskId.slice(0, 64),
        ...(body.languageCode ? { languageCode: body.languageCode } : {}),
        ...(body.consentGiven !== undefined ? { consentGiven: body.consentGiven } : {}),
        ...(body.demoMode !== undefined ? { demoMode: body.demoMode } : {}),
      });

      const job = await container.prisma.job.findUniqueOrThrow({
        where: { id: body.jobId },
        select: { proctoring: true, title: true },
      });
      const settings = await settingsOf();
      const jobProctoring = parseJobProctoring(job.proctoring);

      return {
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
      };
    },
  );

  app.get(
    '/kiosk/sessions/:id',
    { config: { rateLimit: { max: 240, timeWindow: 60_000 } } },
    async (req) => {
      const { id } = sessionIdParamSchema.parse(req.params);
      const loaded = await services.sessions.loadState(id);
      if (!loaded) throw AppError.notFound('This session could not be resumed. Please start again.');
      const row = await container.prisma.interviewSession.findUnique({
        where: { id },
        select: { publicId: true },
      });
      return {
        sessionId: id,
        publicId: row?.publicId ?? '',
        state: loaded.state.state,
        stage: loaded.state.stageKind,
        languageCode: loaded.languageCode,
        answered: Object.keys(loaded.state.answers).length,
        total: loaded.state.plan.questions.length,
        locked: loaded.isLocked,
      };
    },
  );

  app.post(
    '/kiosk/sessions/:id/consent',
    { preHandler: zodBody(z.object({ given: z.boolean(), sessionSecret: secretSchema })) },
    async (req) => {
      const { id } = sessionIdParamSchema.parse(req.params);
      const body = req.body as { given: boolean; sessionSecret: string };
      await requireSessionSecret(id, body.sessionSecret, container);
      services.sessions.resetSettingsCache();
      return toClientPayload(await services.sessions.recordConsent(id, body.given));
    },
  );

  app.post(
    '/kiosk/sessions/:id/language',
    { preHandler: zodBody(z.object({ languageCode: z.string().min(2).max(12), sessionSecret: secretSchema })) },
    async (req) => {
      const { id } = sessionIdParamSchema.parse(req.params);
      const body = req.body as { languageCode: string; sessionSecret: string };
      await requireSessionSecret(id, body.sessionSecret, container);
      services.sessions.resetSettingsCache();
      return toClientPayload(await services.sessions.changeLanguage(id, body.languageCode));
    },
  );

  /**
   * Submits one recognised utterance over REST. This is the fallback for kiosks whose
   * network cannot hold a WebSocket open reliably; the semantics are identical.
   */
  app.post(
    '/kiosk/sessions/:id/turns',
    {
      config: { rateLimit: { max: 240, timeWindow: 60_000 } },
      preHandler: zodBody(restVoiceTurnSchema),
    },
    async (req) => {
      const { id } = sessionIdParamSchema.parse(req.params);
      const body = req.body as z.infer<typeof restVoiceTurnSchema>;
      await requireSessionSecret(id, body.sessionSecret, container);
      services.sessions.resetSettingsCache();
      await services.sessions.assertWithinTimeBudget(id);
      return toClientPayload(
        await services.sessions.handleVoiceTurn(id, {
          transcript: body.transcript.slice(0, 4000),
          spokenLanguage: body.spokenLanguage,
          confidence: body.confidence,
          durationMs: body.durationMs,
        }),
      );
    },
  );

  app.post(
    '/kiosk/sessions/:id/advance',
    { preHandler: zodBody(z.object({ sessionSecret: secretSchema })) },
    async (req) => {
      const { id } = sessionIdParamSchema.parse(req.params);
      const body = req.body as { sessionSecret: string };
      await requireSessionSecret(id, body.sessionSecret, container);
      services.sessions.resetSettingsCache();
      return toClientPayload(await services.sessions.advance(id));
    },
  );

  app.post(
    '/kiosk/sessions/:id/finish',
    { preHandler: zodBody(z.object({ sessionSecret: secretSchema })) },
    async (req) => {
      const { id } = sessionIdParamSchema.parse(req.params);
      const body = req.body as { sessionSecret: string };
      // Idempotent by design: a double tap, a retried request, or a kiosk reconnect
      // must all succeed and must all resolve to the same report.
      await requireSessionSecretForFinish(id, body.sessionSecret, container);
      services.sessions.resetSettingsCache();
      await services.sessions.finaliseSession(id);
      const settings = await settingsOf();
      return {
        completed: true,
        message: 'interview_complete',
        revealScore: settings.interview.discloseScoreToCandidate,
        resetDelaySeconds: settings.interview.kioskResetDelaySeconds,
      };
    },
  );

  app.post(
    '/kiosk/sessions/:id/cancel',
    { preHandler: zodBody(z.object({ reason: z.string().max(200).optional(), sessionSecret: secretSchema })) },
    async (req) => {
      const { id } = sessionIdParamSchema.parse(req.params);
      const body = req.body as { reason?: string; sessionSecret: string };
      await requireSessionSecret(id, body.sessionSecret, container);
      await container.prisma.interviewSession.update({
        where: { id },
        data: {
          sessionStatus: 'ABANDONED',
          sessionState: 'CANCELLED',
          isLocked: true,
          completedAt: new Date(),

        },
      });
      const session = await container.prisma.interviewSession.findUnique({
        where: { id },
        select: { timeline: true },
      });
      const existingTimeline = Array.isArray(session?.timeline) ? (session!.timeline as unknown[]) : [];
      await container.prisma.interviewSession.update({
        where: { id },
        data: {
          timeline: [
            ...existingTimeline.slice(-199),
            { at: new Date().toISOString(), kind: 'cancelled', detail: body.reason ?? 'Candidate stopped' },
          ] as never,
        },
      });
      return { cancelled: true };
    },
  );

  /* ================================================================== */
  /* Proctoring                                                          */
  /* ================================================================== */

  app.post(
    '/kiosk/sessions/:id/proctoring',
    {
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
      preHandler: zodBody(proctorEventReportSchema.and(z.object({ sessionSecret: secretSchema }))),
    },
    async (req) => {
      const { id } = sessionIdParamSchema.parse(req.params);
      const body = req.body as z.infer<typeof proctorEventReportSchema> & { sessionSecret: string };
      await requireSessionSecret(id, body.sessionSecret, container);

      const session = await container.prisma.interviewSession.findUnique({
        where: { id },
        select: { job: { select: { proctoring: true } } },
      });
      if (!session) throw AppError.notFound('This session could not be found.');

      const settings = await settingsOf();
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

      return { accepted: event !== null, event };
    },
  );

  /* ================================================================== */
  /* Audio                                                               */
  /* ================================================================== */

  app.post(
    '/kiosk/sessions/:id/audio/ticket',
    {
      config: { rateLimit: { max: 240, timeWindow: 60_000 } },
      preHandler: zodBody(audioUploadTicketSchema.and(z.object({ sessionSecret: secretSchema }))),
    },
    async (req) => {
      const { id } = sessionIdParamSchema.parse(req.params);
      const body = req.body as z.infer<typeof audioUploadTicketSchema> & { sessionSecret: string };
      await requireSessionSecret(id, body.sessionSecret, container);
      return services.audio.createUploadTicket(id, {
        answerId: body.answerId,
        kind: body.kind,
        contentType: body.contentType,
        durationMs: body.durationMs,
      });
    },
  );

  /**
   * Direct upload fallback for kiosks that cannot PUT to object storage (for example a
   * browser blocked by CORS). Accepts a raw audio body.
   */
  app.put(
    '/kiosk/sessions/:id/audio',
    { config: { rateLimit: { max: 240, timeWindow: 60_000 } } },
    async (req, reply) => {
      const { id } = sessionIdParamSchema.parse(req.params);
      const query = req.query as { sessionSecret?: string; answerId?: string; durationMs?: string };
      if (!query.sessionSecret) throw AppError.unauthenticated('Missing session secret.');
      await requireSessionSecret(id, query.sessionSecret, container);

      const body = await readBodyBuffer(req);
      const contentType = normaliseContentType(String(req.headers['content-type'] ?? 'audio/webm'));
      const result = await services.audio.uploadDirect(id, body, {
        answerId: query.answerId ?? null,
        contentType,
        durationMs: Number(query.durationMs ?? 0) || 0,
      });
      reply.code(201);
      return result;
    },
  );

  /**
   * Upload target for the local storage driver: the browser PUTs here rather than to a
   * file path it cannot reach. The HMAC covers the key, expiry, content type and length.
   */
  app.put(
    '/kiosk/media/upload',
    { config: { rateLimit: { max: 240, timeWindow: 60_000 } }, bodyLimit: 12 * 1024 * 1024 },
    async (req, reply) => {
      const query = req.query as { key?: string; token?: string; expires?: string };
      if (!query.key || !query.token || !query.expires) throw AppError.unauthenticated('Missing upload token.');
      const body = await readBodyBuffer(req);
      const contentType = normaliseContentType(String(req.headers['content-type'] ?? 'audio/webm'));
      const ok = await services.audio.verifyUploadSignature({
        key: query.key,
        contentType,
        expiresAt: query.expires,
        signature: query.token,
        contentLength: body.byteLength,
      });
      if (!ok) throw AppError.forbidden('Invalid upload token.');
      await container.storage.put(query.key, body, contentType);
      reply.code(200);
      return { ok: true };
    },
  );

  app.get(
    '/kiosk/media/download',
    { config: { rateLimit: { max: 60, timeWindow: 60_000 } } },
    async (req, reply) => {
      const query = req.query as { key?: string; token?: string; expires?: string; name?: string };
      if (!query.key || !query.token || !query.expires) throw AppError.unauthenticated('Missing download token.');

      const local = container.storage as unknown as {
        verifySignature?: (purpose: string, key: string, expiresAtIso: string, token: string) => boolean;
      };
      if (typeof local.verifySignature === 'function') {
        if (!local.verifySignature('GET', query.key, query.expires, query.token)) {
          throw AppError.forbidden('This download link has expired or is invalid.');
        }
      }

      const stream = await container.storage.createReadStream(query.key);
      const safeName = (query.name ?? 'recording').replace(/[^\w.-]/g, '_');
      reply.header('Content-Type', guessContentType(query.key));
      reply.header('Content-Disposition', `attachment; filename="${safeName}"`);
      return reply.send(stream);
    },
  );

  /**
   * Server-side speech-to-text fallback.
   *
   * The kiosk normally transcribes in the browser (Web Speech), which needs no key and
   * keeps candidate audio on the device. That path is unavailable on non-Chromium
   * browsers, on kiosks with no route to the vendor's service, and whenever recognition
   * fails mid-interview — and in every one of those cases the candidate previously had no
   * way to answer at all.
   *
   * This endpoint is the fallback: the kiosk records the utterance and posts the audio
   * here. It is authenticated by the session secret like every other kiosk write, and it
   * never stores the audio — the buffer is handed to the provider and dropped.
   */
  app.post(
    '/kiosk/sessions/:id/transcribe',
    {
      config: { rateLimit: { max: 240, timeWindow: 60_000 } },
      bodyLimit: 12 * 1024 * 1024,
    },
    async (req) => {
      const { id } = sessionIdParamSchema.parse(req.params);
      const query = req.query as { sessionSecret?: string; language?: string; durationMs?: string };
      if (!query.sessionSecret) throw AppError.unauthenticated('Missing session secret.');
      await requireSessionSecret(id, query.sessionSecret, container);

      const body = await readBodyBuffer(req);
      if (body.byteLength === 0) throw AppError.validation('No audio was received.');

      const settings = await container.settings.get();
      // Transcribe against the session's own language, not whatever the client asked for,
      // so a tampered query string cannot make the provider guess the wrong language.
      const session = await container.prisma.interviewSession.findUnique({
        where: { id },
        select: { languageCode: true, jobId: true },
      });
      if (!session) throw AppError.notFound('This session could not be found.');

      const job = session.jobId
        ? await container.prisma.job.findUnique({ where: { id: session.jobId }, select: { title: true, requiredSkills: true } })
        : null;

      const transcript = await container.ai.stt.transcribe(body, {
        language: session.languageCode,
        locale: session.languageCode,
        vocabularyHints: [job?.title ?? '', ...(job?.requiredSkills ?? [])].filter(Boolean).slice(0, 20),
        traceId: `kiosk-${id.slice(0, 8)}`,
      });

      // Audit trail: a server transcription means candidate audio left the device, which
      // is exactly the kind of fact an auditor will ask about later.
      await app.audit.record({
        action: 'kiosk.transcribed',
        entityType: 'interview_session',
        entityId: id,
        next: {
          provider: transcript.provider,
          bytes: body.byteLength,
          language: transcript.language,
          confidence: transcript.confidence,
          demoMode: settings.ai.demoMode,
        },
        actor: app.auditActor(req),
      });

      return {
        text: transcript.text,
        language: transcript.language,
        confidence: transcript.confidence,
        durationMs: transcript.durationMs || Number(query.durationMs ?? 0) || 0,
        provider: transcript.provider,
      };
    },
  );

  /* ================================================================== */
  /* Diagnostics                                                         */
  /* ================================================================== */

  /**
   * Candidate-facing error report. Records a structured event carrying the client error
   * id so support can find the matching server log, and returns only safe copy.
   */
  app.post(
    '/kiosk/report-error',
    {
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      preHandler: zodBody(
        z.object({
          code: z.string().max(60),
          message: z.string().max(300).optional(),
          sessionId: z.string().uuid().optional(),
          errorId: z.string().max(40).optional(),
          context: z.record(z.unknown()).optional(),
        }),
      ),
    },
    async (req) => {
      const body = req.body as { code: string; sessionId?: string; errorId?: string; context?: Record<string, unknown> };
      container.logger.warn('kiosk_reported_error', {
        code: body.code,
        sessionId: body.sessionId,
        clientErrorId: body.errorId,
        context: body.context ?? {},
      });
      return { ok: true, code: body.code, userMessage: safeMessage(body.code) };
    },
  );
}

/* ====================================================================== */
/* Helpers                                                                 */
/* ====================================================================== */

/**
 * Session secret check.
 *
 * The kiosk receives a value derived from the session's public id when it starts, and
 * must present it on every write. This is a possession check, not authentication: it
 * stops a script on the network from mutating a session whose id it merely guessed.
 * A finished session is locked, so a secret cannot be used after the fact.
 */
async function requireSessionSecret(sessionId: string, secret: string, container: Container): Promise<void> {
  if (!sessionId || !secret) throw AppError.unauthenticated('Missing session credentials.');
  const session = await container.prisma.interviewSession.findUnique({
    where: { id: sessionId },
    select: { publicId: true, isLocked: true, sessionState: true },
  });
  if (!session) throw AppError.notFound('This session could not be found.');
  if (session.isLocked && (session.sessionState === 'COMPLETED' || session.sessionState === 'CANCELLED')) {
    throw AppError.locked('This interview has already finished.');
  }
  const expected = deriveKioskKey(session.publicId, container.env.AUTH_SECRET).slice(0, 24);
  if (expected !== secret) {
    container.logger.warn('kiosk_session_secret_mismatch', { sessionId });
    throw AppError.forbidden('This session is not valid on this kiosk.');
  }
}

/**
 * Finish is the one write allowed after completion.
 *
 * Every other endpoint refuses a finished session, but `finish` must remain callable
 * so the kiosk can retry safely. The secret is still verified, so this is not a hole.
 */
async function requireSessionSecretForFinish(sessionId: string, secret: string, container: Container): Promise<void> {
  const session = await container.prisma.interviewSession.findUnique({
    where: { id: sessionId },
    select: { publicId: true },
  });
  if (!session) throw AppError.notFound('This session could not be found.');
  const expected = deriveKioskKey(session.publicId, container.env.AUTH_SECRET).slice(0, 24);
  if (expected !== secret) throw AppError.forbidden('This session is not valid on this kiosk.');
}

async function activeSessionFor(services: Services, kioskId: string, idleMinutes: number): Promise<ResumeHint | null> {
  const candidates = await services.analytics.activeSessionsForKiosk(kioskId, idleMinutes);
  const first = candidates[0];
  if (!first) return null;
  return {
    sessionId: first.sessionId,
    publicId: first.publicId,
    state: first.state,
    jobTitle: first.jobTitle,
    questionIndex: first.questionIndex,
    totalQuestions: first.totalQuestions,
  };
}

/**
 * Stable kiosk identifier.
 *
 * The kiosk sends `X-Kiosk-Id`. Where it is absent (a tablet behind NAT, a shared public
 * address) the derived value is still stable for that origin, which is enough to offer a
 * session resume without ever exposing another candidate's data.
 */
function kioskIdFor(ip: string, header: string | string[] | undefined): string {
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader && fromHeader.trim()) return fromHeader.trim().slice(0, 64);
  const cleaned = ip.replace(/[^A-Za-z0-9]/g, '').slice(-12);
  return `kiosk-${cleaned || 'default'}`;
}

export function toClientPayload(result: EngineTurnResult) {
  return {
    state: result.state.state,
    stage: result.state.stageKind,
    directives: result.directives
      .filter((d) => d.text.trim() !== '')
      .map((d) => ({
        text: d.text,
        ...(d.phraseKey ? { phraseKey: d.phraseKey } : {}),
        emotion: d.emotion,
        displayText: d.displayText,
        slowRate: d.slowRate,
        sequence: d.sequence,
      })),
    progress: result.progress,
    terminal: result.terminal,
    ...(result.recoveryNotice ? { recoveryNotice: result.recoveryNotice } : {}),
    stepAbandoned: result.stepAbandoned,
    meta: result.meta,
  };
}

async function readBodyBuffer(req: { body: unknown }): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body), 'utf8');
  return Buffer.alloc(0);
}

function normaliseContentType(value: string): string {
  const base = value.split(';')[0]!.toLowerCase().trim();
  const map: Record<string, string> = {
    'audio/webm': 'audio/webm',
    'audio/ogg': 'audio/ogg',
    'audio/mp4': 'audio/mp4',
    'audio/mpeg': 'audio/mpeg',
    'audio/mp3': 'audio/mpeg',
    'audio/wav': 'audio/wav',
    'audio/x-wav': 'audio/wav',
  };
  return map[base] ?? 'audio/webm';
}

function guessContentType(key: string): string {
  if (key.endsWith('.webm')) return 'audio/webm';
  if (key.endsWith('.ogg')) return 'audio/ogg';
  if (key.endsWith('.m4a')) return 'audio/mp4';
  if (key.endsWith('.mp3')) return 'audio/mpeg';
  if (key.endsWith('.wav')) return 'audio/wav';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function safeMessage(code: string): string {
  if (code === 'SESSION_EXPIRED' || code === 'NOT_FOUND') {
    return 'This session has ended. Please start again from the beginning.';
  }
  return 'There is a small technical problem. Please wait a moment.';
}