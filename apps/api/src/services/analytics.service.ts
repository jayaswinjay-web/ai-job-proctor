import type { PrismaClient } from '@proctor/database';
import type { DashboardStatsDto, CandidateListItemDto, SessionDetailDto, SessionDto } from '@proctor/types';
import { AppError } from '../lib/errors.js';
// Answer scores hang off CandidateAnswer, not off the session directly.

/**
 * Read models for the admin dashboard.
 *
 * Every query here is deliberately aggregate-only for analytics (no transcripts, no
 * audio) so the reporting surface cannot become a way to browse candidate content
 * without going through the audited `candidate:read` path.
 */

export interface CandidateQuery {
  jobId?: string;
  languageCode?: string;
  status?: string;
  recommendation?: string;
  reviewState?: 'NOT_STARTED' | 'IN_PROGRESS' | 'REVIEWED';
  proctorStatus?: 'CLEAR' | 'EVENTS' | 'REVIEW_REQUIRED';
  minScore?: number;
  maxScore?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  isDemo?: boolean;
  sort?: 'date_desc' | 'date_asc' | 'score_desc' | 'score_asc' | 'name_asc';
  page?: number;
  pageSize?: number;
}

export class AnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  async dashboard(input: { jobId?: string; dateFrom?: Date; dateTo?: Date } = {}): Promise<DashboardStatsDto> {
    const dateFilter = {
      ...(input.dateFrom ? { gte: input.dateFrom } : {}),
      ...(input.dateTo ? { lte: input.dateTo } : {}),
    };
    // InterviewSession has no soft-delete column: lifecycle is expressed through
    // sessionStatus, and an erased candidate keeps a countable, anonymised session.
    const sessionWhere = {
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(Object.keys(dateFilter).length > 0 ? { startedAt: dateFilter } : {}),
    };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrow = new Date(todayStart.getTime() + 86_400_000);

    const [
      totalCandidates,
      interviewsToday,
      completedInterviews,
      pendingReviews,
      scoreAgg,
      passedAgg,
      activeJobs,
      proctoringAlerts,
      dropoff,
      languages,
      proctorStats,
      startedCount,
    ] = await Promise.all([
      this.prisma.candidate.count({ where: { deletedAt: null } }),
      this.prisma.interviewSession.count({
        where: { ...sessionWhere, startedAt: { gte: todayStart, lt: tomorrow } },
      }),
      this.prisma.interviewSession.count({ where: { ...sessionWhere, sessionStatus: 'COMPLETED' } }),
      this.prisma.evaluationReport.count({ where: { recommendation: 'PENDING_REVIEW' } }),
      this.prisma.evaluationReport.aggregate({
        where: { ...(input.jobId ? { session: { jobId: input.jobId } } : {}) },
        _avg: { overallScore: true },
        _count: true,
      }),
      this.prisma.evaluationReport.count({
        where: {
          recommendation: { in: ['STRONG_MATCH', 'GOOD_MATCH'] },
          ...(input.jobId ? { session: { jobId: input.jobId } } : {}),
        },
      }),
      this.prisma.job.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.proctoringEvent.count({ where: { requiresHumanReview: true, acknowledged: false } }),
      this.groupByStage(sessionWhere),
      this.prisma.interviewSession.groupBy({
        by: ['languageCode'],
        where: sessionWhere,
        _count: { _all: true },
      }),
      this.prisma.proctoringEvent.groupBy({
        by: ['type'],
        _count: { _all: true },
      }),
      this.prisma.interviewSession.count({ where: sessionWhere }),
    ]);

    const jobScores = await this.scoresByJob(input.jobId);
    const totalReports = scoreAgg._count ?? 0;

