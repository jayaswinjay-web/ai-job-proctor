import { reviewQuestionContent, suggestQuestions, type LlmProvider, type QuestionSuggestion } from '@proctor/ai';
import { upsertQuestionSchema, type QuestionDto, type QuestionVersionDto, type UpsertQuestionInput } from '@proctor/types';
import type { Logger, PrismaClient } from '@proctor/database';
import { AppError } from '../lib/errors.js';
import { AuditService, type AuditActor } from '../lib/audit.js';
import type { SystemSettings } from '@proctor/types';

/**
 * Question authoring and lifecycle.
 *
 * Two invariants are enforced here and nowhere else, so no code path can bypass them:
 *
 *  1. Content policy — every question, follow-up and scoring criterion is screened for
 *     protected characteristics and for embedded instructions before it can be saved.
 *     A question that fails cannot be activated.
 *  2. Immutability of history — editing a question that has already been asked bumps
 *     `version` and writes a snapshot of the previous content. Interviews keep
 *     pointing at the version they were actually conducted with.
 */
export interface QuestionServiceDeps {
  prisma: PrismaClient;
  logger: Logger;
  audit: AuditService;
  llm: LlmProvider;
  /** Read live so an administrator's settings change takes effect without a restart. */
  settings: () => Promise<SystemSettings>;
}

export interface ValidationResult {
  status: 'VALID' | 'INVALID' | 'NEEDS_TRANSLATION';
  issues: string[];
}

export class QuestionService {
  constructor(private readonly deps: QuestionServiceDeps) {}

