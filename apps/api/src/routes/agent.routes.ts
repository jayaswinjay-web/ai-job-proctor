import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { deriveKioskKey } from '../lib/crypto.js';
import { bearerToken, isTrustedAgent } from '../lib/livekit.js';
import { zodBody } from '../lib/validation.js';
import { toClientPayload } from './kiosk.routes.js';
import type { Services } from '../services/registry.js';
import type { Container } from '../container.js';

/**
 * Cloud voice-agent callback API.
 *
 * The AI agent runs in the cloud and drives the spoken conversation, but it does not own
 * the interview: questions, scoring, consent, transcripts, proctoring and reports all
 * stay in this backend. The agent calls these endpoints to read context and to submit what
 * the candidate said, and this API returns the engine's directives for the agent to speak.
 *
 * Authentication is a single shared bearer key (`AGENT_API_KEY`), compared in constant
 * time. It is deliberately closed unless the key is configured, so the surface cannot be
 * used from the public internet by default. This router is the only place the agent can
 * reach VoiceHire data, and it can reach nothing in the admin surface.
 */

interface RouteDeps {
  container: Container;
  services: Services;
}

const publicIdParamSchema = z.object({ publicId: z.string().min(1).max(64) });

export default async function agentRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { container, services } = deps;
  const env = container.env;

  // Every route below is the trusted cloud agent only.
  app.addHook('preHandler', async (req) => {
    if (!isTrustedAgent(env, bearerToken(req.headers.authorization))) {
      throw AppError.unauthenticated('Agent credentials are required.');
    }
  });

  async function sessionIdFor(publicId: string): Promise<string> {
    const session = await container.prisma.interviewSession.findUnique({
      where: { publicId },
      select: { id: true },
    });
    if (!session) throw AppError.notFound('Unknown interview session.');
    return session.id;
  }

  /**
   * Pre-interview context.
   *
   * Everything the agent needs to greet the candidate and let them choose by voice: the
   * complete job list (spec §7) and the complete language list (spec §8), plus consent
   * wording. The agent reads these out; it must not invent options.
   */
  app.get('/agent/context', async () => {
    const settings = await container.settings.get();
    const [jobs, languages] = await Promise.all([
      services.jobs.publicList(),
      container.prisma.language.findMany({
        where: { enabled: true, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    return {
      defaultLanguage: env.VOICE_DEFAULT_LANGUAGE,
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
    };
  });

  /**
   * Creates the interview session once the candidate has chosen a job and a language by
   * voice. Before this point there is no session — the conversation runs in an ephemeral
   * intake room.
   */
  app.post(
    '/agent/sessions',
    {
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      preHandler: zodBody(
        z.object({
          roomName: z.string().min(1).max(128),
          jobId: z.string().uuid(),
          languageCode: z.string().min(2).max(12),
          consentGiven: z.boolean().optional(),
        }),
      ),
    },
    async (req) => {
      const body = req.body as {
        roomName: string;
        jobId: string;
        languageCode: string;
        consentGiven?: boolean;
      };
      services.sessions.resetSettingsCache();
      const started = await services.sessions.start({
        jobId: body.jobId,
        kioskId: `voice-${body.roomName}`.slice(0, 64),
        languageCode: body.languageCode,
        ...(body.consentGiven !== undefined ? { consentGiven: body.consentGiven } : {}),
      });
      const job = await container.prisma.job.findUnique({
        where: { id: body.jobId },
        select: { title: true },
      });
      await container.prisma.interviewSession.update({
        where: { id: started.sessionId },
        data: { voiceTransport: 'livekit', livekitRoomName: body.roomName, voiceConnectedAt: new Date() },
      });
      return {
        sessionId: started.sessionId,
        publicId: started.publicId,
        // Same derived secret the kiosk would receive; the agent passes it back on writes.
        sessionSecret: deriveKioskKey(started.publicId, env.AUTH_SECRET).slice(0, 24),
        languageCode: started.languageCode,
        totalQuestions: started.totalQuestions,
        jobTitle: job?.title ?? '',
        state: started.state,
      };
    },
  );

  /** Current interview context for an established session. */
  app.get('/agent/sessions/:publicId/context', async (req) => {
    const { publicId } = publicIdParamSchema.parse(req.params);
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
    return {
      sessionId: session.id,
      publicId: session.publicId,
      state: session.sessionState,
      stage: session.stageKind,
      languageCode: session.languageCode,
      totalQuestions: session.totalQuestions,
      isLocked: session.isLocked,
      consentRecorded: session.consentRecorded,
      job: session.job,
      defaultLanguage: env.VOICE_DEFAULT_LANGUAGE,
      supportedLanguages: settings.general.supportedLanguages,
      languages: languages.map((l) => ({
        code: l.code,
        name: l.name,
        nativeName: l.nativeName,
        sttLocale: l.sttLocale,
      })),
    };
  });

  app.post(
    '/agent/sessions/:publicId/consent',
    { preHandler: zodBody(z.object({ given: z.boolean() })) },
    async (req) => {
      const { publicId } = publicIdParamSchema.parse(req.params);
      const id = await sessionIdFor(publicId);
      services.sessions.resetSettingsCache();
      return toClientPayload(await services.sessions.recordConsent(id, (req.body as { given: boolean }).given));
    },
  );

  app.post(
    '/agent/sessions/:publicId/language',
    { preHandler: zodBody(z.object({ languageCode: z.string().min(2).max(12) })) },
    async (req) => {
      const { publicId } = publicIdParamSchema.parse(req.params);
      const id = await sessionIdFor(publicId);
      services.sessions.resetSettingsCache();
      return toClientPayload(
        await services.sessions.changeLanguage(id, (req.body as { languageCode: string }).languageCode),
      );
    },
  );

  app.post(
    '/agent/sessions/:publicId/turns',
    {
      config: { rateLimit: { max: 240, timeWindow: 60_000 } },
      preHandler: zodBody(
        z.object({
          transcript: z.string().max(4000),
          spokenLanguage: z.string().max(12).nullable().optional(),
          confidence: z.number().min(0).max(1).optional(),
          durationMs: z.number().int().min(0).optional(),
        }),
      ),
    },
    async (req) => {
      const { publicId } = publicIdParamSchema.parse(req.params);
      const id = await sessionIdFor(publicId);
      const body = req.body as {
        transcript: string;
        spokenLanguage?: string | null;
        confidence?: number;
        durationMs?: number;
      };
      services.sessions.resetSettingsCache();
      await services.sessions.assertWithinTimeBudget(id);
      return toClientPayload(
        await services.sessions.handleVoiceTurn(id, {
          transcript: body.transcript.slice(0, 4000),
          spokenLanguage: body.spokenLanguage ?? null,
          confidence: body.confidence ?? 0.8,
          durationMs: body.durationMs ?? 0,
        }),
      );
    },
  );

  app.post('/agent/sessions/:publicId/advance', async (req) => {
    const { publicId } = publicIdParamSchema.parse(req.params);
    const id = await sessionIdFor(publicId);
    services.sessions.resetSettingsCache();
    return toClientPayload(await services.sessions.advance(id));
  });

  app.post('/agent/sessions/:publicId/finish', async (req) => {
    const { publicId } = publicIdParamSchema.parse(req.params);
    const id = await sessionIdFor(publicId);
    services.sessions.resetSettingsCache();
    await services.sessions.finaliseSession(id);
    const settings = await container.settings.get();
    return {
      completed: true,
      revealScore: settings.interview.discloseScoreToCandidate,
      resetDelaySeconds: settings.interview.kioskResetDelaySeconds,
    };
  });

  /**
   * Records the running cloud agent instance for this session.
   *
   * Lets the admin console correlate a live interview with the agent that is conducting it
   * (spec §26), without storing any LiveKit secret.
   */
  app.post(
    '/agent/sessions/:publicId/agent-session',
    {
      preHandler: zodBody(
        z.object({
          voiceAgentSessionId: z.string().min(1).max(128),
          roomName: z.string().min(1).max(128),
        }),
      ),
    },
    async (req) => {
      const { publicId } = publicIdParamSchema.parse(req.params);
      const body = req.body as { voiceAgentSessionId: string; roomName: string };
      const session = await container.prisma.interviewSession.update({
        where: { publicId },
        data: {
          voiceAgentSessionId: body.voiceAgentSessionId,
          livekitRoomName: body.roomName,
          voiceConnectedAt: new Date(),
        },
        select: { id: true, publicId: true },
      });
      return { recorded: true, sessionId: session.id };
    },
  );
}
