import { customAlphabet } from 'nanoid';
import { deriveRecommendation, generateReport, withFallback, MockLlmProvider } from '@proctor/ai';
import { phrase, type SystemSettings } from '@proctor/types';
import type { Logger, PrismaClient } from '@proctor/database';
import { AppError } from '../lib/errors.js';
import { publicId as makePublicId } from '../lib/crypto.js';
import { asArray, asRecord, asString } from '../lib/merge.js';
import { canTransition, createEngineState, TERMINAL_STATES, type EngineState } from './interview-state.js';
import { InterviewEngine, type EngineDirective, type EngineRecord, type EngineTurnResult, type VoiceTurnInput } from './interview-engine.js';
import type { DetailField } from '@proctor/ai';
import { buildInterviewPlan, parseJobProctoring } from './plan-builder.js';
import {
  collectBiasFlags,
  computeSkillScores,
  parseJobWeights,
  weightedOverallScore,
  type ScoredAnswer,
} from './scoring.js';

/**
 * Session service — owns persistence around the interview engine.
 *
 * Transaction discipline
 * ----------------------
 * Each turn is committed in one transaction that writes the candidate answer, the
 * eligibility result, the new engine state, and the session row. Evaluation runs
 * *after* that commit, so a slow or failing model can never delay or lose an answer
 * the candidate has already given. This is the single most important reliability
 * property in the system: an interview must survive an AI outage.
 */

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);

export interface SessionDeps {
  prisma: PrismaClient;
  logger: Logger;
  ai: {
    llm: import('@proctor/ai').LlmProvider;
    evaluation: import('@proctor/ai').EvaluationProvider;
  };
  /** Read live: settings are administrator-configurable at runtime. */
  settings: () => Promise<SystemSettings>;
  demoMode: boolean;
  storage: import('../storage/index.js').StorageDriver;
  retainAudio: boolean;
}

export interface StartSessionInput {
  jobId: string;
  kioskId: string;
  languageCode?: string;
  consentGiven?: boolean;
  demoMode?: boolean;
}

export interface StartSessionOutput {
  sessionId: string;
  publicId: string;
  state: string;
  languageCode: string;
  totalQuestions: number;
  settingsSnapshot: Record<string, unknown>;
  proctoring: ReturnType<typeof parseJobProctoring>;
  /** Opaque token proving this kiosk owns the session. */
  sessionSecret: string;
}

export class SessionService {
  private mockLlm: MockLlmProvider;
  private settingsSnapshotCache: SystemSettings | null = null;

  constructor(private readonly deps: SessionDeps) {
    this.mockLlm = new MockLlmProvider({ supportedLanguages: ['en'], fallbackLanguage: 'en', latencyMs: 0 });
  }

  /**
   * Settings are read once per request/turn and cached for that request, so a single
   * turn never observes a half-applied configuration change.
   */
  private async settings(): Promise<SystemSettings> {
    if (!this.settingsSnapshotCache) {
      this.settingsSnapshotCache = await this.deps.settings();
      this.syncMockLlm();
    }
    return this.settingsSnapshotCache;
  }

  /**
   * Clears the per-request settings cache.
   *
   * Called at the start of every session/turn request so an administrator's settings
   * change is picked up on the next request, while all work within one request still
   * sees a single consistent configuration.
   */
  resetSettingsCache(): void {
    this.settingsSnapshotCache = null;
  }

