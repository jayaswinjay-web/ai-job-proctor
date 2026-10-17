import {
  analyseTurn,
  decideFollowUp,
  detectVoiceCommand,
  extractDetail,
  generateAcknowledgement,
  generateAiFollowUp,
  MockLlmProvider,
  withFallback,
  type DetailField,
  type EvaluationRequest,
  type FollowUpDecision,
  type LlmProvider,
  normaliseDigits,
  type TurnAnalysis,
} from '@proctor/ai';
import { hasPhrase, phrase, type PhraseKey, type SystemSettings } from '@proctor/types';
import type { Logger } from '@proctor/database';
import {
  canTransition,
  nextStep,
  retryAllowance,
  stageForStep,
  stateForStep,
  stepKey,
  type EngineState,
  type PlanStep,
  type PlannedQuestion,
} from './interview-state.js';

/**
 * Interview engine.
 *
 * The engine is a pure state machine: given (persisted state + one voice turn) it
 * returns the next directives, the next state, and a list of *records to persist*.
 * It performs no database I/O. The session service writes those records and then
 * runs the returned evaluations.
 *
 * This split matters for three reasons:
 *   * every turn is unit-testable without a database;
 *   * a crash between "answer understood" and "answer stored" cannot lose data,
 *     because the caller persists records before acting on them;
 *   * evaluation latency never blocks the next question being spoken.
 */

export type DirectiveEmotion = 'neutral' | 'encouraging' | 'listening' | 'gentle_retry';

/** One spoken/displayed unit. `phraseKey` is present when the copy is curated. */
export interface EngineDirective {
  phraseKey?: PhraseKey;
  text: string;
  emotion: DirectiveEmotion;
  /** Caption text, or null to hide captions for this directive. */
  displayText: string | null;
  /** Client should play this at a slower rate. */
  slowRate: boolean;
  sequence: number;
}

/** A turn result the caller must persist. */
export interface EngineRecord {
  stepKey: string;
  stepKind: 'DETAIL' | 'ELIGIBILITY' | 'QUESTION' | 'FOLLOW_UP';
  detailField: string | null;
  questionKey: string | null;
  /** For FOLLOW_UP records, the key of the question that spawned it. */
  parentQuestionKey: string | null;
  transcript: string;
  interpretation: string;
  language: string | null;
  sttConfidence: number;
  isSkipped: boolean;
  isDontKnow: boolean;
  isCommand: boolean;
  command: string | null;
  attempt: number;
  durationMs: number;
  stageKind: string;
}

export interface EngineEvaluationRequest {
  stepKey: string;
  request: EvaluationRequest;
}

export interface EngineTurnResult {
  directives: EngineDirective[];
  progress: { answered: number; total: number; stage: string; label: string | null };
  state: EngineState;
  records: EngineRecord[];
  evaluations: EngineEvaluationRequest[];
  eligibility: Array<{ key: string; requirement: string; passed: boolean; isKnockout: boolean; message: string }>;
  terminal: 'COMPLETED' | 'FAILED' | 'CANCELLED' | null;
  /** Non-null when the candidate should be told something went wrong. */
  recoveryNotice: string | null;
  /** Set when retries ran out and the step was recorded as unanswered. */
  stepAbandoned: boolean;
  meta: {
    isCommand: boolean;
    command: string | null;
    retryKind: 'UNINTELLIGIBLE' | 'CONFIDENCE' | null;
    retriesRemaining: number;
    degraded: boolean;
  };
}

export interface EngineDeps {
  logger: Logger;
  llm: LlmProvider;
  settings: SystemSettings;
  /**
   * Spoken name per language code, used to fill `{language}` in phrases.
   *
   * The engine has no database access, so the names are resolved by the caller. A code
   * with no entry falls back to the code itself rather than leaving a `{language}`
   * placeholder in something a candidate will hear.
   */
  languageNames?: Record<string, string>;
  job: {
    id: string;
    title: string;
    description: string;
    followUpMode: 'DISABLED' | 'LIMITED' | 'ALLOWED';
    maxFollowUpsPerQuestion: number;
  };
}

export interface VoiceTurnInput {
  transcript: string;
  spokenLanguage: string | null;
  confidence: number;
  durationMs: number;
}

const RETRY_PHRASES: PhraseKey[] = ['will_repeat', 'did_not_understand', 'simplifying'];

export class InterviewEngine {
  private sequence = 0;
  private readonly mockLlm: MockLlmProvider;

