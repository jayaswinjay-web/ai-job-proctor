import type { DetailField } from '@proctor/ai';
import type { FollowUpMode, PhraseKey, StageKind } from '@proctor/types';

/**
 * Interview state machine.
 *
 * The engine owns a serialisable `EngineState` that is persisted to
 * `InterviewSession.engineState` on every transition. That is what makes an
 * interview survivable: a kiosk refresh, a dropped connection, or an API restart
 * resumes from the last committed state rather than losing the candidate's answers.
 *
 *                 ┌──────────── STOP / START_AGAIN ────────────┐
 *                 v                                              │
 *  CREATED → AWAITING_CONSENT → AWAITING_LANGUAGE → BASIC_DETAILS │
 *                 │                   │                 │          │
 *                 │                   │        ELIGIBILITY_CHECK │
 *                 │                   │                 │          │
 *                 └───────────────────┴──────→ JOB_QUESTIONS ──────┘
 *                                                       │  ↕ FOLLOW_UP
 *                                                       v
 *                                              FINAL_REVIEW → COMPLETED
 *
 * Any state may transition to FAILED or CANCELLED. COMPLETED, FAILED and CANCELLED
 * are terminal and the session row is locked against further writes.
 */
export const STATE_TRANSITIONS: Record<string, readonly string[]> = {
  CREATED: ['AWAITING_CONSENT', 'AWAITING_LANGUAGE', 'BASIC_DETAILS', 'CANCELLED', 'FAILED'],
  AWAITING_CONSENT: ['AWAITING_LANGUAGE', 'BASIC_DETAILS', 'CANCELLED', 'FAILED'],
  AWAITING_LANGUAGE: ['BASIC_DETAILS', 'ELIGIBILITY_CHECK', 'JOB_QUESTIONS', 'CANCELLED', 'FAILED'],
  BASIC_DETAILS: ['ELIGIBILITY_CHECK', 'JOB_QUESTIONS', 'CANCELLED', 'FAILED'],
  ELIGIBILITY_CHECK: ['JOB_QUESTIONS', 'BASIC_DETAILS', 'CANCELLED', 'FAILED'],
  JOB_QUESTIONS: ['FOLLOW_UP', 'FINAL_REVIEW', 'JOB_QUESTIONS', 'CANCELLED', 'FAILED'],
  FOLLOW_UP: ['JOB_QUESTIONS', 'FINAL_REVIEW', 'FOLLOW_UP', 'CANCELLED', 'FAILED'],
  FINAL_REVIEW: ['COMPLETED', 'JOB_QUESTIONS', 'CANCELLED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
} as const;

export const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function canTransition(from: string, to: string): boolean {
  return (STATE_TRANSITIONS[from] ?? []).includes(to);
}

/** A question slot in the interview plan. */
export interface PlannedQuestion {
  /** Stable key so engine state can reference a question without a DB id. */
  key: string;
  questionId: string | null;
  stageKind: StageKind;
  category: string;
  /** Text in the interview language, already resolved. */
  text: string;
  speakText: string;
  /** Prompts used when the candidate needs it rephrased more simply. */
  simplerText: string | null;
  isScored: boolean;
  weight: number;
  scoreMax: number;
  keywords: string[];
  skillTags: string[];
  expectedAnswerGuidance: string;
  evaluationInstructions: string;
  isRequired: boolean;
  isKnockout: boolean;
  knockoutMessage: string | null;
  maxRetries: number;
  scoringCriteria: Array<{
    id: string | null;
    label: string;
    description: string;
    points: number;
    keywords: string[];
    isKnockout: boolean;
    knockoutMessage: string | null;
  }>;
  followUpRules: Array<{
    id: string | null;
    question: string;
    trigger: 'ALWAYS' | 'IF_POSITIVE' | 'IF_NEGATIVE' | 'IF_SHORT' | 'MANUAL';
    maxUses: number;
    weight: number;
  }>;
}

export interface PlannedDetail {
  key: DetailField;
  /** Phrase key from PHRASES, spoken verbatim in the candidate's language. */
  phraseKey: PhraseKey;
  isScored: false;
}

export interface PlannedEligibilityCheck {
  key: string;
  phraseKey: PhraseKey;
  requirement: string;
  isKnockout: boolean;
  knockoutMessage: string | null;
}

export interface RecordedAnswer {
  transcript: string;
  interpretation: string;
  language: string | null;
  confidence: number;
  isSkipped: boolean;
  isDontKnow: boolean;
  isCommand: boolean;
  command: string | null;
  /** Which attempt produced this answer. */
  attempt: number;
  recordedAt: string;
}

export interface EngineState {
  version: number;
  /** Non-null once the interview has progressed past language selection. */
  languageCode: string;
  state: string;
  stageKind: StageKind;
  /** Cursor into the flattened plan. */
  stepIndex: number;
  plan: {
    details: PlannedDetail[];
    eligibility: PlannedEligibilityCheck[];
    questions: PlannedQuestion[];
  };
  /** Main-step answers keyed by plan step key. Written once, never mutated. */
  answers: Record<string, RecordedAnswer>;
  /** Follow-up answers, keyed by the follow-up step key. */
  followUpAnswers: Record<string, RecordedAnswer>;
  candidate: {
    name: string | null;
    age: number | null;
    village: string | null;
    previousWork: string | null;
    yearsExperience: number | null;
    workPreference: string | null;
    canTravel: boolean | null;
    extra: Record<string, string>;
  };
  /** Step keys already spoken, so a reconnect does not re-ask everything. */
  spokenSteps: string[];
  retryCount: number;
  simplifyCount: number;
  /** Per-step retry counters, keyed by step key. */
  retries: Record<string, number>;
  /** A queued follow-up per question key, cleared once asked or exhausted. */
  followUpPending: Record<string, string>;
  followUpCounts: Record<string, number>;
  eligibility: Record<
    string,
    { passed: boolean; recorded: boolean; message: string }
  >;
  knockout: { triggered: boolean; message: string | null; requirement: string | null };
  startedAt: string;
  updatedAt: string;
  /** Marks the interview as finished and awaiting report generation. */
  finalised: boolean;
}

export const ENGINE_STATE_VERSION = 1;

/** Standard BASIC_DETAILS curriculum. Not scored; used for reporting and eligibility. */
export const STANDARD_DETAIL_STEPS: readonly PlannedDetail[] = [
  // Order is deliberate and matters for extraction quality:
  //   name -> previous work -> age -> years of experience.
  // Asking age before experience means "I am 32 years old" is unambiguous, whereas
  // asking experience first invites a candidate to answer it with their age.
  { key: 'name', phraseKey: 'ask_name', isScored: false },
  { key: 'previous_work', phraseKey: 'ask_previous_work', isScored: false },
  { key: 'age', phraseKey: 'ask_age', isScored: false },
  { key: 'years_experience', phraseKey: 'ask_years_experience', isScored: false },
  { key: 'village', phraseKey: 'ask_village', isScored: false },
  { key: 'work_preference', phraseKey: 'ask_work_preference', isScored: false },
  { key: 'can_travel', phraseKey: 'ask_can_travel', isScored: false },
] as const;

export function createEngineState(options: {
  languageCode: string;
  plan: EngineState['plan'];
  consentText: string | null;
}): EngineState {
  const now = new Date().toISOString();
  return {
    version: ENGINE_STATE_VERSION,
    languageCode: options.languageCode,
    state: 'CREATED',
    stageKind: 'GREETING',
    stepIndex: 0,
    plan: options.plan,
    answers: {},
    followUpAnswers: {},
    candidate: {
      name: null,
      age: null,
      village: null,
      previousWork: null,
      yearsExperience: null,
      workPreference: null,
      canTravel: null,
      extra: {},
    },
    spokenSteps: [],
    retryCount: 0,
    simplifyCount: 0,
    retries: {},
    followUpPending: {},
    followUpCounts: {},
    eligibility: {},
    knockout: { triggered: false, message: null, requirement: null },
    startedAt: now,
    updatedAt: now,
    finalised: false,
    ...(options.consentText ? {} : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* Plan iteration                                                             */
/* -------------------------------------------------------------------------- */

export type PlanStep =
  | { kind: 'DETAIL'; index: number; detail: PlannedDetail }
  | { kind: 'ELIGIBILITY'; index: number; check: PlannedEligibilityCheck }
  | { kind: 'QUESTION'; index: number; question: PlannedQuestion }
  | { kind: 'FOLLOW_UP'; index: number; question: PlannedQuestion; parentKey: string; text: string }
  | { kind: 'COMPLETE' };

/**
 * Produces the next step. Follow-ups are surfaced immediately after their parent
 * answer when the administrator or the model has queued one.
 */
export function nextStep(state: EngineState): PlanStep {
  const { plan } = state;

  // NOTE: answers are keyed by the full step key (`detail:name`, not `name`), so this
  // lookup must go through stepKey() rather than the raw key.
  for (let i = 0; i < plan.details.length; i += 1) {
    const detail = plan.details[i]!;
    const existing = state.answers[`detail:${detail.key}`];
    if (existing && !existing.isSkipped) continue;
    // A skipped detail is only abandoned once the retry budget is genuinely spent, so a
    // candidate who says "I don't know" once is asked again rather than losing the field.
    if (existing?.isSkipped && existing.attempt > 1) continue;
    return { kind: 'DETAIL', index: i, detail };
  }

  for (let i = 0; i < plan.eligibility.length; i += 1) {
    const check = plan.eligibility[i]!;
    if (state.eligibility[check.key]?.recorded) continue;
    return { kind: 'ELIGIBILITY', index: i, check };
  }

  for (let i = 0; i < plan.questions.length; i += 1) {
    const question = plan.questions[i]!;
    const answer = state.answers[question.key];
    if (!answer) return { kind: 'QUESTION', index: i, question };

    // A queued follow-up must be asked before moving on, and only once.
    const pending = state.followUpPending[question.key];
    if (pending && pending.trim()) {
      const fKey = `followup:${question.key}:${pending.slice(0, 40)}`;
      if (!state.followUpAnswers[fKey]) {
        return { kind: 'FOLLOW_UP', index: i, question, parentKey: question.key, text: pending };
      }
    }
  }

  return { kind: 'COMPLETE' };
}

/** Maps a plan step to the session state it should put the interview into. */
export function stateForStep(step: PlanStep): string {
  switch (step.kind) {
    case 'DETAIL':
      return 'BASIC_DETAILS';
    case 'ELIGIBILITY':
      return 'ELIGIBILITY_CHECK';
    case 'QUESTION':
      return 'JOB_QUESTIONS';
    case 'FOLLOW_UP':
      return 'FOLLOW_UP';
    case 'COMPLETE':
      return 'FINAL_REVIEW';
  }
}

export function stageForStep(step: PlanStep): StageKind {
  switch (step.kind) {
    case 'DETAIL':
      return 'BASIC_DETAILS';
    case 'ELIGIBILITY':
      return 'ELIGIBILITY_CHECK';
    case 'QUESTION':
      return 'JOB_QUESTIONS';
    case 'FOLLOW_UP':
      return 'FOLLOW_UP';
    case 'COMPLETE':
      return 'FINAL_REVIEW';
  }
}

/** Stable key for a step, used for engine-state bookkeeping. */
export function stepKey(step: PlanStep): string {
  switch (step.kind) {
    case 'DETAIL':
      return `detail:${step.detail.key}`;
    case 'ELIGIBILITY':
      return `eligibility:${step.check.key}`;
    case 'QUESTION':
      return `question:${step.question.key}`;
    case 'FOLLOW_UP':
      return `followup:${step.parentKey}:${step.text.slice(0, 40)}`;
    case 'COMPLETE':
      return 'complete';
  }
}

/** Retry allowance for a step, falling back to the interview default. */
export function retryAllowance(step: PlanStep, defaultLimit: number): number {
  if (step.kind === 'QUESTION') return Math.max(0, step.question.maxRetries || defaultLimit);
  return defaultLimit;
}

export function followUpModeAllows(mode: FollowUpMode, alreadyAsked: number, max: number): boolean {
  if (mode === 'DISABLED') return false;
  if (mode === 'LIMITED') return alreadyAsked < Math.min(max, 1);
  return alreadyAsked < max;
}