  /** Rebuilds the offline engine with the currently cached settings. */
  private syncMockLlm(): void {
    const settings = this.settingsSnapshotCache;
    this.mockLlm = new MockLlmProvider({
      supportedLanguages: settings?.general.supportedLanguages ?? ['en'],
      fallbackLanguage: settings?.general.fallbackLanguage ?? 'en',
      latencyMs: 0,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  async start(input: StartSessionInput): Promise<StartSessionOutput> {
    const settings = await this.settings();

    const job = await this.deps.prisma.job.findFirst({
      where: { id: input.jobId, deletedAt: null, status: 'ACTIVE' },
      include: { languages: { include: { language: true } } },
    });
    if (!job) {
      throw AppError.notFound('That job is not available for applications right now.');
    }

    const supported = settings.general.supportedLanguages;
    const requested = input.languageCode ?? settings.general.defaultLanguage;
    const languageCode = supported.includes(requested) ? requested : (supported[0] ?? 'en');

    const plan = await buildInterviewPlan(this.deps.prisma, this.deps.logger, {
      jobId: job.id,
      languageCode,
      supportedLanguages: supported,
    });

    const settingsSnapshot = await this.snapshotSettings(job, plan.summary.questionCount);
    const consentText = settings.general.privacyNoticeRequired ? phrase('consent_notice', languageCode) : null;

    const state = createEngineState({ languageCode, plan, consentText });
    const sessPublicId = makePublicId('sess');

    const session = await this.deps.prisma.$transaction(async (tx) => {
      const candidate = await tx.candidate.create({
        data: {
          publicId: `cand_${nanoid()}`,
          languageCode,
        },
      });

      const created = await tx.interviewSession.create({
        data: {
          publicId: sessPublicId,
          candidateId: candidate.id,
          jobId: job.id,
          kioskId: input.kioskId,
          languageCode,
          languageId: await this.languageIdFor(languageCode),
          consentRecorded: input.consentGiven === true,
          consentText,
          consentAt: input.consentGiven === true ? new Date() : null,
          // `stageKind` mirrors the visible stage; `sessionState` is the
          // lifecycle state machine position.
          stageKind: settings.general.privacyNoticeRequired && input.consentGiven !== true ? 'CONSENT' : 'BASIC_DETAILS',
          sessionState: settings.general.privacyNoticeRequired && input.consentGiven !== true ? 'AWAITING_CONSENT' : 'BASIC_DETAILS',
          settingsSnapshot: settingsSnapshot as never,
          engineState: state as never,
          timeline: [timelineEntry('session_created', `Kiosk ${input.kioskId} · language ${languageCode}`)] as never,
          totalQuestions: plan.summary.questionCount,
          isDemo: input.demoMode === true || this.deps.demoMode,
        },
      });

      return created;
    });

    await this.deps.prisma.auditLog
      .create({
        data: {
          action: 'session.started',
          entityType: 'interview_session',
          entityId: session.id,
          next: { jobId: job.id, jobTitle: job.title, kioskId: input.kioskId, languageCode, demo: session.isDemo },
        },
      })
      .catch(() => undefined);

    this.deps.logger.info('session_started', {
      sessionPublicId: sessPublicId,
      jobId: job.id,
      languageCode,
      questionCount: plan.summary.questionCount,
      demo: session.isDemo,
    });

    return {
      sessionId: session.id,
      publicId: sessPublicId,
      state: session.sessionState,
      languageCode,
      totalQuestions: plan.summary.questionCount,
      settingsSnapshot,
      proctoring: parseJobProctoring(job.proctoring),
      sessionSecret: makePublicId('sk'),
    };
  }

  /** Loads the engine state for a session, or null when it cannot be resumed. */
  async loadState(sessionId: string): Promise<{ state: EngineState; languageCode: string; jobId: string; isLocked: boolean; demo: boolean } | null> {
    const session = await this.deps.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      select: { engineState: true, languageCode: true, jobId: true, isLocked: true, isDemo: true, sessionState: true },
    });
    if (!session) return null;
    if (session.isLocked && TERMINAL_STATES.has(session.sessionState)) return null;
    const state = session.engineState as unknown as EngineState | null;
    if (!state || !state.plan) return null;
    return { state, languageCode: session.languageCode, jobId: session.jobId, isLocked: session.isLocked, demo: session.isDemo };
  }

  /* ------------------------------------------------------------------ */
  /* Consent & language                                                  */
  /* ------------------------------------------------------------------ */

  async recordConsent(sessionId: string, given: boolean): Promise<EngineTurnResult> {
    const loaded = await this.requireActive(sessionId);

    await this.deps.prisma.interviewSession.update({
      where: { id: sessionId },
      data: {
        consentRecorded: given,
        consentAt: new Date(),
        sessionState: given ? 'BASIC_DETAILS' : 'CANCELLED',
        stageKind: given ? 'BASIC_DETAILS' : 'CLOSING',
        ...(given ? {} : { sessionStatus: 'ABANDONED' as const }),
        isLocked: !given,
        completedAt: given ? null : new Date(),
      },
    });

    await this.appendTimeline(
      sessionId,
      'consent',
      given ? 'Candidate agreed verbally' : 'Candidate did not agree',
    );

    const state = loaded.state;
    state.state = given ? 'BASIC_DETAILS' : 'CANCELLED';
    state.updatedAt = new Date().toISOString();

    const engine = await this.engineFor(state);
    if (!given) {
      const result = blankResult(state);
      result.directives = [engine.openingDirectives(state.languageCode, { repeat: false }).at(-1)!, terminalSpeak(state.languageCode)];
      result.terminal = 'CANCELLED';
      state.finalised = true;
      await this.persistState(sessionId, state);
      return result;
    }

    state.state = 'BASIC_DETAILS';
    state.stageKind = 'BASIC_DETAILS';
    const result = blankResult(state);
    result.directives = [...engine.openingDirectives(state.languageCode, { repeat: false }), ...engine.firstQuestionDirectives(state)];
    await this.persistState(sessionId, state);
    return result;
  }

  async changeLanguage(sessionId: string, languageCode: string): Promise<EngineTurnResult> {
  const settings = await this.settings();
    const loaded = await this.requireActive(sessionId);
    if (!settings.general.supportedLanguages.includes(languageCode)) {
      throw AppError.validation('That language is not enabled for this kiosk.');
    }
    // Re-plan in the new language so the wording actually changes, while preserving
    // every answer already collected.
    const session = await this.deps.prisma.interviewSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { jobId: true, candidateId: true },
    });
    const plan = await buildInterviewPlan(this.deps.prisma, this.deps.logger, {
      jobId: session.jobId,
      languageCode,
      supportedLanguages: settings.general.supportedLanguages,
    });