  async list(input: {
    jobId?: string;
    stageId?: string;
    isActive?: boolean;
    search?: string;
    category?: string;
    source?: 'ADMIN' | 'AI_SUGGESTED';
    page?: number;
    pageSize?: number;
  }): Promise<{ items: QuestionDto[]; total: number }> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, input.pageSize ?? 50));

    const where = {
      deletedAt: null,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.stageId ? { stageId: input.stageId } : {}),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.source ? { source: input.source } : {}),
      ...(input.category ? { categoryName: input.category } : {}),
      ...(input.search
        ? { text: { contains: input.search, mode: 'insensitive' as const } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.deps.prisma.question.findMany({
        where,
        include: {
          translations: { include: { language: true } },
          scoringCriteria: { orderBy: { sortOrder: 'asc' } },
          followUpRules: { orderBy: { sortOrder: 'asc' } },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.deps.prisma.question.count({ where }),
    ]);

    return { items: rows.map((row) => toDto(row)), total };
  }

  async get(id: string): Promise<QuestionDto> {
    const row = await this.deps.prisma.question.findFirst({
      where: { id, deletedAt: null },
      include: {
        translations: { include: { language: true } },
        scoringCriteria: { orderBy: { sortOrder: 'asc' } },
        followUpRules: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!row) throw AppError.notFound('That question could not be found.');
    return toDto(row);
  }

  async versions(questionId: string): Promise<QuestionVersionDto[]> {
    const rows = await this.deps.prisma.questionVersion.findMany({
      where: { questionId },
      orderBy: { version: 'desc' },
    });
    return rows.map((row) => ({
      version: row.version,
      snapshot: row.snapshot as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
      createdBy: null,
      changeNote: row.changeNote,
    }));
  }

  async create(input: unknown, actor: AuditActor): Promise<QuestionDto> {
    const parsed = upsertQuestionSchema.safeParse(input);
    if (!parsed.success) {
      throw AppError.validation('The question could not be saved. Check the highlighted fields.', parsed.error.flatten());
    }
    const data = parsed.data;
    const validation = await this.validate(data, actor.id);

    if (validation.status === 'INVALID') {
      throw AppError.discriminatory(
        `This question cannot be published. ${validation.issues.join(' ')}`,
        validation.issues,
      );
    }

    const created = await this.deps.prisma.question.create({
      data: {
        jobId: data.jobId,
        stageId: data.stageId,
        categoryName: data.category,
        difficulty: data.difficulty,
        baseLanguage: data.baseLanguage,
        text: data.text,
        speakText: data.speakText ?? null,
        expectedAnswerGuidance: data.expectedAnswerGuidance,
        evaluationInstructions: data.evaluationInstructions,
        keywords: data.keywords,
        skillTags: data.skillTags,
        weight: data.weight,
        scoreMax: data.scoreMax,
        scoreMin: data.scoreMin,
        isRequired: data.isRequired,
        isKnockout: data.isKnockout,
        knockoutMessage: data.knockoutMessage ?? null,
        maxRetries: data.maxRetries,
        timeLimitSeconds: data.timeLimitSeconds,
        sortOrder: data.sortOrder,
        source: data.source,
        // A missing translation is a warning, not a block: the plan builder falls back
        // to the base-language wording, so the question still runs. Deactivating here
        // would silently remove questions from every interview for a multilingual job.
        isActive: data.isActive,
        validationStatus: validation.status,
        validationIssues: validation.issues,
        version: 1,
        approvedAt: validation.status === 'VALID' && data.source === 'ADMIN' ? new Date() : null,
        approvedById: validation.status === 'VALID' && data.source === 'ADMIN' ? (actor.id ?? null) : null,
        createdById: actor.id ?? null,
        translations: {
          create: await this.translationRows(data.translations),
        },
        scoringCriteria: {
          create: data.scoringCriteria.map((c, index) => ({
            label: c.label,
            description: c.description,
            points: c.points,
            keywords: c.keywords,
            isKnockout: c.isKnockout,
            knockoutMessage: c.knockoutMessage ?? null,
            sortOrder: c.sortOrder ?? index,
          })),
        },
        followUpRules: {
          create: data.followUpRules.map((r, index) => ({
            questionText: r.question,
            trigger: r.trigger,
            maxUses: r.maxUses,
            weight: r.weight,
            sortOrder: r.sortOrder ?? index,
          })),
        },
      },
    });

    // Snapshot v1 so a completed interview can always be reconstructed.
    await this.deps.prisma.questionVersion.create({
      data: {
        questionId: created.id,
        version: 1,
        snapshot: { text: data.text, scoringCriteria: data.scoringCriteria, weight: data.weight, scoreMax: data.scoreMax, capturedAt: new Date().toISOString() } as never,
        changeNote: 'Initial version',
        createdById: actor.id ?? null,
      },
    });

    await this.deps.audit.record({
      action: 'question.created',
      entityType: 'question',
      entityId: created.id,
      next: { jobId: data.jobId, category: data.category, source: data.source, validation: validation.status },
      actor,
    });
    this.deps.logger.info('question_created', {
      questionId: created.id,
      jobId: data.jobId,
      validation: validation.status,
      actor: actor.id,
    });
    return this.get(created.id);
  }

  async update(id: string, input: unknown, actor: AuditActor): Promise<QuestionDto> {
    const existing = await this.deps.prisma.question.findFirst({
      where: { id, deletedAt: null },
      include: { translations: true, scoringCriteria: true, followUpRules: true },
    });
    if (!existing) throw AppError.notFound('That question could not be found.');

    const patch = (input ?? {}) as Partial<UpsertQuestionInput>;
    const merged: UpsertQuestionInput = {
      jobId: patch.jobId !== undefined ? patch.jobId : existing.jobId,
      stageId: patch.stageId !== undefined ? patch.stageId : existing.stageId,
      category: patch.category ?? existing.categoryName,
      difficulty: patch.difficulty ?? existing.difficulty,
      baseLanguage: patch.baseLanguage ?? existing.baseLanguage,
      text: patch.text ?? existing.text,
      speakText: patch.speakText !== undefined ? patch.speakText : existing.speakText ?? undefined,
      expectedAnswerGuidance: patch.expectedAnswerGuidance ?? existing.expectedAnswerGuidance,
      evaluationInstructions: patch.evaluationInstructions ?? existing.evaluationInstructions,
      keywords: patch.keywords ?? existing.keywords,
      skillTags: (patch.skillTags ?? existing.skillTags) as UpsertQuestionInput['skillTags'],
      weight: patch.weight ?? existing.weight,
      scoreMax: patch.scoreMax ?? existing.scoreMax,
      scoreMin: patch.scoreMin ?? existing.scoreMin,
      isRequired: patch.isRequired ?? existing.isRequired,
      isKnockout: patch.isKnockout ?? existing.isKnockout,
      knockoutMessage: patch.knockoutMessage !== undefined ? patch.knockoutMessage : existing.knockoutMessage ?? undefined,
      maxRetries: patch.maxRetries ?? existing.maxRetries,
      timeLimitSeconds: patch.timeLimitSeconds !== undefined ? patch.timeLimitSeconds : existing.timeLimitSeconds,
      sortOrder: patch.sortOrder ?? existing.sortOrder,
      source: patch.source ?? existing.source,
      isActive: patch.isActive ?? existing.isActive,
      scoringCriteria:
        patch.scoringCriteria ??
        existing.scoringCriteria.map((c) => ({
          label: c.label,
          description: c.description,
          points: c.points,
          keywords: c.keywords,
          isKnockout: c.isKnockout,
          knockoutMessage: c.knockoutMessage ?? undefined,
          sortOrder: c.sortOrder ?? 0,
        })),
      followUpRules:
        patch.followUpRules ??
        existing.followUpRules.map((r) => ({
          question: r.questionText,
          trigger: r.trigger,
          maxUses: r.maxUses,
          weight: r.weight,
          sortOrder: r.sortOrder ?? 0,
        })),
      translations: patch.translations ?? [],
    };

    const parsed = upsertQuestionSchema.safeParse(merged);
    if (!parsed.success) throw AppError.validation('The question could not be saved.', parsed.error.flatten());
    const data = parsed.data;
    const validation = await this.validate(data, actor.id);
    if (validation.status === 'INVALID') {
      throw AppError.discriminatory(`This question cannot be published. ${validation.issues.join(' ')}`, validation.issues);
    }

    // Content-changing edits create a new version. Pure metadata edits do not.
    const contentChanged =
      data.text !== existing.text ||
      data.scoreMax !== existing.scoreMax ||
      data.weight !== existing.weight ||
      data.isKnockout !== existing.isKnockout;
    const nextVersion = contentChanged ? existing.version + 1 : existing.version;

    // A content edit produces two version rows: the content being superseded (kept so
    // an interview conducted against it can still be reconstructed) and the new content
    // (so a later edit has a baseline). Both are upserts, because a question that has
    // already been asked may already be pinned by an interview.
    if (contentChanged) {
      await this.deps.prisma.questionVersion.upsert({
        where: { questionId_version: { questionId: id, version: existing.version } },
        update: {},
        create: {
          questionId: id,
          version: existing.version,
          snapshot: {
            text: existing.text,
            expectedAnswerGuidance: existing.expectedAnswerGuidance,
            scoringCriteria: existing.scoringCriteria.map((c) => ({ label: c.label, points: c.points, keywords: c.keywords })),
            weight: existing.weight,
            scoreMax: existing.scoreMax,
            isKnockout: existing.isKnockout,
            capturedAt: new Date().toISOString(),
          } as never,
          changeNote: `Superseded by version ${nextVersion}`,
        },
      });
      await this.deps.prisma.questionVersion.upsert({
        where: { questionId_version: { questionId: id, version: nextVersion } },
        update: {},
        create: {
          questionId: id,
          version: nextVersion,
          snapshot: {
            text: data.text,
            expectedAnswerGuidance: data.expectedAnswerGuidance,
            scoringCriteria: data.scoringCriteria.map((c) => ({ label: c.label, points: c.points, keywords: c.keywords })),
            weight: data.weight,
            scoreMax: data.scoreMax,
            isKnockout: data.isKnockout,
            capturedAt: new Date().toISOString(),
          } as never,
          changeNote: `Replaces version ${existing.version}`,
        },
      });
    }

    await this.deps.prisma.$transaction(async (tx) => {
      await tx.question.update({
        where: { id },
        data: {
          jobId: data.jobId,
          stageId: data.stageId,
          categoryName: data.category,
          difficulty: data.difficulty,
          baseLanguage: data.baseLanguage,
          text: data.text,
          speakText: data.speakText ?? null,
          expectedAnswerGuidance: data.expectedAnswerGuidance,
          evaluationInstructions: data.evaluationInstructions,
          keywords: data.keywords,
          skillTags: data.skillTags,
          weight: data.weight,
          scoreMax: data.scoreMax,
          scoreMin: data.scoreMin,
          isRequired: data.isRequired,
          isKnockout: data.isKnockout,
          knockoutMessage: data.knockoutMessage ?? null,
          maxRetries: data.maxRetries,
          timeLimitSeconds: data.timeLimitSeconds,
          sortOrder: data.sortOrder,
          source: data.source,
          // A missing translation is a warning, not a block: the plan builder falls back
        // to the base-language wording, so the question still runs. Deactivating here
        // would silently remove questions from every interview for a multilingual job.
        isActive: data.isActive,
          validationStatus: validation.status,
          validationIssues: validation.issues,
          version: nextVersion,
          ...(validation.status === 'VALID' ? { approvedAt: new Date(), approvedById: actor.id ?? null } : {}),
        },
      });

      if (patch.translations && patch.translations.length > 0) {
        await tx.questionTranslation.deleteMany({ where: { questionId: id } });
        const rows = await this.translationRows(patch.translations);
        await tx.questionTranslation.createMany({
          data: rows.map((row) => ({ ...row, questionId: id })),
        });
      }

      if (patch.scoringCriteria) {
        await tx.scoringCriterion.deleteMany({ where: { questionId: id } });
        if (patch.scoringCriteria.length > 0) {
          await tx.scoringCriterion.createMany({
            data: patch.scoringCriteria.map((c, index) => ({
              questionId: id,
              label: c.label,
              description: c.description,
              points: c.points,
              keywords: c.keywords,
              isKnockout: c.isKnockout,
              knockoutMessage: c.knockoutMessage ?? null,
              sortOrder: c.sortOrder ?? index,
            })),
          });
        }
      }

      if (patch.followUpRules) {
        await tx.followUpRule.deleteMany({ where: { questionId: id } });
        if (patch.followUpRules.length > 0) {
          await tx.followUpRule.createMany({
            data: patch.followUpRules.map((r, index) => ({
              questionId: id,
              questionText: r.question,
              trigger: r.trigger,
              maxUses: r.maxUses,
              weight: r.weight,
              sortOrder: r.sortOrder ?? index,
            })),
          });
        }
      }
    });

    const diff = AuditService.diff(existing as unknown as Record<string, unknown>, {
      text: data.text,
      weight: data.weight,
      scoreMax: data.scoreMax,
      isActive: data.isActive,
      isKnockout: data.isKnockout,
      difficulty: data.difficulty,
      category: data.category,
    });
    await this.deps.audit.record({
      action: contentChanged ? 'question.updated' : 'question.updated',
      entityType: 'question',
      entityId: id,
      next: { ...diff, version: nextVersion, validation: validation.status },
      actor,
    });
    this.deps.logger.info('question_updated', { questionId: id, version: nextVersion, contentChanged, actor: actor.id });
    return this.get(id);
  }

  /** Publishes a question that was previously held for review or translation. */
  async publish(id: string, actor: AuditActor): Promise<QuestionDto> {
    const question = await this.deps.prisma.question.findFirst({ where: { id, deletedAt: null } });
    if (!question) throw AppError.notFound('That question could not be found.');

    const validation = await this.validate(
      {
        text: question.text,
        expectedAnswerGuidance: question.expectedAnswerGuidance,
        evaluationInstructions: question.evaluationInstructions,
        scoringCriteria: [],
        translations: [],
        followUpRules: [],
        baseLanguage: question.baseLanguage,
        scoreMax: question.scoreMax,
        scoreMin: question.scoreMin,
        weight: question.weight,
        timeLimitSeconds: question.timeLimitSeconds,
        isKnockout: question.isKnockout,
        jobId: question.jobId,
      },
      actor.id,
    );
    if (validation.status === 'INVALID') {
      throw AppError.discriminatory(`This question cannot be published. ${validation.issues.join(' ')}`, validation.issues);
    }
    const updated = await this.deps.prisma.question.update({
      where: { id },
      data: {
        isActive: true,
        approvedAt: new Date(),
        approvedById: actor.id ?? null,
        validationStatus: validation.status,
        validationIssues: validation.issues,
      },
    });
    await this.deps.audit.record({ action: 'question.published', entityType: 'question', entityId: id, actor });
    this.deps.logger.info('question_published', { questionId: id, actor: actor.id });
    void updated;
    return this.get(id);
  }

  async unpublish(id: string, actor: AuditActor): Promise<QuestionDto> {
    await this.deps.prisma.question.update({ where: { id }, data: { isActive: false } });
    await this.deps.audit.record({ action: 'question.unpublished', entityType: 'question', entityId: id, actor });
    return this.get(id);
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    const answers = await this.deps.prisma.candidateAnswer.count({ where: { questionId: id } });
    if (answers > 0) {
      // Never destroy the audit trail; deactivate instead.
      await this.deps.prisma.question.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
    } else {
      await this.deps.prisma.question.update({ where: { id }, data: { deletedAt: new Date() } });
    }
    await this.deps.audit.record({
      action: 'question.deleted',
      entityType: 'question',
      entityId: id,
      next: { softDeleted: true, hadAnswers: answers > 0 },
      actor,
    });
    this.deps.logger.info('question_deleted', { questionId: id, hadAnswers: answers > 0, actor: actor.id });
  }

  /**
   * Generates draft questions for a job.
   *
   * Output is returned for review only. Nothing is written to the database, so an AI
   * suggestion can never become an active question without an administrator approving it.
   */
  async generate(input: {
    jobId: string;
    count: number;
    language: string;
    categories: string[];
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  }, actor: AuditActor): Promise<QuestionSuggestion[]> {
    const job = await this.deps.prisma.job.findFirst({
      where: { id: input.jobId, deletedAt: null },
      include: { questions: { select: { text: true } } },
    });
    if (!job) throw AppError.notFound('That job could not be found.');

    const settings = await this.deps.settings();
    const others = settings.general.supportedLanguages.filter((l) => l !== input.language);
    const suggestions = await suggestQuestions(
      {
        jobTitle: job.title,
        jobDescription: job.description,
        jobLocation: job.location,
        requiredSkills: job.requiredSkills,
        eligibilityCriteria: job.eligibilityCriteria,
        minExperienceYears: job.minExperienceYears,
        count: Math.min(20, Math.max(1, input.count)),
        languageCode: input.language,
        categories: input.categories,
        difficulty: input.difficulty,
        otherLanguages: others.slice(0, 2),
      },
      this.deps.llm,
    );

    // Never suggest something that duplicates an existing question.
    const existing = job.questions.map((q) => q.text.toLowerCase().replace(/[^\p{L}\s]/gu, '').trim());
    const deduped = suggestions.filter((s) => {
      const normalised = s.text.toLowerCase().replace(/[^\p{L}\s]/gu, '').trim();
      return normalised.length > 0 && !existing.includes(normalised);
    });

    await this.deps.audit.record({
      action: 'question.import_validated',
      entityType: 'job',
      entityId: job.id,
      next: { action: 'ai_suggestion', requested: input.count, returned: deduped.length, blocked: suggestions.length - deduped.length },
      actor,
    });

    this.deps.logger.info('questions_suggested', {
      jobId: job.id,
      requested: input.count,
      returned: deduped.length,
      unsafe: suggestions.filter((s) => !s.safe).length,
      actor: actor.id,
    });
    return deduped;
  }

  /* ------------------------------------------------------------------ */
  /* Validation                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Validates a question before it can be saved or published.
   *
   * Order matters and is deliberate: hard failures are decided FIRST, so a question that
   * references a protected characteristic is rejected outright even if it is also
   * missing translations. A content-policy failure must never be downgraded to "hold for
   * translation" — that would let a discriminatory question sit in an editor waiting for
   * a reviewer who may never open it.
   */
  private async validate(
    data: Pick<
      UpsertQuestionInput,
      | 'text'
      | 'expectedAnswerGuidance'
      | 'evaluationInstructions'
      | 'scoringCriteria'
      | 'translations'
      | 'scoreMax'
      | 'scoreMin'
      | 'weight'
      | 'timeLimitSeconds'
      | 'isKnockout'
      | 'jobId'
      | 'followUpRules'
      | 'baseLanguage'
    >,
    _actorId?: string | null,
    existing?: { jobId: string | null; translations?: Array<{ language: { code: string } }> } | null,
  ): Promise<ValidationResult> {
    const hardIssues: string[] = [];
    const softIssues: string[] = [];

    /* ---- structural validity --------------------------------------- */
    if (!data.text.trim()) hardIssues.push('Question text is empty.');
    if (data.text.length > 1000) hardIssues.push('Question text is too long to be spoken comfortably.');
    if (data.scoreMax <= 0) hardIssues.push('Maximum score must be greater than zero for a scored question.');
    if (data.scoreMin > data.scoreMax) hardIssues.push('Minimum score cannot exceed the maximum score.');
    if (data.weight < 0) hardIssues.push('Weight cannot be negative.');
    if (data.timeLimitSeconds !== null && data.timeLimitSeconds !== undefined) {
      if (data.timeLimitSeconds < 15) hardIssues.push('Time limit must be at least 15 seconds.');
      if (data.timeLimitSeconds > 1800) hardIssues.push('Time limit must be at most 30 minutes.');
    }
    if (data.isKnockout && data.scoreMax > 0 && !(data.scoringCriteria ?? []).length) {
      hardIssues.push('A knockout question must define at least one scoring criterion so the decision is explainable.');
    }

    /* ---- content policy (fairness) ---------------------------------- */
    // Runs on the whole authored content, including the rubric and any follow-ups.
    const review = reviewQuestionContent({
      text: data.text,
      expectedAnswerGuidance: data.expectedAnswerGuidance ?? '',
      evaluationInstructions: data.evaluationInstructions ?? '',
      scoringCriteriaLabels: (data.scoringCriteria ?? []).map((c) => `${c.label} ${c.description}`),
    });
    hardIssues.push(...review.issues);

    for (const followUp of (data.followUpRules ?? [])) {
      const followUpReview = reviewQuestionContent({
        text: followUp.question,
        expectedAnswerGuidance: '',
        evaluationInstructions: '',
        scoringCriteriaLabels: [],
      });
      hardIssues.push(...followUpReview.issues.map((i) => `Follow-up: ${i}`));
    }

    /* ---- scorability ------------------------------------------------ */
    for (const criterion of data.scoringCriteria ?? []) {
      if (!criterion.keywords || criterion.keywords.length === 0) {
        softIssues.push(
          `Scoring criterion "${criterion.label}" has no keywords, so it cannot be scored deterministically. ` +
            'Add keywords so the answer can be matched, or expect manual review.',
        );
      }
    }

    // Hard failures win outright.
    if (hardIssues.length > 0) return { status: 'INVALID', issues: hardIssues };

    /* ---- translation coverage (only once the content is safe) ------- */
    const jobId = data.jobId ?? existing?.jobId ?? null;
    if (jobId) {
      const links = await this.deps.prisma.jobPreferredLanguage.findMany({
        where: { jobId },
        include: { language: true },
      });
      const required = links.map((l) => l.language.code).filter(Boolean);
      const provided = new Set((data.translations ?? []).map((t) => t.languageCode));
      // The base language is the question's own text, so it never needs a translation row.
      const base = data.baseLanguage ?? 'en';
      const missing = required.filter((code) => code !== base && !provided.has(code));
      if (missing.length > 0) {
        softIssues.push(`Add translations for: ${missing.join(', ')}.`);
      }
    }

    if (softIssues.length > 0) return { status: 'NEEDS_TRANSLATION', issues: softIssues };
    return { status: 'VALID', issues: [] };
  }
  private async translationRows(
    translations: UpsertQuestionInput['translations'],
  ): Promise<Array<{ languageId: string; text: string; speakText: string | null }>> {
    const unique = new Map<string, { languageCode: string; text: string; speakText?: string }>();
    for (const t of translations) unique.set(t.languageCode, t);
    const languages = await this.deps.prisma.language.findMany({
      where: { code: { in: [...unique.keys()] }, deletedAt: null },
    });
    const byCode = new Map(languages.map((l) => [l.code, l.id]));
    const rows: Array<{ languageId: string; text: string; speakText: string | null }> = [];
    for (const [code, value] of unique) {
      const languageId = byCode.get(code);
      if (!languageId) {
        this.deps.logger.warn('question_translation_language_missing', { languageCode: code });
        continue;
      }
      rows.push({ languageId, text: value.text, speakText: value.speakText ?? null });
    }
    return rows;
  }

}

type QuestionRow = Awaited<ReturnType<PrismaClient['question']['findFirst']>> & {
  translations?: Array<{ id: string; language: { code: string }; text: string; speakText: string | null }>;
  scoringCriteria?: Array<{ id: string; label: string; description: string; points: number; keywords: string[]; isKnockout: boolean; knockoutMessage: string | null; sortOrder: number }>;
  followUpRules?: Array<{ id: string; questionText: string; trigger: 'ALWAYS' | 'IF_POSITIVE' | 'IF_NEGATIVE' | 'IF_SHORT' | 'MANUAL'; maxUses: number; weight: number }>;
};

function toDto(row: QuestionRow): QuestionDto {
  return {
    id: row.id,
    jobId: row.jobId,
    stageId: row.stageId,
    category: row.categoryName,
    difficulty: row.difficulty,
    baseLanguage: row.baseLanguage,
    text: row.text,
    speakText: row.speakText,
    expectedAnswerGuidance: row.expectedAnswerGuidance,
    keywords: row.keywords,
    skillTags: row.skillTags as never,
    weight: row.weight,
    scoreMax: row.scoreMax,
    scoreMin: row.scoreMin,
    isRequired: row.isRequired,
    isKnockout: row.isKnockout,
    knockoutMessage: row.knockoutMessage,
    maxRetries: row.maxRetries,
    timeLimitSeconds: row.timeLimitSeconds,
    evaluationInstructions: row.evaluationInstructions,
    scoringCriteria: (row.scoringCriteria ?? []).map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description,
      points: c.points,
      keywords: c.keywords,
      isKnockout: c.isKnockout,
      sortOrder: c.sortOrder,
      ...(c.knockoutMessage ? { knockoutMessage: c.knockoutMessage } : {}),
    })),
    followUpRules: (row.followUpRules ?? []).map((r) => ({
      id: r.id,
      question: r.questionText,
      trigger: r.trigger,
      maxUses: r.maxUses,
      weight: r.weight,
      sortOrder: 0,
    })),
    translations: (row.translations ?? []).map((t) => ({
      id: t.id,
      languageCode: t.language.code,
      text: t.text,
      speakText: t.speakText,
    })),
    sortOrder: row.sortOrder,
    source: row.source,
    isActive: row.isActive,
    version: row.version,
    validationStatus: row.validationStatus,
    validationIssues: row.validationIssues,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}