    return {
      totalCandidates,
      interviewsToday,
      completedInterviews,
      pendingReviews,
      averageScore: scoreAgg._avg.overallScore === null ? null : round2(scoreAgg._avg.overallScore),
      passRate: totalReports === 0 ? null : round2((passedAgg / totalReports) * 100),
      activeJobs,
      proctoringAlerts,
      dropoffByStage: dropoff,
      scoresByJob: jobScores,
      languageDistribution: languages
        .map((l) => ({ languageCode: l.languageCode, count: l._count._all }))
        .sort((a, b) => b.count - a.count),
      proctorEventStats: proctorStats.map((s) => ({ type: s.type, count: s._count._all })),
      completionRate: startedCount === 0 ? null : round2((completedInterviews / startedCount) * 100),
    };
  }

  private async scoresByJob(jobId?: string): Promise<Array<{ jobId: string; jobTitle: string; averageScore: number; count: number }>> {
    const rows = await this.prisma.evaluationReport.findMany({
      where: { ...(jobId ? { session: { jobId } } : {}) },
      select: { overallScore: true, session: { select: { jobId: true, job: { select: { title: true } } } } },
    });
    const buckets = new Map<string, { title: string; total: number; count: number }>();
    for (const row of rows) {
      const entry = buckets.get(row.session.jobId) ?? { title: row.session.job.title, total: 0, count: 0 };
      entry.total += row.overallScore;
      entry.count += 1;
      buckets.set(row.session.jobId, entry);
    }
    return [...buckets.entries()]
      .map(([id, b]) => ({ jobId: id, jobTitle: b.title, averageScore: round2(b.total / b.count), count: b.count }))
      .sort((a, b) => b.count - a.count);
  }

  /** Candidates abandoned partway, grouped by the last stage they reached. */
  private async groupByStage(where: Record<string, unknown>): Promise<Array<{ stage: string; count: number }>> {
    const rows = await this.prisma.interviewSession.findMany({
      where: { ...where, sessionStatus: { in: ['ABANDONED', 'EXPIRED'] } },
      select: { stageKind: true },
    });
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.stageKind, (counts.get(row.stageKind) ?? 0) + 1);
    return [...counts.entries()].map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count);
  }

  /* ------------------------------------------------------------------ */

  async candidates(query: CandidateQuery): Promise<{ items: CandidateListItemDto[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 25));

    const where: Record<string, unknown> = {
      ...(query.jobId ? { jobId: query.jobId } : {}),
      ...(query.languageCode ? { languageCode: query.languageCode } : {}),
      ...(query.status ? { sessionState: query.status } : {}),
      ...(query.isDemo !== undefined ? { isDemo: query.isDemo } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            startedAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { publicId: { contains: query.search, mode: 'insensitive' } },
              { candidate: { name: { contains: query.search, mode: 'insensitive' } } },
              { job: { title: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(query.recommendation ? { report: { recommendation: query.recommendation } } : {}),
      ...(query.minScore !== undefined || query.maxScore !== undefined
        ? {
            report: {
              ...(query.recommendation ? { recommendation: query.recommendation } : {}),
              ...(query.minScore !== undefined || query.maxScore !== undefined
                ? {
                    overallScore: {
                      ...(query.minScore !== undefined ? { gte: query.minScore } : {}),
                      ...(query.maxScore !== undefined ? { lte: query.maxScore } : {}),
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(query.proctorStatus
        ? {
            proctorEvents:
              query.proctorStatus === 'CLEAR'
                ? { none: {} }
                : query.proctorStatus === 'REVIEW_REQUIRED'
                  ? { some: { requiresHumanReview: true } }
                  : { some: {} },
          }
        : {}),
      ...(query.reviewState
        ? {
            reviewerNotes: query.reviewState === 'REVIEWED' ? { some: {} } : { none: {} },
          }
        : {}),
    };

    const orderBy =
      query.sort === 'score_desc'
        ? [{ report: { overallScore: 'desc' as const } }]
        : query.sort === 'score_asc'
          ? [{ report: { overallScore: 'asc' as const } }]
          : query.sort === 'name_asc'
            ? [{ candidate: { name: 'asc' as const } }]
            : [{ startedAt: query.sort === 'date_asc' ? ('asc' as const) : ('desc' as const) }];

    const [rows, total] = await Promise.all([
      this.prisma.interviewSession.findMany({
        where,
        include: {
          job: { select: { title: true } },
          candidate: { select: { name: true } },
          report: { select: { overallScore: true, recommendation: true } },
          proctorEvents: { select: { requiresHumanReview: true } },
          reviewerNotes: { select: { id: true } },
        },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.interviewSession.count({ where }),
    ]);

    const items: CandidateListItemDto[] = rows.map((row) => ({
      sessionId: row.id,
      publicId: row.publicId,
      candidateName: row.candidate.name,
      jobTitle: row.job.title,
      interviewDate: row.startedAt.toISOString(),
      status: row.sessionState,
      overallScore: row.report?.overallScore ?? null,
      recommendation: row.report?.recommendation ?? null,
      reviewState: row.reviewerNotes.length > 0 ? 'REVIEWED' : row.report?.recommendation === 'PENDING_REVIEW' ? 'IN_PROGRESS' : 'NOT_STARTED',
      proctorStatus: row.proctorEvents.some((e) => e.requiresHumanReview)
        ? 'REVIEW_REQUIRED'
        : row.proctorEvents.length > 0
          ? 'EVENTS'
          : 'CLEAR',
      languageCode: row.languageCode,
      isDemo: row.isDemo,
    }));

    return { items, total, page, pageSize };
  }

  /* ------------------------------------------------------------------ */

  async sessionDetail(sessionId: string): Promise<SessionDetailDto> {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        job: { select: { title: true } },
        candidate: true,
        answers: {
          orderBy: { answeredAt: 'asc' },
          include: {
            score: { include: { criterionScores: true } },
            question: { select: { text: true, categoryName: true, version: true } },
            recording: { select: { id: true } },
          },
        },
        proctorEvents: { orderBy: { occurredAt: 'asc' } },
        report: true,
        recordings: true,
        reviewerNotes: { include: { author: { select: { name: true, email: true } } }, orderBy: { createdAt: 'asc' } },
        eligibilityResults: true,
      },
    });
    if (!session) throw AppError.notFound('That interview could not be found.');

    const scores = session.answers
      .map((a) => a.score)
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return {
      session: {
        sessionId: session.id,
        publicId: session.publicId,
        state: session.sessionState,
        stage: session.stageKind,
        jobId: session.jobId,
        jobTitle: session.job.title,
        languageCode: session.languageCode,
        consentRecorded: session.consentRecorded,
        consentText: session.consentText,
        questionIndex: session.questionIndex,
        totalQuestions: session.totalQuestions,
        startedAt: session.startedAt.toISOString(),
        completedAt: session.completedAt?.toISOString() ?? null,
        settingsSnapshot: (session.settingsSnapshot ?? {}) as Record<string, unknown>,
        // Voice transport metadata: lets the admin console show that an interview is
        // running over LiveKit Cloud and which agent instance is conducting it.
        voiceTransport: session.voiceTransport,
        livekitRoomName: session.livekitRoomName,
        voiceAgentSessionId: session.voiceAgentSessionId,
        voiceConnectedAt: session.voiceConnectedAt?.toISOString() ?? null,
      },
      candidate: {
        id: session.candidate.id,
        publicId: session.candidate.publicId,
        name: session.candidate.name,
        age: session.candidate.age,
        village: session.candidate.village,
        previousWork: session.candidate.previousWork,
        yearsExperience: session.candidate.yearsExperience,
        workPreference: session.candidate.workPreference,
        canTravel: session.candidate.canTravel,
        phone: session.candidate.phone,
        languageCode: session.candidate.languageCode,
        consentRecorded: session.consentRecorded,
      },
      answers: session.answers.map((a) => {
        return {
          id: a.id,
          questionId: a.questionId,
          // For curated questions we show the live wording plus the pinned version, so a
          // reviewer can see both what is asked now and what this candidate actually saw.
          questionText: a.question?.text ?? 'Introduction detail',
          questionCategory: a.question?.categoryName ?? null,
          questionVersion: a.questionVersionId ? a.question?.version ?? null : null,
          stageKind: a.stageKind,
          transcript: a.transcript,
          interpretation: a.interpretation,
          isCommand: a.isCommand,
          command: a.command as never,
          isSkipped: a.isSkipped,
          spokenLanguage: a.spokenLanguage,
          answeredAt: a.answeredAt.toISOString(),
          durationMs: a.durationMs,
          audioRecordingId: a.recording?.id ?? null,
        };
      }),
      scores: scores.map((s) => ({
        id: s.id,
        questionId: s.questionId,
        rawScore: s.rawScore,
        normalizedScore: s.normalizedScore,
        maxScore: s.maxScore,
        confidence: s.confidence,
        evaluationReason: s.evaluationReason,
        strengths: s.strengths,
        concerns: s.concerns,
        aiNotes: s.aiNotes,
        criterionScores: s.criterionScores.map((c) => ({
          label: c.label,
          points: c.points,
          max: c.maxPoints,
          hitKeywords: c.hitKeywords,
        })),
        biasFlags: s.biasFlags,
        source: s.source,
        reviewerId: s.reviewerId,
        reviewerComment: s.reviewerComment,
        reviewedAt: s.reviewedAt?.toISOString() ?? null,
      })),
      proctorEvents: session.proctorEvents.map((e) => ({
        id: e.id,
        type: e.type,
        occurredAt: e.occurredAt.toISOString(),
        confidence: e.confidence,
        severity: e.severity,
        description: e.description,
        reference: e.reference,
        snapshotUrl: e.snapshotKey ? `/api/v1${'/admin/proctoring/events/' + e.id + '/snapshot'}` : null,
        stageKind: e.stageKind,
        acknowledged: e.acknowledged,
      })),
      report: session.report
        ? {
            id: session.report.id,
            sessionId: session.report.sessionId,
            overallScore: session.report.overallScore,
            maxScore: session.report.maxScore,
            recommendation: session.report.recommendation,
            decisionSource: session.report.decisionSource,
            summary: session.report.summary,
            experienceSummary: session.report.experienceSummary,
            eligibilityStatus: session.report.eligibilityStatus,
            skillScores: (session.report.skillScores ?? []) as never,
            strengths: session.report.strengths,
            weaknesses: session.report.weaknesses,
            concerns: session.report.concerns,
            recommendedNextAction: session.report.recommendedNextAction,
            methodology: session.report.methodology,
            isAiAssisted: true,
            disclaimer:
              'AI-assisted screening output. Every score should be verified by a human reviewer before any employment decision is made.',
            proctorEventCount: session.proctorEvents.length,
            knockoutTriggered: session.knockoutTriggered,
            generatedAt: session.report.generatedAt.toISOString(),
          }
        : null,
      recordings: session.recordings.map((r) => ({
        id: r.id,
        kind: r.kind,
        durationMs: r.durationMs,
        createdAt: r.createdAt.toISOString(),
      })),
      reviewState: session.reviewerNotes.length > 0 ? 'REVIEWED' : session.report?.recommendation === 'PENDING_REVIEW' ? 'IN_PROGRESS' : 'NOT_STARTED',
      reviewerNotes: session.reviewerNotes.map((n) => ({
        id: n.id,
        author: n.author.email ?? n.author.name,
        note: n.note,
        createdAt: n.createdAt.toISOString(),
        decision: n.decision,
      })),
      timeline: (session.timeline ?? []) as Array<{ at: string; kind: string; detail: string }>,
    };
  }

  /** Paged session list used by the kiosk-facing "my session" recovery. */
  async activeSessionsForKiosk(kioskId: string, idleMinutes: number): Promise<SessionDto[]> {
    const cutoff = new Date(Date.now() - idleMinutes * 60_000);
    const sessions = await this.prisma.interviewSession.findMany({
      where: {
        kioskId,
        sessionStatus: 'ACTIVE',
        lastActivityAt: { gte: cutoff },
        isLocked: false,
      },
      include: { job: { select: { title: true } } },
      orderBy: { lastActivityAt: 'desc' },
      take: 5,
    });
    return sessions.map((s) => ({
      sessionId: s.id,
      publicId: s.publicId,
      state: s.sessionState,
      stage: s.stageKind,
      jobId: s.jobId,
      jobTitle: s.job.title,
      languageCode: s.languageCode,
      consentRecorded: s.consentRecorded,
      consentText: s.consentText,
      questionIndex: s.questionIndex,
      totalQuestions: s.totalQuestions,
      startedAt: s.startedAt.toISOString(),
      completedAt: null,
      settingsSnapshot: (s.settingsSnapshot ?? {}) as Record<string, unknown>,
    }));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}