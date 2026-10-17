import { deriveRecommendation } from '@proctor/ai';
import type { Logger, PrismaClient } from '@proctor/database';
import type { ReviewSubmissionInput, SystemSettings } from '@proctor/types';
import { AppError } from '../lib/errors.js';
import { AuditService, type AuditActor } from '../lib/audit.js';
import { parseJobWeights, computeSkillScores, weightedOverallScore, type ScoredAnswer } from './scoring.js';

/**
 * Human review.
 *
 * This is the safeguard that makes the whole system defensible: an AI screen is a
 * triage aid, and a human decides. Three things are therefore enforced here.
 *
 *  1. Auditability — every score change and every recommendation override records who
 *     did it, when, and what the AI had said before. `decisionSource` distinguishes
 *     AI-generated from human-reviewed from human-overridden.
 *  2. Reason required — a reviewer may change a score or a recommendation, but must
 *     leave a note explaining why. Bare overrides are rejected.
 *  3. Immutability — human edits are written as new state; the original AI evaluation
 *     is never overwritten. That means the "what did the model say?" question always
 *     has an answer.
 */
export class ReviewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
    private readonly audit: AuditService,
    private readonly settingsProvider: () => Promise<SystemSettings>,
  ) {}

  async submit(sessionId: string, input: ReviewSubmissionInput, actor: AuditActor): Promise<{ recommendation: string; overallScore: number; decisionSource: string }> {
    const reviewerId = actor.id;
    if (!reviewerId) throw AppError.unauthenticated('Sign in to review.');
    if (input.answerScores.length === 0 && input.overallScoreOverride === undefined && input.recommendationOverride === undefined && !input.notes) {
      throw AppError.validation('Nothing was submitted. Adjust a score, set a recommendation, or add a note.');
    }
    const overridesWithoutNote =
      (input.overallScoreOverride !== undefined || input.recommendationOverride !== undefined || input.answerScores.length > 0) &&
      (!input.notes || input.notes.trim().length < 5);
    if (overridesWithoutNote) {
      throw AppError.validation('Please explain the change in the notes field. A reviewer reason is required for every score or recommendation change.');
    }

    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        job: true,
        answers: { include: { score: { include: { criterionScores: true } }, question: true } },
        proctorEvents: true,
        report: true,
        eligibilityResults: true,
        candidate: true,
      },
    });
    if (!session) throw AppError.notFound('That interview could not be found.');
    if (!session.report) throw AppError.conflict('This interview has not been evaluated yet.');

    const settings = await this.settingsProvider();
    const reportAtStart = session.report;

    /* --- 1. Per-answer score overrides ---------------------------------- */
    for (const override of input.answerScores) {
      const existing = session.answers.find((a) => a.score?.id === override.answerScoreId);
      if (!existing?.score) {
        throw AppError.notFound('One of the answers being reviewed no longer exists.');
      }
      await this.prisma.answerScore.update({
        where: { id: override.answerScoreId },
        data: {
          rawScore: override.rawScore ?? existing.score.rawScore,
          normalizedScore: existing.score.maxScore > 0
            ? Math.round(((override.rawScore ?? existing.score.rawScore) / existing.score.maxScore) * 100 * 100) / 100
            : 0,
          reviewerId,
          reviewerComment: override.reviewerComment ?? existing.score.reviewerComment,
          reviewedAt: new Date(),
          source: override.rawScore !== undefined && override.rawScore !== existing.score.rawScore ? 'HUMAN_OVERRIDDEN' : 'HUMAN_REVIEWED',
          ...(override.rawScore !== undefined ? { aiNotes: `${existing.score.aiNotes}\n[Adjusted by reviewer from ${existing.score.rawScore} to ${override.rawScore}.]` } : {}),
        },
      });
    }

    /* --- 2. Recompute aggregates with human scores ---------------------- */
    const refreshed = await this.prisma.interviewSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        job: true,
        answers: { include: { score: true, question: true } },
        proctorEvents: true,
        eligibilityResults: true,
      },
    });

    const scored: ScoredAnswer[] = refreshed.answers
      .filter((a) => a.score && a.question)
      .map((a) => ({
        questionKey: a.questionId!,
        questionId: a.questionId,
        category: a.question!.categoryName,
        skillTags: a.question!.skillTags,
        weight: a.question!.weight,
        maxScore: a.score!.maxScore,
        rawScore: a.score!.rawScore,
        normalizedScore: a.score!.normalizedScore,
        confidence: a.score!.confidence,
        criterionScores: [],
        evaluationReason: a.score!.evaluationReason,
        concerns: a.score!.concerns,
        biasFlags: a.score!.biasFlags,
        isKnockout: a.question!.isKnockout,
        triggeredKnockout: false,
      }));

    const skillScores = computeSkillScores(scored);
    const overall = weightedOverallScore(scored, parseJobWeights(refreshed.job.weights), skillScores);
    const overallScore = input.overallScoreOverride ?? overall.score;

    const lowConfidence = scored.some((a) => a.confidence < settings.scoring.requireHumanReviewBelowConfidence);
    const derived = deriveRecommendation({
      weightedScore: overallScore,
      passingScore: refreshed.job.passingScore || settings.scoring.passingScore,
      knockoutTriggered: refreshed.knockoutTriggered,
      proctorEventCount: refreshed.proctorEvents.length,
      lowConfidenceDetected: lowConfidence,
      demoMode: refreshed.isDemo,
      autoRecommend: settings.scoring.autoRecommend,
    });

    const recommendation = input.recommendationOverride ?? derived.recommendation;
    const isOverride =
      input.recommendationOverride !== undefined && input.recommendationOverride !== derived.recommendation;
    const decisionSource = isOverride ? 'HUMAN_OVERRIDDEN' : input.markReviewed ? 'HUMAN_REVIEWED' : session.report.decisionSource;

    /* --- 3. Persist the reviewed report --------------------------------- */
    await this.prisma.$transaction(async (tx) => {
      await tx.evaluationReport.update({
        where: { sessionId },
        data: {
          overallScore,
          recommendation,
          decisionSource,
          skillScores: skillScores.map((s) => ({
            skill: s.skill,
            score: s.earned,
            max: s.max,
            evidence: s.evidence.join('; ') || 'Derived from rubric scoring.',
          })) as never,
          strengths: skillScores.filter((s) => s.percent >= 60).slice(0, 6).map((s) => `${humanise(s.skill)} (${Math.round(s.percent)}%)`),
          weaknesses: skillScores.filter((s) => s.percent < 40).slice(0, 6).map((s) => `${humanise(s.skill)} (${Math.round(s.percent)}%)`),
          recommendedNextAction: nextActionFor(recommendation, Boolean(input.recommendationOverride)),
          methodology: `${reportAtStart.methodology}\n[Reviewed by ${actor.email ?? reviewerId} on ${new Date().toISOString()}${isOverride ? ' — recommendation overridden' : ''}.]`,
        },
      });

      if (input.notes?.trim()) {
        await tx.reviewerNote.create({
          data: {
            sessionId,
            authorId: reviewerId,
            note: input.notes.trim().slice(0, 4000),
            decision: isOverride ? `OVERRIDDEN_TO_${recommendation}` : `CONFIRMED_${recommendation}`,
          },
        });
      }

      if (input.markReviewed) {
        await tx.interviewSession.update({
          where: { id: sessionId },
          data: { isLocked: true },
        });
      }
    });

    if (isOverride) {
      await this.audit.record({
        action: 'review.overridden',
        entityType: 'interview_session',
        entityId: sessionId,
        previous: { recommendation: session.report.recommendation, overallScore: session.report.overallScore },
        next: { recommendation, overallScore, reason: input.notes },
        actor,
      });
    }
    await this.audit.record({
      action: 'review.submitted',
      entityType: 'interview_session',
      entityId: sessionId,
      next: {
        recommendation,
        overallScore,
        decisionSource,
        answerOverrides: input.answerScores.length,
        scoreOverride: input.overallScoreOverride !== undefined,
      },
      actor,
    });

    this.logger.info('review_submitted', {
      sessionId,
      reviewerId,
      recommendation,
      overridden: isOverride,
      scoreOverride: input.overallScoreOverride !== undefined,
    });

    return { recommendation, overallScore, decisionSource };
  }

  async addNote(sessionId: string, note: string, decision: string | null, actor: AuditActor): Promise<void> {
    if (!actor.id) throw AppError.unauthenticated('Sign in to add a note.');
    if (!note.trim()) throw AppError.validation('A note cannot be empty.');
    await this.prisma.reviewerNote.create({
      data: { sessionId, authorId: actor.id, note: note.trim().slice(0, 4000), decision },
    });
    await this.audit.record({
      action: 'review.submitted',
      entityType: 'interview_session',
      entityId: sessionId,
      next: { noteAdded: true, decision },
      actor,
    });
  }

  /** Distinct list of reviewer actions for the audit trail view. */
  async reviewHistory(sessionId: string): Promise<Array<{ at: string; actor: string; action: string; detail: string }>> {
    const notes = await this.prisma.reviewerNote.findMany({
      where: { sessionId },
      include: { author: { select: { email: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const audit = await this.prisma.auditLog.findMany({
      where: { entityId: sessionId, action: { in: ['review.submitted', 'review.overridden', 'proctor.reviewed'] } },
      orderBy: { createdAt: 'asc' },
    });
    return [
      ...notes.map((n) => ({
        at: n.createdAt.toISOString(),
        actor: n.author.email ?? n.author.name,
        action: 'NOTE',
        detail: n.decision ? `${n.decision}: ${n.note}` : n.note,
      })),
      ...audit.map((a) => ({
        at: a.createdAt.toISOString(),
        actor: a.actorEmail ?? 'system',
        action: a.action,
        detail: typeof a.next === 'object' && a.next !== null ? JSON.stringify(a.next).slice(0, 300) : '',
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
  }
}

function humanise(s: string): string {
  return s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function nextActionFor(recommendation: string, wasOverridden: boolean): string {
  if (wasOverridden) {
    return 'A human reviewer overrode the automated recommendation. Treat this as the employer decision and record the reason.';
  }
  switch (recommendation) {
    case 'STRONG_MATCH':
      return 'Proceed to a human interview panel.';
    case 'GOOD_MATCH':
      return 'Proceed to a human review of the recording before deciding.';
    case 'CONSIDER':
      return 'Human judgement required. Review the recording and transcript against the job requirements.';
    case 'NOT_RECOMMENDED':
      return 'Do not progress at this stage. Retain the record for future opportunities.';
    default:
      return 'Awaiting human review.';
  }
}