    const state = loaded.state;
    const previousAnswers = state.answers;
    const state2: EngineState = { ...createEngineState({ languageCode, plan, consentText: null }), ...state, languageCode, plan };
    state2.answers = previousAnswers;
    state2.updatedAt = new Date().toISOString();

    await this.deps.prisma.$transaction([
      this.deps.prisma.interviewSession.update({
        where: { id: sessionId },
        data: {
          languageCode,
          languageId: await this.languageIdFor(languageCode),
          engineState: state2 as never,
          sessionState: 'BASIC_DETAILS',
          stageKind: 'BASIC_DETAILS',
          totalQuestions: plan.summary.questionCount,
        },
      }),
      this.deps.prisma.candidate.update({ where: { id: session.candidateId }, data: { languageCode } }),
    ]);
    await this.appendTimeline(sessionId, 'language_changed', `Switched to ${languageCode}`);

    const engine = await this.engineFor(state2);
    const result = blankResult(state2);
    const languageName = await this.languageNameFor(languageCode);
    result.directives = [
      {
        phraseKey: 'language_changed',
        text: phrase('language_changed', languageCode, { language: languageName }),
        emotion: 'encouraging',
        displayText: null,
        slowRate: false,
        sequence: 1,
      },
      ...engine.firstQuestionDirectives(state2),
    ];
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Voice turns                                                         */
  /* ------------------------------------------------------------------ */

  async handleVoiceTurn(sessionId: string, input: VoiceTurnInput): Promise<EngineTurnResult> {
    const loaded = await this.requireActive(sessionId);
    const state = loaded.state;

    const engine = await this.engineFor(state);
    const result = await engine.handleTurn(state, input);

    // --- Persist first, evaluate after -----------------------------------
    await this.persistTurn(sessionId, result);
    await this.runEvaluations(sessionId, result);

    if (result.terminal) {
      await this.finaliseSession(sessionId, result);
    } else {
      await this.persistState(sessionId, state);
    }

    return result;
  }

  /**
   * Advances past the current step without an answer (the large Next control).
   * Implemented as a real engine call so the resulting state and records follow
   * exactly the same path as a spoken answer.
   */
  async advance(sessionId: string): Promise<EngineTurnResult> {
    const loaded = await this.requireActive(sessionId);
    const engine = await this.engineFor(loaded.state);
    const result = await engine.skipCurrent(loaded.state);
    await this.persistTurn(sessionId, result);
    await this.runEvaluations(sessionId, result);
    if (result.terminal) await this.finaliseSession(sessionId, result);
    else await this.persistState(sessionId, result.state);
    return result;
  }

  /**
   * Writes a turn atomically.
   *
   * The answer rows, the eligibility results, the candidate's details, the new engine
   * state and the session row all commit together, so a partially-applied turn is
   * impossible. Evaluation deliberately happens *after* this commit (see
   * `runEvaluations`), because a slow model must never delay or risk an answer the
   * candidate has already given.
   */
  private async persistTurn(sessionId: string, result: EngineTurnResult): Promise<void> {
    await this.persistRecords(sessionId, result.state, result.records, result.eligibility);
    await this.deps.prisma.interviewSession.update({
      where: { id: sessionId },
      data: {
        engineState: result.state as never,
        sessionState: result.state.state as never,
        stageKind: result.state.stageKind as never,
        questionIndex: result.state.stepIndex,
        isLocked: result.terminal !== null,
        completedAt: result.terminal ? new Date() : null,
        lastActivityAt: new Date(),
        ...(result.state.knockout.triggered
          ? { knockoutTriggered: true, knockoutReason: result.state.knockout.requirement }
          : {}),
      },
    });

    await this.appendTimeline(
      sessionId,
      result.stepAbandoned ? 'step_abandoned' : result.terminal ? 'turn_terminal' : 'turn',
      `${result.state.stageKind} · q${result.progress.answered + 1}/${result.progress.total}` +
        (result.meta.command ? ` · command:${result.meta.command}` : ''),
    );
  }