  constructor(private readonly deps: EngineDeps) {
    this.mockLlm = new MockLlmProvider({
      supportedLanguages: deps.settings.general.supportedLanguages,
      fallbackLanguage: deps.settings.general.fallbackLanguage,
      latencyMs: 0,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Opening                                                             */
  /* ------------------------------------------------------------------ */

  /** Welcome + consent. Replayed verbatim on reconnect when `repeat` is set. */
  openingDirectives(lang: string, options: { repeat?: boolean } = {}): EngineDirective[] {
    if (options.repeat) return [this.speak('welcome', lang, 'neutral')];
    const out = [this.speak('welcome', lang, 'neutral')];
    if (this.deps.settings.general.privacyNoticeRequired) {
      out.push(this.speak('consent_notice', lang, 'neutral'));
      out.push(this.speak('consent_ask_confirm', lang, 'neutral'));
    }
    return out;
  }

  /** Directives for the very first question once consent and language are settled. */
  firstQuestionDirectives(state: EngineState): EngineDirective[] {
    const lang = state.languageCode;
    const step = nextStep(state);
    const out: EngineDirective[] = [];
    if (state.languageCode !== this.deps.settings.general.defaultLanguage) {
      out.push(this.speak('language_confirmed', lang, 'encouraging'));
    }
    const announce = step.kind === 'QUESTION' ? this.announceStage(state, step.question.key) : null;
    if (announce) out.push(announce);
    out.push(this.askDirective(step, lang));
    out.push(this.speak('listening_prompt', lang, 'listening'));
    state.stepIndex = 1;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Turn                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Records the current step as unanswered and moves on.
   *
   * Backs the large on-screen Next control. It goes through the same abandon path
   * as an exhausted retry budget, so a skipped question is stored identically to a
   * question the candidate could not answer — no penalty framing, no fake transcript.
   */
  async skipCurrent(state: EngineState): Promise<EngineTurnResult> {
    const step = nextStep(state);
    const result = this.blankResult(state);
    return this.abandon(state, step, stepKey(step), result);
  }

  async handleTurn(state: EngineState, input: VoiceTurnInput): Promise<EngineTurnResult> {
    const lang = state.languageCode;
    const step = nextStep(state);
    const key = stepKey(step);
    const base = this.blankResult(state);

    /* 1 — control commands ------------------------------------------------ */
    const detection = detectVoiceCommand(input.transcript, input.spokenLanguage ?? lang);
    if (detection.command) {
      const commandResult = await this.handleCommand(state, step, key, detection.command, input);
      if (commandResult) return commandResult;
    }

    const text = (detection.command ? detection.remainder : input.transcript).trim();
    if (!text) {
      return this.retry(state, step, key, base, 'UNINTELLIGIBLE');
    }

    /* 2 — understand ------------------------------------------------------ */
    const analysis = await this.analyse(text, input, this.questionTextFor(step), lang);
    if (analysis.kind === 'EMPTY') {
      return this.retry(state, step, key, base, 'UNINTELLIGIBLE');
    }
    if (analysis.injectionPatterns.length > 0) {
      this.deps.logger.warn('candidate_injection_attempt_neutralised', {
        patterns: analysis.injectionPatterns,
        severity: analysis.detectionDetail,
      });
    }
    if (analysis.kind === 'UNCLEAR') {
      return this.retry(state, step, key, base, 'CONFIDENCE');
    }

    /* 3 — commit ---------------------------------------------------------- */
    return this.commit(state, step, key, analysis, input, detection.command, base);
  }

  /* ------------------------------------------------------------------ */
  /* Commands                                                            */
  /* ------------------------------------------------------------------ */

  private async handleCommand(
    state: EngineState,
    step: PlanStep,
    key: string,
    command: string,
    input: VoiceTurnInput,
  ): Promise<EngineTurnResult | null> {
    const lang = state.languageCode;
    const allow = retryAllowance(step, this.deps.settings.interview.retryLimit);
    const used = state.retries[key] ?? 0;
    const result = this.blankResult(state);
    result.meta.isCommand = true;
    result.meta.command = command;

    switch (command) {
      case 'REPEAT': {
        result.directives.push(this.speak('will_repeat', lang, 'gentle_retry'));
        result.directives.push(this.askDirective(step, lang));
        break;
      }
      case 'SPEAK_SLOWLY': {
        result.directives.push(this.askDirective(step, lang, true));
        break;
      }
      case 'DONT_UNDERSTAND': {
        if (used >= allow) return this.abandon(state, step, key, result);
        state.simplifyCount += 1;
        const simpler = this.simplerText(step, used + 1);
        if (simpler) {
          result.directives.push({
            text: simpler,
            emotion: 'encouraging',
            displayText: simpler,
            slowRate: used >= 1,
            sequence: this.next(),
          });
        } else {
          result.directives.push(this.speak(RETRY_PHRASES[0]!, lang, 'gentle_retry'));
          result.directives.push(this.askDirective(step, lang, used >= 1));
        }
        state.retries[key] = used + 1;
        result.meta.retryKind = 'UNINTELLIGIBLE';
        result.meta.retriesRemaining = Math.max(0, allow - used - 1);
        result.directives.push(this.speak('listening_prompt', lang, 'listening'));
        break;
      }
      case 'DONT_KNOW': {
        const analysis: TurnAnalysis = {
          kind: 'DONT_KNOW',
          transcript: input.transcript,
          interpretation: 'Candidate said they do not know.',
          language: input.spokenLanguage ?? lang,
          confidence: Math.max(0.6, input.confidence),
          isComplete: true,
          injectionPatterns: [],
          detectionDetail: 'voice_command',
        };
        return this.commit(state, step, key, analysis, input, command, this.blankResult(state), true);
      }
      case 'NEXT': {
        // Only honoured once the retry budget is spent, so it never discards a
        // recoverable answer.
        if (used >= allow) return this.abandon(state, step, key, result);
        state.retries[key] = used + 1;
        result.directives.push(this.speak('will_repeat', lang, 'gentle_retry'));
        result.directives.push(this.askDirective(step, lang));
        break;
      }
      case 'GO_BACK': {
        const previous = previousAnswerableStep(state, key);
        if (!previous) {
          result.directives.push(this.askDirective(step, lang));
          break;
        }
        const prevKey = stepKey(previous);
        delete state.retries[prevKey];
        result.directives.push(this.speak('will_repeat', lang, 'gentle_retry'));
        result.directives.push(this.askDirective(previous, lang));
        break;
      }
      case 'HELP': {
        result.directives.push(this.speak('help_available', lang, 'encouraging'));
        result.directives.push(this.askDirective(step, lang));
        break;
      }
      case 'STOP': {
        result.directives.push(this.speak('goodbye', lang, 'neutral'));
        result.terminal = 'CANCELLED';
        state.state = 'CANCELLED';
        state.finalised = true;
        return result;
      }
      case 'START_AGAIN': {
        state.answers = {};
        state.followUpAnswers = {};
        state.followUpPending = {};
        state.followUpCounts = {};
        state.retries = {};
        state.eligibility = {};
        state.spokenSteps = [];
        state.knockout = { triggered: false, message: null, requirement: null };
        state.stepIndex = 0;
        result.directives.push(this.speak('welcome', lang, 'neutral'));
        if (this.deps.settings.general.privacyNoticeRequired) {
          result.directives.push(this.speak('consent_notice', lang, 'neutral'));
          result.directives.push(this.speak('consent_ask_confirm', lang, 'encouraging'));
        }
        break;
      }
      default:
        return null;
    }

    state.updatedAt = new Date().toISOString();
    result.state = state;
    result.progress = this.progressFor(state);
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Commit                                                              */
  /* ------------------------------------------------------------------ */

  private async commit(
    state: EngineState,
    step: PlanStep,
    key: string,
    analysis: TurnAnalysis,
    input: VoiceTurnInput,
    command: string | null,
    result: EngineTurnResult,
    viaCommand = false,
  ): Promise<EngineTurnResult> {
    const lang = state.languageCode;
    const attempt = (state.retries[key] ?? 0) + 1;
    result.meta.isCommand = Boolean(command);
    result.meta.command = command ?? null;

    /* -- BASIC_DETAILS --------------------------------------------------- */
    if (step.kind === 'DETAIL') {
      const extraction = await this.extract(step.detail.key, input.transcript, result);
      let abandoned = false;
      if (!extraction.found) {
        const allow = retryAllowance(step, this.deps.settings.interview.retryLimit);
        if (attempt <= allow && !viaCommand) {
          state.retries[key] = attempt;
          result.meta.retryKind = 'CONFIDENCE';
          result.meta.retriesRemaining = Math.max(0, allow - attempt);
          result.stepAbandoned = false;
          result.directives.push(this.speak('did_not_understand', lang, 'gentle_retry'));
          result.directives.push(this.speak(step.detail.phraseKey, lang, 'neutral', attempt >= 2));
          result.directives.push(this.speak('listening_prompt', lang, 'listening'));
          state.updatedAt = new Date().toISOString();
          result.state = state;
          result.progress = this.progressFor(state);
          return result;
        }
        abandoned = true;
      } else {
        this.applyDetail(state, step.detail.key, extraction.value);
      }

      state.answers[key] = this.recorded(analysis, attempt, abandoned);
      result.stepAbandoned = abandoned;
      result.records.push({
        stepKey: key,
        stepKind: 'DETAIL',
        detailField: step.detail.key,
        questionKey: null,
        parentQuestionKey: null,
        transcript: analysis.transcript,
        interpretation: analysis.interpretation,
        language: analysis.language,
        sttConfidence: analysis.confidence,
        isSkipped: abandoned,
        isDontKnow: analysis.kind === 'DONT_KNOW',
        isCommand: false,
        command: null,
        attempt,
        durationMs: input.durationMs,
        stageKind: 'BASIC_DETAILS',
      });
      result.directives.push(
        abandoned ? this.speak('skip_recorded', lang, 'encouraging') : await this.acknowledge(state, analysis.kind),
      );
      return await this.advance(state, result, null);
    }

    /* -- ELIGIBILITY ----------------------------------------------------- */
    if (step.kind === 'ELIGIBILITY') {
      const verdict = classifyYesNo(input.transcript);
      const passed = verdict === null ? false : verdict;
      state.eligibility[step.check.key] = {
        passed,
        recorded: true,
        message: verdict === null ? 'Not confirmed' : passed ? 'Requirement met' : 'Requirement not met',
      };
      result.eligibility.push({
        key: step.check.key,
        requirement: step.check.requirement,
        passed,
        isKnockout: step.check.isKnockout,
        message: verdict === null ? 'Not confirmed' : passed ? 'Requirement met' : 'Requirement not met',
      });
      result.records.push({
        stepKey: key,
        stepKind: 'ELIGIBILITY',
        detailField: null,
        questionKey: null,
        parentQuestionKey: null,
        transcript: input.transcript,
        interpretation: analysis.interpretation,
        language: analysis.language,
        sttConfidence: analysis.confidence,
        isSkipped: verdict === null,
        isDontKnow: verdict === null,
        isCommand: false,
        command: null,
        attempt,
        durationMs: input.durationMs,
        stageKind: 'ELIGIBILITY_CHECK',
      });

      if (!passed && step.check.isKnockout) {
        state.knockout = {
          triggered: true,
          requirement: step.check.requirement,
          message: step.check.knockoutMessage,
        };
        result.directives.push({
          text: step.check.knockoutMessage ?? phrase('knockout_end', lang),
          emotion: 'neutral',
          displayText: null,
          slowRate: false,
          sequence: this.next(),
        });
        return await this.complete(state, result);
      }

      result.directives.push(
        passed
          ? await this.acknowledge(state, 'ANSWER')
          : this.speak('take_your_time', lang, 'encouraging'),
      );
      return await this.advance(state, result, null);
    }

    /* -- JOB QUESTION / FOLLOW_UP ---------------------------------------- */
    if (step.kind === 'COMPLETE') return this.complete(state, result);
    const question = step.question;
    const isFollowUp = step.kind === 'FOLLOW_UP';

    if (isFollowUp) {
      state.followUpAnswers[key] = this.recorded(analysis, attempt, false);
      state.followUpPending[question.key] = '';
    } else {
      state.answers[question.key] = this.recorded(analysis, attempt, false);
    }

    result.records.push({
      stepKey: key,
      stepKind: isFollowUp ? 'FOLLOW_UP' : 'QUESTION',
      detailField: null,
      questionKey: question.key,
      parentQuestionKey: isFollowUp ? question.key : null,
      transcript: analysis.transcript,
      interpretation: analysis.interpretation,
      language: analysis.language,
      sttConfidence: analysis.confidence,
      isSkipped: false,
      isDontKnow: analysis.kind === 'DONT_KNOW',
      isCommand: false,
      command: null,
      attempt,
      durationMs: input.durationMs,
      stageKind: isFollowUp ? 'FOLLOW_UP' : 'JOB_QUESTIONS',
    });

    result.directives.push(await this.acknowledge(state, analysis.kind));

    if (!isFollowUp && question.isScored) {
      const answer = state.answers[question.key]!;
      result.evaluations.push({
        stepKey: key,
        request: this.buildEvaluationRequest(state, question, {
          transcript: answer.transcript,
          interpretation: answer.interpretation,
          isSkipped: answer.isSkipped,
          isDontKnow: answer.isDontKnow,
        }),
      });
    }

    return this.advance(state, result, isFollowUp ? null : question);
  }

  /* ------------------------------------------------------------------ */
  /* Abandon / retry                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Records a step as unanswered after the retry budget is spent. This is a normal,
   * non-punitive outcome — it must never become a failure state.
   */
  private async abandon(state: EngineState, step: PlanStep, key: string, result: EngineTurnResult): Promise<EngineTurnResult> {
    const lang = state.languageCode;
    const attempt = (state.retries[key] ?? 0) + 1;
    const analysis: TurnAnalysis = {
      kind: 'EMPTY',
      transcript: '',
      interpretation: 'No usable answer was captured within the retry limit.',
      language: lang,
      confidence: 0,
      isComplete: false,
      injectionPatterns: [],
      detectionDetail: 'retries_exhausted',
    };

    if (step.kind === 'DETAIL') {
      state.answers[key] = this.recorded(analysis, attempt, true);
      result.records.push(this.record('DETAIL', key, step.detail.key, null, null, analysis, attempt, 'BASIC_DETAILS', true));
      result.directives.push(this.speak('skip_recorded', lang, 'encouraging'));
      result.stepAbandoned = true;
      return await this.advance(state, result, null);
    }

    if (step.kind === 'QUESTION') {
      state.answers[step.question.key] = this.recorded(analysis, attempt, true);
      result.records.push(this.record('QUESTION', key, null, step.question.key, null, analysis, attempt, 'JOB_QUESTIONS', true));
      result.directives.push(this.speak('dont_know_recorded', lang, 'encouraging'));
      result.stepAbandoned = true;
      if (step.question.isScored) {
        result.evaluations.push({
          stepKey: key,
          request: this.buildEvaluationRequest(state, step.question, {
            transcript: '',
            interpretation: 'Candidate did not answer within the retry limit.',
            isSkipped: true,
            isDontKnow: false,
          }),
        });
      }
      return await this.advance(state, result, null);
    }

    if (step.kind === 'FOLLOW_UP') {
      state.followUpAnswers[key] = this.recorded(analysis, attempt, true);
      state.followUpPending[step.question.key] = '';
      result.records.push(
        this.record('FOLLOW_UP', key, null, step.question.key, step.question.key, analysis, attempt, 'FOLLOW_UP', true),
      );
      result.directives.push(this.speak('skip_recorded', lang, 'encouraging'));
      result.stepAbandoned = true;
      return await this.advance(state, result, null);
    }

    if (step.kind === 'ELIGIBILITY') {
      state.eligibility[step.check.key] = { passed: false, recorded: true, message: 'Not confirmed' };
      result.eligibility.push({
        key: step.check.key,
        requirement: step.check.requirement,
        passed: false,
        isKnockout: step.check.isKnockout,
        message: 'Not confirmed',
      });
      if (step.check.isKnockout) {
        state.knockout = { triggered: true, requirement: step.check.requirement, message: step.check.knockoutMessage };
        result.directives.push({
          text: step.check.knockoutMessage ?? phrase('knockout_end', lang),
          emotion: 'neutral',
          displayText: null,
          slowRate: false,
          sequence: this.next(),
        });
        return await this.complete(state, result);
      }
      result.directives.push(this.speak('take_your_time', lang, 'encouraging'));
      return await this.advance(state, result, null);
    }

    result.stepAbandoned = true;
    result.directives.push(this.speak('take_your_time', lang, 'gentle_retry'));
    return this.finish(state, result, null);
  }

  private async retry(
    state: EngineState,
    step: PlanStep,
    key: string,
    result: EngineTurnResult,
    kind: 'UNINTELLIGIBLE' | 'CONFIDENCE',
  ): Promise<EngineTurnResult> {
    const lang = state.languageCode;
    const allow = retryAllowance(step, this.deps.settings.interview.retryLimit);
    const used = state.retries[key] ?? 0;
    if (used >= allow) return this.abandon(state, step, key, result);

    state.retries[key] = used + 1;
    state.updatedAt = new Date().toISOString();
    result.meta.retryKind = kind;
    result.meta.retriesRemaining = Math.max(0, allow - used - 1);

    const next = used + 1;
    if (next === 1) {
      result.directives.push(this.speak(RETRY_PHRASES[kind === 'CONFIDENCE' ? 1 : 0]!, lang, 'gentle_retry'));
      result.directives.push(this.askDirective(step, lang));
    } else {
      const simpler = this.simplerText(step, next);
      if (simpler) {
        state.simplifyCount += 1;
        result.directives.push({
          text: simpler,
          emotion: 'encouraging',
          displayText: simpler,
          slowRate: next >= 2,
          sequence: this.next(),
        });
      } else {
        result.directives.push(this.speak(RETRY_PHRASES[0]!, lang, 'gentle_retry'));
        result.directives.push(this.askDirective(step, lang, true));
      }
    }
    result.directives.push(this.speak('listening_prompt', lang, 'listening'));
    result.state = state;
    result.progress = this.progressFor(state);
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Advance / complete                                                  */
  /* ------------------------------------------------------------------ */

  private async advance(
    state: EngineState,
    result: EngineTurnResult,
    answeredQuestion: PlannedQuestion | null,
  ): Promise<EngineTurnResult> {
    const lang = state.languageCode;

    if (answeredQuestion) {
      const answer = state.answers[answeredQuestion.key];
      if (answer && !answer.isSkipped && !answer.isDontKnow) {
        const decision = await this.decideFollowUp(state, answeredQuestion, answer);
        if (decision.shouldAsk && decision.question) {
          state.followUpPending[answeredQuestion.key] = decision.question;
          state.followUpCounts[answeredQuestion.key] = (state.followUpCounts[answeredQuestion.key] ?? 0) + 1;
        } else if (decision.blockedReason) {
          this.deps.logger.warn('followup_blocked_by_content_policy', {
            reason: decision.blockedReason,
            category: answeredQuestion.category,
          });
        }
      }
    }

    if (state.knockout.triggered) return this.complete(state, result);

    const next = nextStep(state);
    if (next.kind === 'COMPLETE') return this.complete(state, result);

    const targetState = stateForStep(next);
    if (!canTransition(state.state, targetState)) {
      this.deps.logger.error('state_transition_rejected', { from: state.state, to: targetState });
    }
    state.state = targetState;
    state.stageKind = stageForStep(next);
    state.stepIndex += 1;
    state.updatedAt = new Date().toISOString();

    if (next.kind === 'QUESTION') {
      const announce = this.announceStage(state, next.question.key);
      if (announce) result.directives.push(announce);
    }
    result.directives.push(this.askDirective(next, lang));
    result.directives.push(this.speak('listening_prompt', lang, 'listening'));

    return this.finish(state, result, null);
  }

  private async complete(state: EngineState, result: EngineTurnResult): Promise<EngineTurnResult> {
    const lang = state.languageCode;
    result.directives.push(this.speak('interview_complete', lang, 'encouraging'));
    result.directives.push(this.speak('application_submitted', lang, 'neutral'));
    if (!this.deps.settings.interview.discloseScoreToCandidate) {
      result.directives.push(this.speak('score_not_disclosed', lang, 'neutral'));
    }
    result.directives.push(this.speak('goodbye', lang, 'neutral'));
    state.state = 'COMPLETED';
    state.stageKind = 'CLOSING';
    state.finalised = true;
    state.updatedAt = new Date().toISOString();
    return this.finish(state, result, 'COMPLETED');
  }

  private finish(state: EngineState, result: EngineTurnResult, terminal: 'COMPLETED' | null): EngineTurnResult {
    result.state = state;
    result.progress = this.progressFor(state);
    result.terminal = terminal;
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Follow-ups                                                          */
  /* ------------------------------------------------------------------ */

  private async decideFollowUp(
    state: EngineState,
    question: PlannedQuestion,
    answer: { transcript: string; isSkipped: boolean; isDontKnow: boolean },
  ): Promise<FollowUpDecision> {
    const asked = state.followUpCounts[question.key] ?? 0;
    const words = answer.transcript.split(/\s+/).filter(Boolean).length;
    const ctx = {
      mode: this.deps.job.followUpMode,
      maxFollowUpsPerQuestion: this.deps.job.maxFollowUpsPerQuestion,
      followUpsAlreadyAsked: asked,
      questionText: question.text,
      questionCategory: question.category,
      questionKeywords: question.keywords,
      jobTitle: this.deps.job.title,
      allowedTopics: unique([...question.skillTags, question.category, ...question.scoringCriteria.map((c) => c.label)]),
      answerKind: answer.isDontKnow ? ('DONT_KNOW' as const) : 'ANSWER' as const,
      answerText: answer.transcript,
      languageCode: state.languageCode,
    };
    void words;

    const adminDecision = decideFollowUp(
      ctx,
      question.followUpRules.map((r) => ({
        id: r.id ?? undefined,
        question: r.question,
        trigger: r.trigger,
        maxUses: r.maxUses,
      })),
    );
    if (adminDecision.shouldAsk || this.deps.job.followUpMode === 'DISABLED') return adminDecision;

    const { result } = await withFallback(
      () => generateAiFollowUp(ctx, this.deps.llm),
      () => generateAiFollowUp(ctx, this.mockLlm),
      (err, phase) => this.deps.logger.warn('followup_generation_degraded', { phase, err }),
    );
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Analysis helpers                                                    */
  /* ------------------------------------------------------------------ */

  private async analyse(text: string, input: VoiceTurnInput, questionText: string, lang: string): Promise<TurnAnalysis> {
    const args = {
      transcript: text,
      questionText,
      questionCategory: questionText.slice(0, 60),
      language: lang,
      declaredLanguage: input.spokenLanguage,
      sttConfidence: input.confidence,
      supportedLanguages: this.deps.settings.general.supportedLanguages,
      fallbackLanguage: this.deps.settings.general.fallbackLanguage,
    };
    const { result, degraded } = await withFallback(
      () => analyseTurn(args, this.deps.llm),
      () => analyseTurn(args, this.mockLlm),
      (err, phase) => this.deps.logger.warn('turn_analysis_degraded', { phase, err }),
    );
    if (degraded) result.injectionPatterns = [...result.injectionPatterns, 'provider_fallback'];
    return result;
  }

  private async extract(field: DetailField, transcript: string, result: EngineTurnResult) {
    const { result: value, degraded } = await withFallback(
      () => extractDetail(field as DetailField, transcript, this.deps.llm),
      () => extractDetail(field as DetailField, transcript, this.mockLlm),
      (err, phase) => this.deps.logger.warn('field_extraction_degraded', { phase, field, err }),
    );
    if (degraded) result.meta.degraded = true;
    return value;
  }

  private async acknowledge(state: EngineState, kind: TurnAnalysis['kind']): Promise<EngineDirective> {
    const lang = state.languageCode;
    if (kind === 'DONT_KNOW') return this.speak('dont_know_recorded', lang, 'encouraging');
    const args = { candidateName: state.candidate.name, kind, languageCode: lang };
    const { result, degraded } = await withFallback(
      () => generateAcknowledgement(args, this.deps.llm),
      () => generateAcknowledgement(args, this.mockLlm),
      (err, phase) => this.deps.logger.warn('acknowledgement_degraded', { phase, err }),
    );
    return {
      text: result,
      emotion: 'encouraging',
      // A degraded acknowledgement is not surfaced as a caption, so a lower-quality
      // phrase never becomes the visible record of what was said.
      displayText: degraded ? null : result,
      slowRate: false,
      sequence: this.next(),
    };
  }

  private buildEvaluationRequest(
    state: EngineState,
    question: PlannedQuestion,
    answer: { transcript: string; interpretation: string; isSkipped: boolean; isDontKnow: boolean },
  ): EvaluationRequest {
    return {
      question: {
        id: question.questionId ?? question.key,
        text: question.text,
        category: question.category,
        expectedAnswerGuidance: question.expectedAnswerGuidance,
        evaluationInstructions: question.evaluationInstructions,
        keywords: question.keywords,
        skillTags: question.skillTags,
        scoringCriteria: question.scoringCriteria.map((c) => ({
          label: c.label,
          description: c.description,
          points: c.points,
          keywords: c.keywords,
          isKnockout: c.isKnockout,
          knockoutMessage: c.knockoutMessage ?? undefined,
        })),
        scoreMax: question.scoreMax,
        weight: question.weight,
        isKnockout: question.isKnockout,
        knockoutMessage: question.knockoutMessage,
        isScored: question.isScored,
      },
      answer: {
        transcript: answer.transcript,
        interpretation: answer.interpretation,
        durationMs: 0,
        isSkipped: answer.isSkipped,
        isDontKnow: answer.isDontKnow,
      },
      context: {
        sessionId: '',
        jobTitle: this.deps.job.title,
        jobDescription: this.deps.job.description,
        languageCode: state.languageCode,
        strictness: this.deps.settings.scoring.strictness,
        confidenceFloor: this.deps.settings.scoring.confidenceFloor,
        questionIndex: 0,
      },
    };
  }

  /**
   * Directives that re-ask the current question after a reconnect.
   *
   * Used by the WebSocket hello path. It replays the welcome so the candidate knows
   * the session is alive, then the exact question they were on, then the listening
   * prompt — nothing else, so the conversation does not restart.
   */
  replayCurrentQuestion(state: EngineState): EngineDirective[] {
    const lang = state.languageCode;
    const step = nextStep(state);
    if (step.kind === 'COMPLETE') {
      return [
        this.speak('interview_complete', lang, 'encouraging'),
        this.speak('application_submitted', lang, 'neutral'),
        this.speak('goodbye', lang, 'neutral'),
      ];
    }
    return [
      this.askDirective(step, lang),
      this.speak('listening_prompt', lang, 'listening'),
    ];
  }

  /**
   * Applies a detail value chosen on the kiosk screen rather than spoken.
   *
   * Kept next to the speech path so the validation rules (age bounds, enum membership)
   * cannot drift between the two ways of providing the same answer.
   */
  setDetailValue(state: EngineState, field: DetailField, rawValue: string): void {
    const value = coerceDetailValue(field, rawValue);
    this.applyDetail(state, field, value);
    const key = `detail:${field}`;
    state.answers[key] = {
      transcript: '',
      interpretation: 'Selected on the kiosk screen.',
      language: state.languageCode,
      confidence: 1,
      isSkipped: false,
      isDontKnow: false,
      isCommand: false,
      command: null,
      attempt: 1,
      recordedAt: new Date().toISOString(),
    };
    state.updatedAt = new Date().toISOString();
  }

  /* ------------------------------------------------------------------ */
  /* State helpers                                                       */
  /* ------------------------------------------------------------------ */

  private recorded(analysis: TurnAnalysis, attempt: number, isSkipped: boolean) {
    return {
      transcript: analysis.transcript,
      interpretation: analysis.interpretation,
      language: analysis.language,
      confidence: analysis.confidence,
      isSkipped,
      isDontKnow: analysis.kind === 'DONT_KNOW',
      isCommand: false,
      command: null as string | null,
      attempt,
      recordedAt: new Date().toISOString(),
    };
  }

  private record(
    stepKind: EngineRecord['stepKind'],
    stepKeyValue: string,
    detailField: string | null,
    questionKey: string | null,
    parentQuestionKey: string | null,
    analysis: TurnAnalysis,
    attempt: number,
    stageKind: string,
    isSkipped: boolean,
  ): EngineRecord {
    return {
      stepKey: stepKeyValue,
      stepKind,
      detailField,
      questionKey,
      parentQuestionKey,
      transcript: analysis.transcript,
      interpretation: analysis.interpretation,
      language: analysis.language,
      sttConfidence: analysis.confidence,
      isSkipped,
      isDontKnow: analysis.kind === 'DONT_KNOW',
      isCommand: false,
      command: null,
      attempt,
      durationMs: 0,
      stageKind,
    };
  }

  private applyDetail(state: EngineState, field: DetailField | string, value: unknown): void {
    const c = state.candidate;
    switch (field) {
      case 'name':
        if (typeof value === 'string' && value.trim()) c.name = value.trim().slice(0, 120);
        break;
      case 'age':
        if (typeof value === 'number' && value >= 14 && value <= 70) c.age = value;
        break;
      case 'years_experience':
        if (typeof value === 'number' && value >= 0 && value <= 60) c.yearsExperience = value;
        break;
      case 'village':
        if (typeof value === 'string' && value.trim()) c.village = value.trim().slice(0, 200);
        break;
      case 'previous_work':
        if (typeof value === 'string' && value.trim()) c.previousWork = value.trim().slice(0, 1000);
        break;
      case 'work_preference':
        if (value === 'FULL_TIME' || value === 'PART_TIME') c.workPreference = value;
        break;
      case 'can_travel':
        if (typeof value === 'boolean') c.canTravel = value;
        break;
      default:
        if (typeof value === 'string' && value.trim()) c.extra[field] = value.trim().slice(0, 300);
    }
  }

  private askDirective(step: PlanStep, lang: string, slow = false): EngineDirective {
    if (step.kind === 'DETAIL') return this.speak(step.detail.phraseKey, lang, 'neutral', slow);
    if (step.kind === 'ELIGIBILITY') return this.speak(step.check.phraseKey, lang, 'neutral', slow);
    if (step.kind === 'FOLLOW_UP') {
      return { text: step.text, emotion: 'neutral', displayText: step.text, slowRate: slow, sequence: this.next() };
    }
    if (step.kind === 'QUESTION') {
      return {
        text: step.question.text,
        emotion: 'neutral',
        displayText: step.question.text,
        slowRate: slow,
        sequence: this.next(),
      };
    }
    // COMPLETE — nothing left to ask.
    return { text: '', emotion: 'neutral', displayText: null, slowRate: slow, sequence: this.next() };
  }

  private simplerText(step: PlanStep, attempt: number): string | null {
    if (attempt < this.deps.settings.interview.simplifyAfterAttempts) return null;
    if (step.kind === 'QUESTION') return step.question.simplerText;
    if (step.kind === 'FOLLOW_UP') return step.text;
    return null;
  }

  private questionTextFor(step: PlanStep): string {
    switch (step.kind) {
      case 'DETAIL':
        return phrase(step.detail.phraseKey as PhraseKey, this.deps.settings.general.fallbackLanguage);
      case 'ELIGIBILITY':
        return phrase(step.check.phraseKey as PhraseKey, this.deps.settings.general.fallbackLanguage);
      case 'QUESTION':
      case 'FOLLOW_UP':
        return step.question.text;
      case 'COMPLETE':
        return '';
    }
  }

  private speak(key: PhraseKey, lang: string, emotion: DirectiveEmotion, slow = false): EngineDirective {
    const text = phrase(key, lang, this.varsFor(lang));
    return {
      ...(hasPhrase(lang, key) ? { phraseKey: key } : {}),
      text,
      emotion,
      displayText: text,
      slowRate: slow,
      sequence: this.next(),
    };
  }

  /** Phrase variables available to every spoken line — currently just `{language}`. */
  private varsFor(lang: string): Record<string, string> {
    return { language: this.deps.languageNames?.[lang] ?? lang };
  }

  private announceStage(state: EngineState, questionKey: string): EngineDirective | null {
    const marker = `announce:${questionKey}`;
    if (state.spokenSteps.includes(marker)) return null;
    state.spokenSteps.push(marker);
    const isFirst = !state.spokenSteps.some((s) => s.startsWith('announce:'));
    const key: PhraseKey = isFirst ? 'intro_job_questions' : 'intro_follow_up';
    const lang = state.languageCode;
    return { phraseKey: key, text: phrase(key, lang), emotion: 'neutral', displayText: null, slowRate: false, sequence: this.next() };
  }

  private progressFor(state: EngineState): EngineTurnResult['progress'] {
    const total = state.plan.questions.length;
    const answered = state.plan.questions.filter((q) => state.answers[q.key]).length;
    return {
      answered,
      total,
      stage: state.stageKind,
      label: total > 0 ? `Question ${answered} of ${total}` : null,
    };
  }

  private blankResult(state: EngineState): EngineTurnResult {
    return {
      directives: [],
      progress: this.progressFor(state),
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

  private next(): number {
    this.sequence += 1;
    return this.sequence;
  }

}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const AFFIRMATIVE = /\b(yes|yeah|yep|haan|ha|hai|han|haa|ji|ok|okay|sure|definitely|bilkul|theek)\b/i;
const NEGATIVE = /\b(no|nope|nahi|nahin|na|never|नहीं|नही|नाही|नकोणी)\b/i;

/** Returns true/false, or null when the utterance was inconclusive. */
export function classifyYesNo(text: string): boolean | null {
  const t = text.trim();
  if (!t) return null;
  const hasYes = AFFIRMATIVE.test(t);
  const hasNo = NEGATIVE.test(t);
  if (hasYes && !hasNo) return true;
  if (hasNo && !hasYes) return false;
  if (/^(हां|हा|है|हो|चालेल)$/u.test(t)) return true;
  return null;
}

function previousAnswerableStep(state: EngineState, currentKey: string): PlanStep | null {
  const all: PlanStep[] = [
    ...state.plan.details.map((d, i) => ({ kind: 'DETAIL', index: i, detail: d }) as PlanStep),
    ...state.plan.eligibility.map((c, i) => ({ kind: 'ELIGIBILITY', index: i, check: c }) as PlanStep),
    ...state.plan.questions.map((q, i) => ({ kind: 'QUESTION', index: i, question: q }) as PlanStep),
  ];
  const currentIndex = all.findIndex((s) => stepKey(s) === currentKey);
  for (let i = Math.min(currentIndex, all.length) - 1; i >= 0; i -= 1) {
    const candidate = all[i]!;
    const k = stepKey(candidate);
    if (k === currentKey) continue;
    if (state.answers[k]) return candidate;
  }
  return null;
}

/** Normalises a screen-entered detail value to the same shape speech extraction produces. */
function coerceDetailValue(field: DetailField, raw: string): string | number | boolean | null {
  const value = raw.trim();
  switch (field) {
    case 'age':
    case 'years_experience': {
      const n = Number(normaliseDigits(value).replace(/[^\d.-]/g, ''));
      const limit = field === 'age' ? 70 : 60;
      const floor = field === 'age' ? 14 : 0;
      return Number.isFinite(n) && n >= floor && n <= limit ? Math.round(n) : null;
    }
    case 'can_travel':
      return /^(true|yes|haan|हां|हा|है|आहे|चालेल|1)$/i.test(value)
        ? true
        : /^(false|no|nahi|नहीं|नाही|नकोणी|0)$/i.test(value)
          ? false
          : null;
    case 'work_preference':
      if (/full|पुर्ण|पूरा|पूर्ण/i.test(value)) return 'FULL_TIME';
      if (/part|अर्ध|आंशिक/i.test(value)) return 'PART_TIME';
      return null;
    case 'name':
    case 'village':
    case 'previous_work':
      return value.slice(0, 300) || null;
    default:
      return value.slice(0, 300) || null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
