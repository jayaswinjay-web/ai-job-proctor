import type { Logger, PrismaClient } from '@proctor/database';
import { upsertJobSchema, type JobDetailDto, type JobSummaryDto } from '@proctor/types';
import { AppError } from '../lib/errors.js';
import { AuditService, type AuditActor } from '../lib/audit.js';
import { parseJobWeights, normaliseWeights } from './scoring.js';
import { asRecord, asString } from '../lib/merge.js';

/**
 * Job management.
 *
 * Job configuration is the employer's contract with the AI: the question pool, the
 * weights, the eligibility rules, the proctoring level and the languages are all
 * read from here at interview time. Nothing is hard-coded, so onboarding a new role
 * is purely a data task.
 */
export class JobService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
    private readonly audit: AuditService,
  ) {}

  async list(input: {
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    search?: string;
    includeArchived?: boolean;
  }): Promise<JobSummaryDto[]> {
    const jobs = await this.prisma.job.findMany({
      where: {
        deletedAt: null,
        ...(input.status ? { status: input.status } : {}),
        ...(input.includeArchived ? {} : { status: { not: 'ARCHIVED' } }),
        ...(input.search
          ? {
              OR: [
                { title: { contains: input.search, mode: 'insensitive' } },
                { department: { contains: input.search, mode: 'insensitive' } },
                { location: { contains: input.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { _count: { select: { questions: true, sessions: true } } },
      orderBy: [{ status: 'asc' }, { title: 'asc' }],
    });

    return jobs.map((job) => ({
      id: job.id,
      title: job.title,
      location: job.location,
      department: job.department,
      status: job.status,
      preferredLanguages: [],
      questionCount: job._count.questions,
      interviewDurationMinutes: job.interviewDurationMinutes,
      passingScore: job.passingScore,
      candidateCount: job._count.sessions,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    }));
  }

  async get(id: string): Promise<JobDetailDto> {
    const job = await this.prisma.job.findFirst({
      where: { id, deletedAt: null },
      include: {
        stages: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        requirements: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        languages: { include: { language: true } },
        _count: { select: { questions: true, sessions: true } },
      },
    });
    if (!job) throw AppError.notFound('That job could not be found.');

    return {
      id: job.id,
      title: job.title,
      description: job.description,
      location: job.location,
      department: job.department,
      status: job.status,
      preferredLanguages: job.languages.map((l) => l.language.code),
      questionCount: job._count.questions,
      candidateCount: job._count.sessions,
      interviewDurationMinutes: job.interviewDurationMinutes,
      passingScore: job.passingScore,
      minExperienceYears: job.minExperienceYears,
      requiredSkills: job.requiredSkills,
      eligibilityCriteria: job.eligibilityCriteria,
      weights: parseJobWeights(job.weights) as unknown as Record<string, number>,
      proctoring: asRecord(job.proctoring),
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      stages: job.stages.map((s) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        instructions: s.instructions,
        maxQuestions: s.maxQuestions,
        weight: s.weight,
        sortOrder: s.sortOrder,
      })),
      requirements: job.requirements.map((r) => ({
        id: r.id,
        skillTag: r.skillTag as never,
        description: r.description,
        minimumLevel: r.minimumLevel,
        isKnockout: r.isKnockout,
        ...(r.knockoutMessage ? { knockoutMessage: r.knockoutMessage } : {}),
      })),
    };
  }

  async create(input: unknown, actor: AuditActor): Promise<JobDetailDto> {
    const parsed = upsertJobSchema.safeParse(input);
    if (!parsed.success) throw AppError.validation('The job could not be saved. Check the highlighted fields.', parsed.error.flatten());
    const data = parsed.data;

    const job = await this.prisma.job.create({
      data: {
        title: data.title,
        description: data.description,
        location: data.location,
        department: data.department,
        minExperienceYears: data.minExperienceYears,
        requiredSkills: data.requiredSkills,
        eligibilityCriteria: data.eligibilityCriteria,
        interviewDurationMinutes: data.interviewDurationMinutes,
        passingScore: data.passingScore,
        weights: normaliseWeights(data.weights) as unknown as never,
        proctoring: data.proctoring as never,
        status: data.status,
        createdById: actor.id ?? null,
        stages: {
          create: data.stages.map((s, index) => ({
            kind: s.kind,
            title: s.title,
            instructions: s.instructions,
            maxQuestions: s.maxQuestions,
            weight: s.weight,
            sortOrder: s.sortOrder || index,
          })),
        },
        requirements: {
          create: data.requirements.map((r, index) => ({
            skillTag: r.skillTag,
            description: r.description,
            minimumLevel: r.minimumLevel,
            isKnockout: r.isKnockout,
            knockoutMessage: r.knockoutMessage ?? null,
            sortOrder: index,
          })),
        },
      },
    });

    await this.linkLanguages(job.id, data.preferredLanguages);

    await this.audit.record({
      action: 'job.created',
      entityType: 'job',
      entityId: job.id,
      next: { title: job.title, status: job.status, stages: data.stages.length, requirements: data.requirements.length },
      actor,
    });

    this.logger.info('job_created', { jobId: job.id, title: job.title, status: job.status, actor: actor.id });
    return this.get(job.id);
  }

  async update(id: string, input: unknown, actor: AuditActor): Promise<JobDetailDto> {
    const existing = await this.prisma.job.findFirst({
      where: { id, deletedAt: null },
      include: { stages: true, requirements: true, languages: { include: { language: true } } },
    });
    if (!existing) throw AppError.notFound('That job could not be found.');

    const merged = upsertJobSchema.safeParse({
      title: input && typeof input === 'object' && 'title' in input ? (input as Record<string, unknown>).title : existing.title,
      description: (input as Record<string, unknown>)?.description ?? existing.description,
      location: (input as Record<string, unknown>)?.location ?? existing.location,
      department: (input as Record<string, unknown>)?.department ?? existing.department,
      minExperienceYears: (input as Record<string, unknown>)?.minExperienceYears ?? existing.minExperienceYears,
      requiredSkills: (input as Record<string, unknown>)?.requiredSkills ?? existing.requiredSkills,
      eligibilityCriteria: (input as Record<string, unknown>)?.eligibilityCriteria ?? existing.eligibilityCriteria,
      interviewDurationMinutes: (input as Record<string, unknown>)?.interviewDurationMinutes ?? existing.interviewDurationMinutes,
      passingScore: (input as Record<string, unknown>)?.passingScore ?? existing.passingScore,
      weights: { ...parseJobWeights(existing.weights), ...((input as Record<string, unknown>)?.weights as object) },
      stages: (input as Record<string, unknown>)?.stages ?? existing.stages.map((s) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        instructions: s.instructions,
        maxQuestions: s.maxQuestions,
        weight: s.weight,
        sortOrder: s.sortOrder,
      })),
      requirements: (input as Record<string, unknown>)?.requirements ?? existing.requirements.map((r) => ({
        id: r.id,
        skillTag: r.skillTag,
        description: r.description,
        minimumLevel: r.minimumLevel,
        isKnockout: r.isKnockout,
        knockoutMessage: r.knockoutMessage ?? undefined,
      })),
      proctoring: { ...asRecord(existing.proctoring), ...((input as Record<string, unknown>)?.proctoring as object) },
      status: (input as Record<string, unknown>)?.status ?? existing.status,
      // A partial patch must not silently clear the job's languages: fall back to what
      // the job already has, which is why this is read from the join table.
      preferredLanguages:
        ((input as Record<string, unknown>)?.preferredLanguages as string[] | undefined) ??
        existing.languages.map((l) => l.language.code),
    });
    if (!merged.success) throw AppError.validation('The job could not be saved. Check the highlighted fields.', merged.error.flatten());
    const data = merged.data;

    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          location: data.location,
          department: data.department,
          minExperienceYears: data.minExperienceYears,
          requiredSkills: data.requiredSkills,
          eligibilityCriteria: data.eligibilityCriteria,
          interviewDurationMinutes: data.interviewDurationMinutes,
          passingScore: data.passingScore,
          weights: normaliseWeights(data.weights) as unknown as never,
          proctoring: data.proctoring as never,
          status: data.status,
        },
      });

      // Stages and requirements are replaced wholesale — they are configuration, not
      // interview history, so no versioning is required.
      await tx.interviewStage.deleteMany({ where: { jobId: id } });
      await tx.interviewStage.createMany({
        data: data.stages.map((s, index) => ({
          jobId: id,
          kind: s.kind,
          title: s.title,
          instructions: s.instructions,
          maxQuestions: s.maxQuestions,
          weight: s.weight,
          sortOrder: s.sortOrder || index,
        })),
      });
      await tx.jobRequirement.deleteMany({ where: { jobId: id } });
      if (data.requirements.length > 0) {
        await tx.jobRequirement.createMany({
          data: data.requirements.map((r, index) => ({
            jobId: id,
            skillTag: r.skillTag,
            description: r.description,
            minimumLevel: r.minimumLevel,
            isKnockout: r.isKnockout,
            knockoutMessage: r.knockoutMessage ?? null,
            sortOrder: index,
          })),
        });
      }
    });

    await this.linkLanguages(id, data.preferredLanguages);

    const diff = AuditService.diff(existing as unknown as Record<string, unknown>, {
      title: data.title,
      status: data.status,
      passingScore: data.passingScore,
      interviewDurationMinutes: data.interviewDurationMinutes,
      weights: normaliseWeights(data.weights),
      proctoring: data.proctoring,
    });
    if (existing.status !== data.status) {
      await this.audit.record({
        action: 'job.status_changed',
        entityType: 'job',
        entityId: id,
        previous: { status: existing.status },
        next: { status: data.status },
        actor,
      });
    }
    if (Object.keys(diff).length > 0) {
      await this.audit.record({ action: 'job.updated', entityType: 'job', entityId: id, next: diff, actor });
    }

    this.logger.info('job_updated', { jobId: id, actor: actor.id, changedKeys: Object.keys(diff) });
    return this.get(id);
  }

  /** Soft delete. Historical interviews keep their job reference and remain readable. */
  async archive(id: string, actor: AuditActor): Promise<void> {
    const job = await this.prisma.job.findFirst({ where: { id, deletedAt: null } });
    if (!job) throw AppError.notFound('That job could not be found.');
    await this.prisma.$transaction([
      this.prisma.job.update({ where: { id }, data: { status: 'ARCHIVED', deletedAt: new Date() } }),
      this.prisma.question.updateMany({ where: { jobId: id }, data: { isActive: false } }),
    ]);
    await this.audit.record({
      action: 'job.archived',
      entityType: 'job',
      entityId: id,
      previous: { status: job.status },
      next: { status: 'ARCHIVED' },
      actor,
    });
    this.logger.info('job_archived', { jobId: id, actor: actor.id });
  }

  async setStatus(id: string, status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED', actor: AuditActor): Promise<JobDetailDto> {
    if (status === 'ACTIVE') await this.assertActivatable(id);
    return this.update(id, { status }, actor);
  }

  /**
   * A job may only go live with a working question set.
   *
   * This is the guard that keeps the acceptance flow honest: activating a job with no
   * questions would produce an empty interview, so it is rejected with a message that
   * tells the administrator exactly what to add.
   */
  async assertActivatable(id: string): Promise<void> {
    const [questionCount, stageCount] = await Promise.all([
      this.prisma.question.count({ where: { jobId: id, isActive: true, deletedAt: null } }),
      this.prisma.interviewStage.count({ where: { jobId: id, deletedAt: null } }),
    ]);
    const issues: string[] = [];
    if (questionCount === 0) issues.push('Add at least one active question.');
    if (stageCount === 0) issues.push('Add at least one interview stage.');
    if (issues.length > 0) {
      throw AppError.validation(`This job cannot be activated yet. ${issues.join(' ')}`);
    }
  }

  async duplicate(id: string, actor: AuditActor): Promise<JobDetailDto> {
    const source = await this.prisma.job.findFirst({
      where: { id, deletedAt: null },
      include: {
        stages: true,
        requirements: true,
        languages: true,
        questions: { include: { scoringCriteria: true, followUpRules: true, translations: true } },
      },
    });
    if (!source) throw AppError.notFound('That job could not be found.');

    const created = await this.prisma.job.create({
      data: {
        title: `${source.title} (copy)`,
        description: source.description,
        location: source.location,
        department: source.department,
        minExperienceYears: source.minExperienceYears,
        requiredSkills: source.requiredSkills,
        eligibilityCriteria: source.eligibilityCriteria,
        interviewDurationMinutes: source.interviewDurationMinutes,
        passingScore: source.passingScore,
        weights: source.weights as never,
        proctoring: source.proctoring as never,
        status: 'DRAFT',
        createdById: actor.id ?? null,
        stages: {
          create: source.stages.map((s) => ({
            kind: s.kind,
            title: s.title,
            instructions: s.instructions,
            maxQuestions: s.maxQuestions,
            weight: s.weight,
            sortOrder: s.sortOrder,
          })),
        },
        requirements: {
          create: source.requirements.map((r) => ({
            skillTag: r.skillTag,
            description: r.description,
            minimumLevel: r.minimumLevel,
            isKnockout: r.isKnockout,
            knockoutMessage: r.knockoutMessage,
            sortOrder: r.sortOrder,
          })),
        },
      },
    });

    for (const q of source.questions) {
      await this.prisma.question.create({
        data: {
          jobId: created.id,
          categoryName: q.categoryName,
          difficulty: q.difficulty,
          baseLanguage: q.baseLanguage,
          text: q.text,
          speakText: q.speakText,
          expectedAnswerGuidance: q.expectedAnswerGuidance,
          evaluationInstructions: q.evaluationInstructions,
          keywords: q.keywords,
          skillTags: q.skillTags,
          weight: q.weight,
          scoreMax: q.scoreMax,
          scoreMin: q.scoreMin,
          isRequired: q.isRequired,
          isKnockout: q.isKnockout,
          knockoutMessage: q.knockoutMessage,
          maxRetries: q.maxRetries,
          timeLimitSeconds: q.timeLimitSeconds,
          sortOrder: q.sortOrder,
          source: q.source,
          isActive: true,
          validationStatus: q.validationStatus,
          validationIssues: q.validationIssues,
          createdById: actor.id ?? null,
          translations: {
            create: q.translations.map((t) => ({
              languageId: t.languageId,
              text: t.text,
              speakText: t.speakText,
            })),
          },
          scoringCriteria: {
            create: q.scoringCriteria.map((c) => ({
              label: c.label,
              description: c.description,
              points: c.points,
              keywords: c.keywords,
              isKnockout: c.isKnockout,
              knockoutMessage: c.knockoutMessage,
              sortOrder: c.sortOrder,
            })),
          },
          followUpRules: {
            create: q.followUpRules.map((r) => ({
              questionText: r.questionText,
              trigger: r.trigger,
              maxUses: r.maxUses,
              weight: r.weight,
              sortOrder: r.sortOrder,
            })),
          },
        },
      });
    }

    if (source.languages.length > 0) {
      await this.prisma.jobPreferredLanguage.createMany({
        data: source.languages.map((l) => ({ jobId: created.id, languageId: l.languageId })),
        skipDuplicates: true,
      });
    }

    await this.audit.record({
      action: 'job.created',
      entityType: 'job',
      entityId: created.id,
      next: { title: created.title, duplicatedFrom: id, questions: source.questions.length },
      actor,
    });
    this.logger.info('job_duplicated', { from: id, to: created.id, actor: actor.id });
    return this.get(created.id);
  }

  /** Public payload the kiosk uses to list open roles. No internal identifiers leak. */
  async publicList(): Promise<Array<{ id: string; title: string; description: string; location: string; department: string; languages: string[]; questionCount: number; durationMinutes: number }>> {
    const jobs = await this.prisma.job.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      include: { languages: { include: { language: true } }, _count: { select: { questions: true } } },
      orderBy: { title: 'asc' },
    });
    return jobs.map((job) => ({
      id: job.id,
      title: job.title,
      description: job.description.slice(0, 400),
      location: job.location,
      department: job.department,
      languages: job.languages.map((l) => l.language.code),
      questionCount: job._count.questions,
      durationMinutes: job.interviewDurationMinutes,
    }));
  }

  /**
   * Replaces the job's language list.
   *
   * Silently ignoring an unknown code would leave the job advertised in a language the
   * kiosk cannot actually speak, so an unrecognised code is a hard error.
   */
  private async linkLanguages(jobId: string, codes: string[]): Promise<void> {
    const unique = [...new Set(codes.filter(Boolean))];
    if (unique.length === 0) throw AppError.validation('Select at least one language for this job.');
    const languages = await this.prisma.language.findMany({ where: { code: { in: unique }, deletedAt: null } });
    const found = new Set(languages.map((l) => l.code));
    const missing = unique.filter((c) => !found.has(c));
    if (missing.length > 0) {
      throw AppError.validation(`These languages are not enabled on this deployment: ${missing.join(', ')}.`);
    }
    await this.prisma.jobPreferredLanguage.deleteMany({ where: { jobId } });
    await this.prisma.jobPreferredLanguage.createMany({
      data: languages.map((l) => ({ jobId, languageId: l.id })),
      skipDuplicates: true,
    });
  }

  async jobTitle(id: string): Promise<string> {
    const job = await this.prisma.job.findUnique({ where: { id }, select: { title: true } });
    return asString(job?.title);
  }
}