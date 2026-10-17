import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  candidateListQuerySchema,
  reviewSubmissionSchema,
  settingsPatchSchema,
  suggestQuestionsSchema,
  upsertLanguageSchema,
  upsertJobSchema,
  upsertQuestionSchema,
  type SystemSettings,
} from '@proctor/types';
import { AppError } from '../lib/errors.js';
import { zodBody, zodQuery } from '../lib/validation.js';
import { evaluateFollowUp } from '@proctor/ai';
import type { Services } from '../services/registry.js';
import type { Container } from '../container.js';

interface RouteDeps {
  container: Container;
  services: Services;
}

export default async function adminRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { container, services } = deps;
  const base = container.env.API_BASE_PATH;

  /* ================================================================== */
  /* Settings & languages                                               */
  /* ================================================================== */

  app.get('/admin/settings', { preHandler: app.requirePermission('settings:read') }, async (req) => {
    const settings = await container.settings.get();
    void req;
    return { settings, envDefaults: container.settings.envDefaults() };
  });

  app.patch(
    '/admin/settings',
    { preHandler: [app.requirePermission('settings:write'), zodBody(settingsPatchSchema)] },
    async (req) => {
      const patch = req.body as Partial<SystemSettings>;
      const previous = await container.settings.get();
      const updated = await container.settings.update(patch as Record<string, unknown>, req.user?.id ?? null);
      await app.audit.record({
        action: 'settings.changed',
        entityType: 'system_setting',
        entityId: 'global',
        previous,
        next: patch,
        actor: app.auditActor(req),
      });
      container.logger.info('settings_updated', { userId: req.user?.id, sections: Object.keys(patch) });
      return { settings: updated };
    },
  );

  app.post(
    '/admin/settings/reset',
    { preHandler: app.requirePermission('settings:write') },
    async (req) => {
      const previous = await container.settings.get();
      const settings = await container.settings.reset(req.user?.id ?? null);
      await app.audit.record({
        action: 'settings.changed',
        entityType: 'system_setting',
        entityId: 'global',
        previous,
        next: { reset: true },
        actor: app.auditActor(req),
      });
      return { settings };
    },
  );

  app.post(
    '/admin/settings/retention/run',
    { preHandler: app.requirePermission('settings:write') },
    async (req) => {
      const body = (req.body ?? {}) as { dryRun?: boolean; hardDelete?: boolean };
      const settings = await container.settings.get();
      const result = await services.retention.run({
        settings,
        dryRun: body.dryRun !== false,
        enableHardDelete: body.hardDelete === true,
      });
      await app.audit.record({
        action: 'settings.changed',
        entityType: 'retention_run',
        entityId: null,
        next: { ...result, hardDelete: body.hardDelete === true },
        actor: app.auditActor(req),
      });
      return result;
    },
  );

  app.get('/admin/languages', { preHandler: app.requirePermission('settings:read') }, async () => {
    const languages = await container.prisma.language.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { questionTranslations: true } } },
    });
    return {
      items: languages.map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        nativeName: l.nativeName,
        enabled: l.enabled,
        ttsVoiceHint: l.ttsVoiceHint,
        sttLocale: l.sttLocale,
        sortOrder: l.sortOrder,
        translationCount: l._count.questionTranslations,
      })),
    };
  });

  app.post(
    '/admin/languages',
    { preHandler: [app.requirePermission('settings:write'), zodBody(upsertLanguageSchema)] },
    async (req) => {
      const body = req.body as z.infer<typeof upsertLanguageSchema>;
      const language = await container.prisma.language.upsert({
        where: { code: body.code },
        create: {
          code: body.code,
          name: body.name,
          nativeName: body.nativeName,
          enabled: body.enabled,
          ttsVoiceHint: body.ttsVoiceHint ?? null,
          sttLocale: body.sttLocale ?? null,
          sortOrder: body.sortOrder,
        },
        update: {
          name: body.name,
          nativeName: body.nativeName,
          enabled: body.enabled,
          ttsVoiceHint: body.ttsVoiceHint ?? null,
          sttLocale: body.sttLocale ?? null,
          sortOrder: body.sortOrder,
        },
      });
      await app.audit.record({
        action: 'language.created',
        entityType: 'language',
        entityId: language.id,
        next: { code: language.code, enabled: language.enabled },
        actor: app.auditActor(req),
      });
      return language;
    },
  );

  app.patch(
    '/admin/languages/:id',
    { preHandler: [app.requirePermission('settings:write'), zodBody(upsertLanguageSchema.omit({ code: true }))] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof upsertLanguageSchema>;
      const language = await container.prisma.language.update({
        where: { id },
        data: {
          name: body.name,
          nativeName: body.nativeName,
          enabled: body.enabled,
          ttsVoiceHint: body.ttsVoiceHint ?? null,
          sttLocale: body.sttLocale ?? null,
          sortOrder: body.sortOrder,
        },
      });
      await app.audit.record({
        action: 'language.updated',
        entityType: 'language',
        entityId: id,
        next: body,
        actor: app.auditActor(req),
      });
      container.settings.invalidate();
      return language;
    },
  );

  app.delete(
    '/admin/languages/:id',
    { preHandler: app.requirePermission('settings:write') },
    async (req) => {
      const { id } = req.params as { id: string };
      await container.prisma.language.update({ where: { id }, data: { enabled: false, deletedAt: new Date() } });
      await app.audit.record({ action: 'language.deleted', entityType: 'language', entityId: id, actor: app.auditActor(req) });
      container.settings.invalidate();
      return { ok: true };
    },
  );

  /* ================================================================== */
  /* Jobs                                                               */
  /* ================================================================== */

  app.get(
    '/admin/jobs',
    { preHandler: app.requirePermission('job:read'), preValidation: zodQuery(z.object({
      status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
      search: z.string().max(120).optional(),
      includeArchived: z.coerce.boolean().optional(),
    })) },
    async (req) => {
      const query = req.query as { status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'; search?: string; includeArchived?: boolean };
      return { items: await services.jobs.list(query) };
    },
  );

  app.get('/admin/jobs/:id', { preHandler: app.requirePermission('job:read') }, async (req) => {
    const { id } = req.params as { id: string };
    return services.jobs.get(id);
  });

  app.post(
    '/admin/jobs',
    { preHandler: [app.requirePermission('job:write'), zodBody(upsertJobSchema)] },
    async (req) => services.jobs.create(req.body, app.auditActor(req)),
  );

  app.patch(
    '/admin/jobs/:id',
    { preHandler: [app.requirePermission('job:write'), zodBody(upsertJobSchema)] },
    async (req) => {
      const { id } = req.params as { id: string };
      return services.jobs.update(id, req.body, app.auditActor(req));
    },
  );

  app.post('/admin/jobs/:id/activate', { preHandler: app.requirePermission('job:write') }, async (req) => {
    const { id } = req.params as { id: string };
    return services.jobs.setStatus(id, 'ACTIVE', app.auditActor(req));
  });

  app.post('/admin/jobs/:id/deactivate', { preHandler: app.requirePermission('job:write') }, async (req) => {
    const { id } = req.params as { id: string };
    return services.jobs.setStatus(id, 'DRAFT', app.auditActor(req));
  });

  app.post('/admin/jobs/:id/duplicate', { preHandler: app.requirePermission('job:write') }, async (req) => {
    const { id } = req.params as { id: string };
    return services.jobs.duplicate(id, app.auditActor(req));
  });

  app.delete('/admin/jobs/:id', { preHandler: app.requirePermission('job:archive') }, async (req) => {
    const { id } = req.params as { id: string };
    await services.jobs.archive(id, app.auditActor(req));
    return { ok: true };
  });

  /* ================================================================== */
  /* Questions                                                          */
  /* ================================================================== */

  app.get(
    '/admin/questions',
    { preHandler: app.requirePermission('question:read'), preValidation: zodQuery(z.object({
      jobId: z.string().uuid().optional(),
      stageId: z.string().uuid().optional(),
      isActive: z.coerce.boolean().optional(),
      search: z.string().max(120).optional(),
      category: z.string().max(80).optional(),
      source: z.enum(['ADMIN', 'AI_SUGGESTED']).optional(),
      page: z.coerce.number().int().min(1).max(10000).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
    })) },
    async (req) => services.questions.list(req.query as never),
  );

  app.get('/admin/questions/:id', { preHandler: app.requirePermission('question:read') }, async (req) => {
    const { id } = req.params as { id: string };
    return services.questions.get(id);
  });

  app.get('/admin/questions/:id/versions', { preHandler: app.requirePermission('question:read') }, async (req) => {
    const { id } = req.params as { id: string };
    return { items: await services.questions.versions(id) };
  });

  app.post(
    '/admin/questions',
    { preHandler: [app.requirePermission('question:write'), zodBody(upsertQuestionSchema)] },
    async (req) => services.questions.create(req.body, app.auditActor(req)),
  );

  app.patch(
    '/admin/questions/:id',
    { preHandler: [app.requirePermission('question:write'), zodBody(upsertQuestionSchema.partial())] },
    async (req) => {
      const { id } = req.params as { id: string };
      return services.questions.update(id, req.body, app.auditActor(req));
    },
  );

  app.post('/admin/questions/:id/publish', { preHandler: app.requirePermission('question:publish') }, async (req) => {
    const { id } = req.params as { id: string };
    return services.questions.publish(id, app.auditActor(req));
  });

  app.post('/admin/questions/:id/unpublish', { preHandler: app.requirePermission('question:write') }, async (req) => {
    const { id } = req.params as { id: string };
    return services.questions.unpublish(id, app.auditActor(req));
  });

  app.delete('/admin/questions/:id', { preHandler: app.requirePermission('question:write') }, async (req) => {
    const { id } = req.params as { id: string };
    await services.questions.remove(id, app.auditActor(req));
    return { ok: true };
  });

  app.post(
    '/admin/questions/suggest',
    { preHandler: [app.requirePermission('question:write'), zodBody(suggestQuestionsSchema)] },
    async (req) => {
      const body = req.body as z.infer<typeof suggestQuestionsSchema>;
      const suggestions = await services.questions.generate(body, app.auditActor(req));
      return { suggestions };
    },
  );

  /**
   * Dry-run check on follow-up wording so an administrator sees the policy verdict
   * before saving, using the identical gate the engine applies at runtime.
   */
  app.post(
    '/admin/questions/validate-followup',
    { preHandler: [app.requirePermission('question:read'), zodBody(z.object({
      question: z.string().max(400),
      jobTitle: z.string().max(120).default(''),
      category: z.string().max(80).default(''),
      keywords: z.array(z.string().max(60)).max(30).default([]),
      skillTags: z.array(z.string().max(60)).max(20).default([]),
    }))] },
    async (req) => {
      const body = req.body as { question: string; jobTitle: string; category: string; keywords: string[]; skillTags: string[] };
      const verdict = evaluateFollowUp(body.question, {
        mode: 'ALLOWED',
        maxFollowUpsPerQuestion: 1,
        followUpsAlreadyAsked: 0,
        questionText: '',
        questionCategory: body.category,
        questionKeywords: body.keywords,
        jobTitle: body.jobTitle,
        allowedTopics: [...body.skillTags, body.category],
        answerKind: 'ANSWER',
        answerText: '',
        languageCode: 'en',
      });
      return verdict;
    },
  );

  /* ================================================================== */
  /* Import / export                                                    */
  /* ================================================================== */

  app.post(
    '/admin/questions/import',
    { preHandler: app.requirePermission('question:write') },
    async (req) => {
      const body = req.body as { jobId: string; format: 'CSV' | 'XLSX' | 'JSON'; payload: string; dryRun?: boolean };
      const format = body.format;
      if (!['CSV', 'XLSX', 'JSON'].includes(format)) {
        throw AppError.validation('Supported formats are CSV, XLSX and JSON.');
      }
      return services.imports.importQuestions(
        {
          jobId: body.jobId,
          format,
          payload: format === 'JSON' ? body.payload : format === 'XLSX' ? Buffer.from(body.payload, 'base64') : body.payload,
          dryRun: body.dryRun !== false,
        },
        app.auditActor(req),
      );
    },
  );

  app.get('/admin/questions/import/template.csv', { preHandler: app.requirePermission('question:read') }, async (req, reply) => {
    void req;
    const csv = await services.imports.templateCsv();
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="question-template.csv"');
    return `\uFEFF${csv}`;
  });

  app.get('/admin/jobs/:id/questions.csv', { preHandler: app.requirePermission('question:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const csv = await services.imports.exportCsv(id);
    await app.audit.record({ action: 'report.exported', entityType: 'job', entityId: id, next: { format: 'CSV', kind: 'questions' }, actor: app.auditActor(req) });
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="questions-${id.slice(0, 8)}.csv"`);
    return `\uFEFF${csv}`;
  });

  app.get('/admin/jobs/:id/translations.csv', { preHandler: app.requirePermission('question:read') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = req.query as { languages?: string };
    const languages = (query.languages ?? '').split(',').map((l) => l.trim()).filter(Boolean);
    if (languages.length === 0) throw AppError.validation('Specify at least one language code.');
    const csv = await services.imports.exportTranslationsCsv(id, languages);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="translations-${id.slice(0, 8)}.csv"`);
    return `\uFEFF${csv}`;
  });

  /* ================================================================== */
  /* Candidates, sessions and review                                     */
  /* ================================================================== */

  app.get(
    '/admin/candidates',
    { preHandler: app.requirePermission('candidate:read'), preValidation: zodQuery(candidateListQuerySchema) },
    async (req) => services.analytics.candidates(req.query as never),
  );

  app.get('/admin/candidates/:id', { preHandler: app.requirePermission('candidate:read') }, async (req) => {
    const { id } = req.params as { id: string };
    const detail = await services.analytics.sessionDetail(id);
    await app.audit.record({
      action: 'candidate.viewed',
      entityType: 'interview_session',
      entityId: id,
      next: { publicId: detail.session.publicId },
      actor: app.auditActor(req),
    });
    return detail;
  });

  app.get('/admin/candidates/:id/history', { preHandler: app.requirePermission('candidate:read') }, async (req) => {
    const { id } = req.params as { id: string };
    return { items: await services.reviews.reviewHistory(id) };
  });

  app.post(
    '/admin/candidates/:id/review',
    { preHandler: [app.requirePermission('review:write'), zodBody(reviewSubmissionSchema)] },
    async (req) => {
      const { id } = req.params as { id: string };
      return services.reviews.submit(id, req.body as never, app.auditActor(req));
    },
  );

  app.post(
    '/admin/candidates/:id/notes',
    { preHandler: [app.requirePermission('review:write'), zodBody(z.object({ note: z.string().min(1).max(4000), decision: z.string().max(120).nullable().default(null) }))] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as { note: string; decision: string | null };
      await services.reviews.addNote(id, body.note, body.decision, app.auditActor(req));
      return { ok: true };
    },
  );

  app.delete(
    '/admin/candidates/:id',
    { preHandler: app.requirePermission('candidate:delete') },
    async (req) => {
      const { id } = req.params as { id: string };
      const session = await container.prisma.interviewSession.findUnique({
        where: { id },
        include: { recordings: true, transcripts: true },
      });
      if (!session) throw AppError.notFound('That interview could not be found.');
      // Erasure is deliberately reversible in the database and irreversible in storage:
      // objects go first, then identifiers are anonymised.
      for (const recording of session.recordings) {
        await services.audio.deleteRecording(recording.id, app.auditActor(req));
      }
      await container.prisma.$transaction([
        container.prisma.transcript.updateMany({ where: { sessionId: id }, data: { content: '[Removed]', isRedacted: true, redactedAt: new Date() } }),
        container.prisma.candidate.update({ where: { id: session.candidateId }, data: { name: null, age: null, village: null, previousWork: null, phone: null, deletedAt: new Date() } }),
        container.prisma.candidateAnswer.updateMany({ where: { sessionId: id }, data: { transcript: '', interpretation: '', normalizedText: '' } }),
        container.prisma.evaluationReport.deleteMany({ where: { sessionId: id } }),
      ]);
      await app.audit.record({
        action: 'candidate.deleted',
        entityType: 'interview_session',
        entityId: id,
        next: { erased: true, recordings: session.recordings.length, transcripts: session.transcripts.length },
        actor: app.auditActor(req),
      });
      return { ok: true };
    },
  );

  /* ================================================================== */
  /* Recordings & proctoring                                             */
  /* ================================================================== */

  app.get('/admin/sessions/:id/recordings', { preHandler: app.requirePermission('recording:read') }, async (req) => {
    const { id } = req.params as { id: string };
    return { items: await services.audio.listForSession(id) };
  });

  app.get(
    '/admin/recordings/:id/url',
    { preHandler: app.requirePermission('recording:read'), config: { rateLimit: { max: 60, timeWindow: 60_000 } } },
    async (req) => {
      const { id } = req.params as { id: string };
      const settings = await container.settings.get();
      return services.audio.signedUrl(id, app.auditActor(req), settings);
    },
  );

  app.delete('/admin/recordings/:id', { preHandler: app.requirePermission('candidate:delete') }, async (req) => {
    const { id } = req.params as { id: string };
    await services.audio.deleteRecording(id, app.auditActor(req));
    return { ok: true };
  });

  app.get('/admin/sessions/:id/proctoring', { preHandler: app.requirePermission('candidate:read') }, async (req) => {
    const { id } = req.params as { id: string };
    return { items: await services.proctoring.listForSession(id) };
  });

  app.post(
    '/admin/proctoring/:id/acknowledge',
    { preHandler: [app.requirePermission('review:write'), zodBody(z.object({ note: z.string().max(1000).optional() }))] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { note?: string };
      await services.proctoring.acknowledge(id, req.user!.id, body.note);
      await app.audit.record({ action: 'proctor.reviewed', entityType: 'proctoring_event', entityId: id, next: { note: body.note ?? null }, actor: app.auditActor(req) });
      return { ok: true };
    },
  );

  app.get('/admin/proctoring/events/:id/snapshot', { preHandler: app.requirePermission('recording:read') }, async (req) => {
    const { id } = req.params as { id: string };
    const settings = await container.settings.get();
    const signed = await services.proctoring.snapshotUrl(id, settings.recording.signedUrlTtlSeconds);
    await app.audit.record({ action: 'recording.accessed', entityType: 'proctoring_event', entityId: id, next: { snapshot: true }, actor: app.auditActor(req) });
    return signed;
  });

  /* ================================================================== */
  /* Analytics & exports                                                 */
  /* ================================================================== */

  app.get(
    '/admin/analytics/dashboard',
    { preHandler: app.requirePermission('report:read'), preValidation: zodQuery(z.object({
      jobId: z.string().uuid().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    })) },
    async (req) => {
      const query = req.query as { jobId?: string; dateFrom?: string; dateTo?: string };
      return services.analytics.dashboard({
        ...(query.jobId ? { jobId: query.jobId } : {}),
        ...(query.dateFrom ? { dateFrom: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { dateTo: new Date(query.dateTo) } : {}),
      });
    },
  );

  app.get(
    '/admin/exports/candidates',
    { preHandler: [app.requirePermission('report:export'), zodQuery(candidateListQuerySchema.extend({ format: z.enum(['CSV', 'XLSX', 'PDF']) }))] },
    async (req, reply) => {
      const query = req.query as z.infer<typeof candidateListQuerySchema> & { format: 'CSV' | 'XLSX' | 'PDF' };
      const page = await services.analytics.candidates({ ...query, pageSize: 1000 });
      const file = await services.exports.candidates(page.items, query.format, app.auditActor(req), {
        filters: { jobId: query.jobId, status: query.status, recommendation: query.recommendation },
      });
      reply.header('Content-Type', file.contentType);
      reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
      return reply.send(file.body);
    },
  );

  app.get(
    '/admin/exports/interview/:id',
    { preHandler: [app.requirePermission('report:export'), zodQuery(z.object({ format: z.enum(['CSV', 'XLSX', 'PDF']).default('PDF') }))] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const query = req.query as { format: 'CSV' | 'XLSX' | 'PDF' };
      const file = await services.exports.interviewReport(id, query.format, app.auditActor(req));
      reply.header('Content-Type', file.contentType);
      reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
      return reply.send(file.body);
    },
  );

  /* ================================================================== */
  /* Audit log                                                           */
  /* ================================================================== */

  app.get(
    '/admin/audit-logs',
    {
      preHandler: app.requirePermission('audit:read'),
      preValidation: zodQuery(z.object({
        actorId: z.string().uuid().optional(),
        action: z.string().max(60).optional(),
        entityType: z.string().max(60).optional(),
        entityId: z.string().max(64).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      })),
    },
    async (req) => {
      const query = req.query as {
        actorId?: string;
        action?: string;
        entityType?: string;
        entityId?: string;
        from?: string;
        to?: string;
        page: number;
        pageSize: number;
      };
      const where = {
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.from || query.to
          ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
          : {}),
      };
      const [items, total] = await Promise.all([
        container.prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        container.prisma.auditLog.count({ where }),
      ]);
      return {
        items: items.map((i) => ({
          id: i.id,
          actor: i.actorEmail ?? i.actorId ?? 'system',
          action: i.action,
          entityType: i.entityType,
          entityId: i.entityId,
          previous: i.previous,
          next: i.next,
          ipHash: i.ipHash,
          createdAt: i.createdAt.toISOString(),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  );

  /* ================================================================== */
  /* Health detail                                                      */
  /* ================================================================== */

  app.get('/admin/system/health', { preHandler: app.requirePermission('settings:read') }, async () => {
    const settings = await container.settings.get();
    const [llm, stt, tts, database] = await Promise.all([
      container.ai.llm.health(),
      container.ai.stt.health(),
      container.ai.tts.health(),
      container.prisma
        .$queryRaw`SELECT 1 as ok`
        .then(() => ({ ok: true }))
        .catch(() => ({ ok: false, detail: 'database unreachable' })),
    ]);
    return {
      version: container.version,
      demoMode: settings.ai.demoMode,
      storageDriver: container.storage.driver,
      providers: { llm, stt, tts },
      database,
      retention: settings.recording,
      privacyNoticeRequired: settings.general.privacyNoticeRequired,
      jurisdictionNote: settings.general.jurisdictionNote,
      supportedLanguages: settings.general.supportedLanguages,
      uptimeSeconds: Math.round((Date.now() - container.startedAt.getTime()) / 1000),
    };
  });

  void base;
}