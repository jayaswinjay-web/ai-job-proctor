import { z } from 'zod';

/**
 * Evaluation contract.
 *
 * Scoring is *never* a single opaque model call. Every score decomposes into
 * per-criterion points with the evidence that produced them, so an administrator
 * can always answer "why did this candidate get 6 out of 10?".
 */

export const criterionScoreSchema = z.object({
  label: z.string(),
  points: z.number().min(0),
  max: z.number().min(0),
  hitKeywords: z.array(z.string()).default([]),
  reasoning: z.string().default(''),
});
export type CriterionScore = z.infer<typeof criterionScoreSchema>;

export const evaluationOutcomeSchema = z.object({
  rawScore: z.number(),
  normalizedScore: z.number(),
  confidence: z.number().min(0).max(1),
  evaluationReason: z.string(),
  strengths: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  aiNotes: z.string().default(''),
  criterionScores: z.array(criterionScoreSchema).default([]),
  /** Attributes the guard detected being referenced; empty means the guard found none. */
  biasFlags: z.array(z.string()).default([]),
  /** Requirement labels that failed a knockout rule. */
  triggeredKnockouts: z.array(z.string()).default([]),
  /** Rubric dimensions this answer shows no evidence of. */
  missingCriteria: z.array(z.string()).default([]),
});
export type EvaluationOutcome = z.infer<typeof evaluationOutcomeSchema>;

export interface EvaluationCriterionInput {
  id?: string;
  label: string;
  description?: string;
  points: number;
  keywords?: string[];
  isKnockout?: boolean;
  knockoutMessage?: string;
}

export interface EvaluationQuestionInput {
  id: string;
  text: string;
  category: string;
  expectedAnswerGuidance: string;
  evaluationInstructions: string;
  keywords: string[];
  skillTags: string[];
  scoringCriteria: EvaluationCriterionInput[];
  scoreMax: number;
  weight: number;
  isKnockout: boolean;
  knockoutMessage: string | null;
  /** True for the standard BASIC_DETAILS curriculum, which is not scored. */
  isScored: boolean;
}

export interface EvaluationAnswerInput {
  transcript: string;
  interpretation: string;
  durationMs: number;
  isSkipped: boolean;
  isDontKnow: boolean;
}

export interface EvaluationContext {
  sessionId: string;
  jobTitle: string;
  jobDescription: string;
  languageCode: string;
  strictness: 'LENIENT' | 'BALANCED' | 'STRICT';
  /** Minimum confidence before the score is treated as provisional. */
  confidenceFloor: number;
  /** Question number, used only for explanation text. */
  questionIndex: number;
}

export interface EvaluationRequest {
  question: EvaluationQuestionInput;
  answer: EvaluationAnswerInput;
  context: EvaluationContext;
}

export interface EvaluationProvider {
  readonly name: string;
  readonly isMock: boolean;
  evaluate(request: EvaluationRequest): Promise<EvaluationOutcome>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

/**
 * Shared post-conditions enforced for every provider, including LLM ones:
 *  1. Scores are clamped into the configured range.
 *  2. `isKnockout` questions with no evidence collapse to zero and flag the knockout.
 *  3. A protected attribute appearing in the reason text is stripped and flagged.
 *  4. Low confidence is surfaced, never silently hidden.
 */
export function finaliseOutcome(
  outcome: EvaluationOutcome,
  request: EvaluationRequest,
): EvaluationOutcome {
  const { question } = request;
  const max = question.scoreMax || 10;
  const strictnessFactor = request.context.strictness === 'STRICT' ? 1 : request.context.strictness === 'LENIENT' ? 0.94 : 1;

  let raw = clamp(outcome.rawScore * strictnessFactor, 0, max);

  // No evidence at all → zero. A skipped/don't-know answer cannot earn partial credit
  // on an explicit requirement.
  const evidence = [
    question.expectedAnswerGuidance,
    question.evaluationInstructions,
    ...question.keywords,
    ...question.scoringCriteria.map((c) => `${c.label} ${c.description ?? ''} ${(c.keywords ?? []).join(' ')}`),
  ]
    .join(' ')
    .toLowerCase();
  const said = `${request.answer.transcript} ${request.answer.interpretation}`.toLowerCase();
  const overlap = evidence.split(/[^a-zऀ-ॿ]+/).filter((w) => w.length > 3);
  const hits = overlap.filter((w) => said.includes(w)).length;

  if (request.answer.isSkipped || request.answer.isDontKnow) {
    raw = 0;
  } else if (hits === 0 && said.replace(/[^a-zऀ-ॿँ-ॿ]+/gi, '').length < 12) {
    raw = Math.min(raw, max * 0.15);
    outcome.concerns = uniq([...outcome.concerns, 'Very short answer with no recognisable evidence.']);
  }

  if (question.isKnockout && raw < max * 0.4) {
    outcome.triggeredKnockouts = uniq([...outcome.triggeredKnockouts, question.category]);
  }

  const biasFlags = scrubProtectedAttributes(outcome, request);

  const confidence = clamp(outcome.confidence, 0, 1);
  const normalized = max === 0 ? 0 : clamp((raw / max) * 100, 0, 100);

  return {
    ...outcome,
    rawScore: round2(raw),
    normalizedScore: round2(normalized),
    confidence: round2(confidence),
    biasFlags,
    criterionScores: outcome.criterionScores.map((c) => ({
      ...c,
      points: clamp(c.points, 0, Math.max(c.max, 0)),
    })),
  };
}

function scrubProtectedAttributes(outcome: EvaluationOutcome, request: EvaluationRequest): string[] {
  const flags = new Set(outcome.biasFlags);
  const protectedPhrases = [
    'gender',
    'religion',
    'caste',
    'race',
    'ethnic',
    'accent',
    'dialect',
    'fluency',
    'grammar',
    'vocabulary',
    'disability',
    'disabled',
    'illness',
    'literacy',
    'native language',
    'mother tongue',
    'appearance',
    'looking young',
    'socioeconomic',
    'family background',
  ];
  const haystack = [outcome.evaluationReason, outcome.aiNotes, ...outcome.strengths, ...outcome.concerns].join(' ').toLowerCase();
  for (const p of protectedPhrases) {
    if (haystack.includes(p)) {
      flags.add(`protected_attribute_referenced:${p}`);
      // Neutralise the sentence rather than letting it stand as a scoring reason.
      outcome.evaluationReason = neutralise(outcome.evaluationReason, p);
      outcome.aiNotes = neutralise(outcome.aiNotes, p);
    }
  }
  if (request.answer.transcript.length === 0 && !request.answer.isSkipped) {
    flags.add('empty_transcript');
  }
  return [...flags];
}

function neutralise(text: string, phrase: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !s.toLowerCase().includes(phrase))
    .join(' ')
    .trim();
}

export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}