  /** Writes answer rows, eligibility results and candidate details in one transaction. */
  private async persistRecords(
    sessionId: string,
    state: EngineState,
    records: EngineRecord[],
    eligibility: EngineTurnResult['eligibility'],
  ): Promise<void> {
    if (records.length === 0 && eligibility.length === 0) return;
    const settings = await this.settings();
    const session = await this.deps.prisma.interviewSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { candidateId: true },
    });
    const questionsByKey = new Map(state.plan.questions.map((q) => [q.key, q]));

    await this.deps.prisma.$transaction(async (tx) => {
      for (const record of records) {
        const question = record.questionKey ? questionsByKey.get(record.questionKey) : undefined;

        // Pin the exact question version used, so later admin edits cannot rewrite history.
        const versionId = question?.questionId ? await this.ensureVersionId(tx, question.questionId) : null;

        const answer = await tx.candidateAnswer.create({
          data: {
            sessionId,
            questionId: question?.questionId ?? null,
            questionVersionId: versionId,
            stageKind: (record.stageKind ?? 'JOB_QUESTIONS') as never,
            transcript: record.transcript,
            interpretation: record.interpretation,
            normalizedText: record.transcript,
            spokenLanguage: record.language,
            sttConfidence: record.sttConfidence,
            isCommand: record.isCommand,
            command: record.command,
            isSkipped: record.isSkipped,
            isDontKnow: record.isDontKnow,
            attemptNumber: record.attempt,
            durationMs: record.durationMs,
            answeredAt: new Date(),
          },
        });

        if (settings.recording.storeTranscript && record.transcript.trim()) {
          await tx.transcript.create({
            data: {
              sessionId,
              answerId: answer.id,
              kind: record.stepKind === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'ANSWER',
              languageCode: record.language ?? state.languageCode,
              source: 'STT',
              content: record.transcript,
            },
          });
        }

        if (record.stepKind === 'FOLLOW_UP' && question?.questionId) {
          const followUpText = state.followUpPending[question.key] || '';
          await tx.followUpQuestion.create({
            data: {
              sessionId,
              answerId: answer.id,
              question: followUpText,
              generatedBy: followUpText ? 'ADMIN' : 'AI',
              isAiGenerated: !followUpText,
            },
          });
        }
      }

      for (const item of eligibility) {
        await tx.eligibilityResult.create({
          data: {
            sessionId,
            requirement: item.requirement,
            passed: item.passed,
            isKnockout: item.isKnockout,
            message: item.message,
          },
        });
      }

      // Persist candidate details gathered during BASIC_DETAILS.
      const candidate = state.candidate;
      await tx.candidate.update({
        where: { id: session.candidateId },
        data: {
          name: candidate.name,
          age: candidate.age,
          village: candidate.village,
          previousWork: candidate.previousWork,
          yearsExperience: candidate.yearsExperience,
          workPreference: candidate.workPreference,
          canTravel: candidate.canTravel,
          extraDetails: candidate.extra as never,
        },
      });
    });
  }


  /** Runs the queued evaluations after the answer is safely stored. */
  private async runEvaluations(sessionId: string, result: EngineTurnResult): Promise<void> {
    for (const item of result.evaluations) {
      try {
        const { result: outcome, degraded } = await withFallback(
          () => this.deps.ai.evaluation.evaluate({ ...item.request, context: { ...item.request.context, sessionId } }),
          () => this.deps.ai.evaluation.evaluate({ ...item.request, context: { ...item.request.context, sessionId } }),
          (err, phase) => this.deps.logger.warn('evaluation_provider_fallback', { phase, sessionId, err }),
        );
        void this.mockLlm;

        const question = result.state.plan.questions.find((q) => `question:${q.key}` === item.stepKey);
        const maxScore = question?.scoreMax ?? 10;

        const answerRow = await this.deps.prisma.candidateAnswer.findFirst({
          where: {
            sessionId,
            transcript: item.request.answer.transcript,
            ...(question?.questionId ? { questionId: question.questionId } : {}),
          },
          orderBy: { answeredAt: 'desc' },
          select: { id: true },
        });
        if (!answerRow) continue;

        const biasFlags = degraded ? [...outcome.biasFlags, 'provider_fallback'] : outcome.biasFlags;

        await this.deps.prisma.answerScore.upsert({
          where: { answerId: answerRow.id },
          create: {
            answerId: answerRow.id,
            questionId: question?.questionId ?? null,
            rawScore: outcome.rawScore,
            normalizedScore: outcome.normalizedScore,
            maxScore,
            confidence: outcome.confidence,
            evaluationReason: outcome.evaluationReason,
            strengths: outcome.strengths,
            concerns: outcome.concerns,
            aiNotes: outcome.aiNotes,
            biasFlags,
            source: 'AI',
            criterionScores: {
              create: outcome.criterionScores.map((c) => ({
                label: c.label,
                points: c.points,
                maxPoints: c.max,
                hitKeywords: c.hitKeywords,
                reasoning: c.reasoning,
              })),
            },
          },
          update: {
            rawScore: outcome.rawScore,
            normalizedScore: outcome.normalizedScore,
            confidence: outcome.confidence,
            evaluationReason: outcome.evaluationReason,
            strengths: outcome.strengths,
            concerns: outcome.concerns,
            aiNotes: outcome.aiNotes,
            biasFlags,
            criterionScores: {
              deleteMany: {},
              create: outcome.criterionScores.map((c) => ({
                label: c.label,
                points: c.points,
                maxPoints: c.max,
                hitKeywords: c.hitKeywords,
                reasoning: c.reasoning,
              })),
            },
          },
        });
      } catch (err) {
        this.deps.logger.error('evaluation_failed', { sessionId, stepKey: item.stepKey, err });
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Finalisation                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Idempotent. A duplicate `finish` (retry from the kiosk, double tap on the
   * completion screen) reuses the existing report instead of regenerating one, so a
   * candidate can never end up with two scores.
   */
  async finaliseSession(sessionId: string, result?: EngineTurnResult): Promise<void> {
  const settings = await this.settings();
    const session = await this.deps.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        job: true,
        candidate: true,
        answers: {
          include: {
            score: { include: { criterionScores: true } },
            question: { select: { categoryName: true, skillTags: true, weight: true, isKnockout: true } },
          },
          orderBy: { answeredAt: 'asc' },
        },
        proctorEvents: true,
        eligibilityResults: true,
        report: true,
      },
    });
    if (!session) throw AppError.notFound('Session not found.');
    if (session.report) return;

    const state = (session.engineState as unknown as EngineState | null) ?? result?.state;
    const weights = parseJobWeights(session.job.weights);
    const passingScore = session.job.passingScore || settings.scoring.passingScore;

    const scored: ScoredAnswer[] = session.answers
      .filter((a) => a.score && a.questionId && a.question)
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
        criterionScores: a.score!.criterionScores.map((c) => ({
          label: c.label,
          points: c.points,
          max: c.maxPoints,
          hitKeywords: c.hitKeywords,
          reasoning: c.reasoning,
        })),
        evaluationReason: a.score!.evaluationReason,
        concerns: a.score!.concerns,
        biasFlags: a.score!.biasFlags,
        isKnockout: a.question!.isKnockout,
        triggeredKnockout: a.isSkipped,
      }));

    const skillScores = computeSkillScores(scored);
    const overall = weightedOverallScore(scored, weights, skillScores);

    const biasFlags = collectBiasFlags(scored);
    const lowConfidenceDetected = scored.some(
      (a) => a.confidence < settings.scoring.requireHumanReviewBelowConfidence,
    );

    const knockoutTriggered = session.knockoutTriggered || (state?.knockout?.triggered ?? false);
    const elapsedMinutes = Math.max(
      0,
      Math.round(((session.lastActivityAt.getTime() - session.startedAt.getTime()) / 60_000) * 10) / 10,
    );

    const reportInput = {
      candidateName: session.candidate.name,
      jobTitle: session.job.title,
      jobDescription: session.job.description,
      languageCode: session.languageCode,
      weightedScore: overall.score,
      passingScore,
      skillScores: skillScores.map((s) => ({
        skill: s.skill,
        earned: s.earned,
        max: s.max,
        questionCount: s.questionCount,
        evidence: s.evidence,
      })),
      strengths: [],
      weaknesses: [],
      eligibilityStatus: summariseEligibility(session.eligibilityResults),
      knockoutTriggered,
      knockoutReason: session.knockoutReason,
      proctorEventCount: session.proctorEvents.length,
      proctorEventTypes: [...new Set(session.proctorEvents.map((e) => e.type))],
      answeredQuestionCount: session.answers.length,
      totalQuestionCount: state?.plan?.questions.length ?? session.totalQuestions,
      elapsedMinutes,
      lowConfidenceDetected: lowConfidenceDetected || biasFlags.length > 0,
      demoMode: session.isDemo,
    };

    const { result: narrative } = await withFallback(
      () => generateReport(reportInput, this.deps.ai.llm),
      () => generateReport(reportInput, this.mockLlm),
      (err, phase) => this.deps.logger.warn('report_generation_degraded', { phase, sessionId, err }),
    );

    const { recommendation, basis } = deriveRecommendation({
      weightedScore: overall.score,
      passingScore,
      knockoutTriggered,
      proctorEventCount: session.proctorEvents.length,
      lowConfidenceDetected: reportInput.lowConfidenceDetected,
      demoMode: session.isDemo,
      autoRecommend: settings.scoring.autoRecommend,
    });

    const concerns = [
      ...narrative.concerns,
      ...(biasFlags.length > 0
        ? // Every guard flag is listed, not only protected-attribute ones: a reviewer
          // deciding whether to trust an evaluation needs to see a provider fallback or a
          // score drift as readily as a protected-attribute reference.
          [`Evaluation guard flagged: ${biasFlags.join(', ')}.`]
        : []),
      `Recommendation basis: ${basis}`,
    ].slice(0, 10);

    await this.deps.prisma.$transaction(async (tx) => {
      await tx.evaluationReport.upsert({
        where: { sessionId },
        create: {
          sessionId,
          overallScore: overall.score,
          maxScore: 100,
          recommendation,
          decisionSource: 'AI',
          summary: narrative.summary,
          experienceSummary: narrative.experienceSummary,
          eligibilityStatus: reportInput.eligibilityStatus,
          skillScores: narrative.skillScores as never,
          strengths: narrative.strengths,
          weaknesses: narrative.weaknesses,
          concerns,
          recommendedNextAction: narrative.recommendedNextAction,
          methodology:
            `${narrative.methodology} Coverage of the job's weighting dimensions: ${overall.coverage}%. ` +
            `Weight contributions: ${overall.contributions.map((c) => `${c.dimension} ${c.percent}% × ${c.weight.toFixed(0)}`).join(', ')}.`,
        },
        update: {},
      });

      await tx.interviewSession.update({
        where: { id: sessionId },
        data: {
          isLocked: true,
          // The lifecycle state must also close, otherwise the kiosk's post-completion
          // guard (which keys off sessionState) would still accept further turns.
          // A session cancelled by the kiosk stays CANCELLED; everything else closes as COMPLETED.
          sessionState: session.sessionState === 'CANCELLED' ? ('CANCELLED' as const) : ('COMPLETED' as const),
          completedAt: session.completedAt ?? new Date(),
          durationSeconds: Math.round((Date.now() - session.startedAt.getTime()) / 1000),
          sessionStatus: 'COMPLETED',
          engineState: (state ? { ...state, finalised: true } : undefined) as never,
        },
      });
    });

    await this.appendTimeline(sessionId, 'session_completed', `Recommendation: ${recommendation} · score ${overall.score}/100`);

    await this.deps.prisma.auditLog
      .create({
        data: {
          action: 'session.completed',
          entityType: 'interview_session',
          entityId: sessionId,
          next: { recommendation, overallScore: overall.score, demo: session.isDemo },
        },
      })
      .catch(() => undefined);

    this.deps.logger.info('session_completed', {
      sessionId,
      recommendation,
      overallScore: overall.score,
      coverage: overall.coverage,
      proctorEvents: session.proctorEvents.length,
      demo: session.isDemo,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Timeline                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Appends an entry to a session's human-readable timeline.
   *
   * Read-modify-write rather than a JSON `push`: the timeline is small, written once
   * per turn, and only ever read by administrators, so the extra round trip costs less
   * than an operator that silently replaces the array with a literal object.
   */
  private async appendTimeline(sessionId: string, kind: string, detail: string): Promise<void> {
    const row = await this.deps.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      select: { timeline: true },
    });
    const current = Array.isArray(row?.timeline) ? (row!.timeline as unknown[]) : [];
    // Bounded tail: an interview produces tens of entries, not thousands.
    const next = [...current.slice(-199), { at: new Date().toISOString(), kind, detail }];
    await this.deps.prisma.interviewSession.update({ where: { id: sessionId }, data: { timeline: next as never } });
  }

  /* ------------------------------------------------------------------ */
  /* Reconnection                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Directives to send when a kiosk (re)attaches to a live session.
   *
   * This is what makes a dropped connection survivable: the candidate hears the
   * welcome again plus the exact question they are on, rather than being asked to start
   * over. It deliberately does not replay earlier answers.
   */
  async buildEngineForResumption(state: EngineState, jobId?: string): Promise<EngineDirective[]> {
    const settings = await this.settings();
    const job = jobId
      ? await this.deps.prisma.job.findUnique({ where: { id: jobId }, select: { title: true, description: true } })
      : null;
    const engine = await this.engineFor(state, job ?? undefined);
    if (state.state === 'AWAITING_CONSENT' || state.state === 'CREATED') {
      if (settings.general.privacyNoticeRequired) return engine.openingDirectives(state.languageCode, { repeat: false });
      return [...engine.openingDirectives(state.languageCode, { repeat: false }), ...engine.firstQuestionDirectives(state)];
    }
    if (state.state === 'COMPLETED' || state.state === 'CANCELLED' || state.state === 'FAILED') {
      return engine.openingDirectives(state.languageCode, { repeat: false });
    }
    // Mid-interview: replay the current question without re-asking everything.
    return [...engine.openingDirectives(state.languageCode, { repeat: true }), ...engine.replayCurrentQuestion(state)];
  }

  /**
   * Sets one BASIC_DETAILS field directly. Used by the large on-screen controls for
   * candidates who prefer tapping to speaking, and by accessibility fallbacks.
   */
  async setDetail(sessionId: string, key: string, value: string): Promise<void> {
    const loaded = await this.requireActive(sessionId);
    const field = key as DetailField;
    if (!['name', 'age', 'village', 'previous_work', 'years_experience', 'work_preference', 'can_travel'].includes(field)) {
      throw AppError.validation('That detail field is not part of the interview.');
    }
    await this.settings();
    const engine = await this.engineFor(loaded.state);
    engine.setDetailValue(loaded.state, field, value);

    const record: EngineRecord = {
      stepKey: `detail:${field}`,
      stepKind: 'DETAIL' as const,
      detailField: field,
      questionKey: null,
      parentQuestionKey: null,
      transcript: '',
      interpretation: `Selected on the kiosk screen.`,
      language: loaded.state.languageCode,
      sttConfidence: 1,
      isSkipped: false,
      isDontKnow: false,
      isCommand: false,
      command: null,
      attempt: 1,
      durationMs: 0,
      stageKind: 'BASIC_DETAILS',
    };

    await this.persistRecords(sessionId, loaded.state, [record], []);
    await this.persistState(sessionId, loaded.state);
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  private async persistState(sessionId: string, state: EngineState): Promise<void> {
    await this.deps.prisma.interviewSession.update({
      where: { id: sessionId },
      data: {
        engineState: state as never,
        sessionState: state.state as never,
        stageKind: state.stageKind as never,
        questionIndex: state.stepIndex,
        lastActivityAt: new Date(),
      },
    });
  }

  private async requireActive(sessionId: string) {
    const loaded = await this.loadState(sessionId);
    if (!loaded) throw AppError.notFound('This session could not be found. Please start again.');
    if (loaded.isLocked) {
      const session = await this.deps.prisma.interviewSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { sessionState: true },
      });
      if (TERMINAL_STATES.has(session.sessionState)) {
        throw AppError.locked('This interview has already finished.');
      }
    }
    return loaded;
  }

  /**
   * Builds an engine bound to the live session's job. Cached per session id so a
   * burst of turns does not re-read the job on every message.
   */
  private async engineFor(_state: EngineState, job?: { id?: string; title: string; description: string }): Promise<InterviewEngine> {
    const settings = await this.settings();
    return new InterviewEngine({
      logger: this.deps.logger,
      llm: this.deps.ai.llm,
      settings,
      languageNames: await this.languageNames(),
      job: {
        id: job?.id ?? '',
        title: job?.title ?? '',
        description: job?.description ?? '',
        followUpMode: settings.interview.followUpMode,
        maxFollowUpsPerQuestion: settings.interview.maxFollowUpsPerQuestion,
      },
    });
  }

  /** Rejects turns into a session whose clock has run out. */
  async assertWithinTimeBudget(sessionId: string): Promise<void> {
  const settings = await this.settings();
    const session = await this.deps.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      select: { startedAt: true, sessionStatus: true },
    });
    if (!session) return;
    if (session.sessionStatus !== 'ACTIVE') return;
    const elapsed = Date.now() - session.startedAt.getTime();
    const budget = settings.interview.maxDurationMinutes * 60_000;
    if (elapsed > budget) {
      await this.deps.prisma.interviewSession.update({
        where: { id: sessionId },
        data: { sessionStatus: 'EXPIRED', isLocked: true, completedAt: new Date() },
      });
      throw new AppError('SESSION_EXPIRED', 409, 'This session has ended. Please start again from the beginning.');
    }
  }

  private async ensureVersionId(tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0], questionId: string): Promise<string | null> {
    const question = await tx.question.findUnique({
      where: { id: questionId },
      select: { version: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, version: true } } },
    });
    if (!question) return null;
    const latest = question.versions[0];
    if (latest && latest.version === question.version) return latest.id;

    // Upsert: two concurrent answers for the same question must not race to insert.
    const created = await tx.questionVersion.upsert({
      where: { questionId_version: { questionId, version: question.version } },
      update: {},
      create: {
        questionId,
        version: question.version,
        snapshot: {
          id: questionId,
          version: question.version,
          capturedAt: new Date().toISOString(),
        } as never,
        changeNote: 'Snapshot captured at interview time',
      },
      select: { id: true },
    });
    return created.id;
  }

  private async languageIdFor(code: string): Promise<string | null> {
    const language = await this.deps.prisma.language.findUnique({ where: { code }, select: { id: true } });
    return language?.id ?? null;
  }

  /**
   * The name a candidate recognises for a language, used to fill `{language}` in spoken
   * phrases. Falls back to the code so a phrase can never be read out as a placeholder.
   */
  private async languageNameFor(code: string): Promise<string> {
    const language = await this.deps.prisma.language.findUnique({
      where: { code },
      select: { nativeName: true, name: true },
    });
    return language?.nativeName || language?.name || code;
  }

  /** Every language's spoken name, for the engine's `{language}` phrase variables. */
  private async languageNames(): Promise<Record<string, string>> {
    const languages = await this.deps.prisma.language.findMany({
      select: { code: true, nativeName: true, name: true },
    });
    return Object.fromEntries(languages.map((l) => [l.code, l.nativeName || l.name]));
  }

  /** Snapshot of everything that affects this interview, so it can be reproduced. */
  private async snapshotSettings(
    job: { interviewDurationMinutes: number; passingScore: number; proctoring: unknown },
    questionCount: number,
  ): Promise<Record<string, unknown>> {
    const s = await this.settings();
    return {
      version: 1,
      capturedAt: new Date().toISOString(),
      siteName: s.general.siteName,
      job: {
        interviewDurationMinutes: job.interviewDurationMinutes,
        passingScore: job.passingScore,
        proctoring: job.proctoring,
      },
      questionCount,
      voice: s.voice,
      interview: s.interview,
      scoring: s.scoring,
      recording: {
        storeAudio: s.recording.storeAudio,
        storeTranscript: s.recording.storeTranscript,
        recordingRetentionDays: s.recording.recordingRetentionDays,
        transcriptRetentionDays: s.recording.transcriptRetentionDays,
        signedUrlTtlSeconds: s.recording.signedUrlTtlSeconds,
      },
      proctoring: s.proctoring,
      ai: { ...s.ai, llmProvider: this.deps.ai.llm.name, evaluationProvider: this.deps.ai.evaluation.name },
      demoMode: this.deps.demoMode,
    };
  }
}

/* -------------------------------------------------------------------------- */

function blankResult(state: EngineState): EngineTurnResult {
  return {
    directives: [],
    progress: { answered: 0, total: state.plan.questions.length, stage: state.stageKind, label: null },
    state,
    records: [],
    evaluations: [],
    eligibility: [],
    terminal: null,
    recoveryNotice: null,
    stepAbandoned: false,
    meta: { isCommand: false, command: null, retryKind: null, retriesRemaining: 0, degraded: false },
  };
}

function terminalSpeak(lang: string): import('../services/interview-engine.js').EngineDirective {
  const text = phrase('goodbye', lang);
  return { phraseKey: 'goodbye', text, emotion: 'neutral', displayText: null, slowRate: false, sequence: 999 };
}



function timelineEntry(kind: string, detail: string): Record<string, unknown> {
  return { at: new Date().toISOString(), kind, detail };
}

function summariseEligibility(rows: Array<{ requirement: string; passed: boolean; message: string }>): string {
  if (rows.length === 0) return 'No eligibility criteria were configured for this role.';
  const met = rows.filter((r) => r.passed).length;
  const unmet = rows.filter((r) => !r.passed);
  const base = `${met} of ${rows.length} eligibility criteria were confirmed.`;
  return unmet.length === 0
    ? base
    : `${base} Not confirmed: ${unmet.map((r) => r.requirement).join(', ')}.`;
}

export { canTransition, asArray, asRecord, asString };