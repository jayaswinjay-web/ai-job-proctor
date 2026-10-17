import { asArray, asNumber, asRecord, asString } from '../lib/merge.js';

/**
 * Scoring arithmetic.
 *
 * Deterministic and inspectable by design. Every number that reaches the database
 * can be traced back to a weighted sum of per-criterion rubric points, which is what
 * makes the output explainable to an administrator and defensible in a fairness audit.
 */

export interface JobWeights {
  relevantExperience: number;
  jobKnowledge: number;
  practicalUnderstanding: number;
  safetyAwareness: number;
  communication: number;
  reliability: number;
  other: number;
}

export const DEFAULT_WEIGHTS: JobWeights = {
  relevantExperience: 20,
  jobKnowledge: 20,
  practicalUnderstanding: 20,
  safetyAwareness: 15,
  communication: 10,
  reliability: 10,
  other: 5,
};

/** Maps a question's skill tags onto the job's weighting dimensions. */
const TAG_TO_DIMENSION: Record<string, keyof JobWeights> = {
  RELEVANT_EXPERIENCE: 'relevantExperience',
  JOB_KNOWLEDGE: 'jobKnowledge',
  PRACTICAL_UNDERSTANDING: 'practicalUnderstanding',
  SAFETY_AWARENESS: 'safetyAwareness',
  COMMUNICATION: 'communication',
  RELIABILITY: 'reliability',
};

export interface ScoredAnswer {
  questionKey: string;
  questionId: string | null;
  category: string;
  skillTags: string[];
  weight: number;
  maxScore: number;
  rawScore: number;
  normalizedScore: number;
  confidence: number;
  criterionScores: Array<{ label: string; points: number; max: number; hitKeywords: string[]; reasoning: string }>;
  evaluationReason: string;
  concerns: string[];
  biasFlags: string[];
  isKnockout: boolean;
  triggeredKnockout: boolean;
}

export interface SkillScoreResult {
  skill: string;
  earned: number;
  max: number;
  questionCount: number;
  evidence: string[];
  /** Percentage 0–100, or 0 when nothing was assessable. */
  percent: number;
}

/**
 * Aggregates per-question scores into skill-level and overall figures.
 *
 * Only scored questions contribute. Introductory details (name, village) are recorded
 * for the recruiter but never affect the score, which is why the candidate's
 * literacy or language ability cannot leak into the result.
 */
export function computeSkillScores(answers: ScoredAnswer[]): SkillScoreResult[] {
  const scored = answers.filter((a) => a.maxScore > 0 && !a.isKnockout);
  const buckets = new Map<string, { earned: number; max: number; count: number; evidence: string[] }>();

  for (const answer of scored) {
    const dimensions = dimensionKeysFor(answer);
    if (dimensions.length === 0) continue;
    const perAnswerMax = answer.maxScore / dimensions.length;
    const perAnswerEarned = answer.rawScore / dimensions.length;
    for (const dimension of dimensions) {
      const bucket = buckets.get(dimension) ?? { earned: 0, max: 0, count: 0, evidence: [] };
      bucket.earned += perAnswerEarned;
      bucket.max += perAnswerMax;
      bucket.count += 1;
      if (answer.evaluationReason) bucket.evidence.push(answer.evaluationReason);
      buckets.set(dimension, bucket);
    }
  }

  return [...buckets.entries()]
    .map(([skill, b]) => ({
      skill,
      earned: round2(b.earned),
      max: round2(b.max),
      questionCount: b.count,
      evidence: dedupe(b.evidence).slice(0, 5),
      percent: b.max > 0 ? round2((b.earned / b.max) * 100) : 0,
    }))
    .sort((a, b) => b.percent - a.percent);
}

/**
 * Overall 0–100 score.
 *
 * Two factors, applied in order:
 *  1. Job weight — each dimension contributes proportionally to `JobWeights`.
 *  2. Question weight — within a dimension, higher-weighted questions count more.
 *
 * Dimensions with no assessable evidence are excluded from both the numerator and
 * the denominator, so an unanswered section lowers coverage rather than silently
 * dragging the average down and looking like poor performance.
 */
export function weightedOverallScore(
  answers: ScoredAnswer[],
  weights: JobWeights,
  /** Accepted for call-site symmetry; aggregation happens inside this function. */
  _skillScores: SkillScoreResult[],
): { score: number; coverage: number; contributions: Array<{ dimension: string; weight: number; percent: number; contribution: number }> } {
  const dimensionTotals = new Map<keyof JobWeights, { weightSum: number; earned: number; max: number }>();

  for (const answer of answers.filter((a) => a.maxScore > 0 && !a.isKnockout)) {
    const dimensions = dimensionKeysFor(answer);
    if (dimensions.length === 0) continue;
    const shareMax = answer.maxScore / dimensions.length;
    const shareEarned = answer.rawScore / dimensions.length;
    for (const dimension of dimensions) {
      const entry = dimensionTotals.get(dimension) ?? { weightSum: 0, earned: 0, max: 0 };
      // Weight each question's slice by its configured weight.
      const weight = Math.max(0.01, answer.weight);
      entry.weightSum += shareMax * weight;
      entry.earned += shareEarned * weight;
      entry.max += shareMax * weight;
      dimensionTotals.set(dimension, entry);
    }
  }

  const activeWeights = normaliseWeights(weights);
  let weightedPercentSum = 0;
  let activeWeightSum = 0;
  const contributions: Array<{ dimension: string; weight: number; percent: number; contribution: number }> = [];

  for (const [dimension, weight] of Object.entries(activeWeights) as Array<[keyof JobWeights, number]>) {
    const entry = dimensionTotals.get(dimension);
    if (!entry || entry.max <= 0) continue;
    const percent = (entry.earned / entry.max) * 100;
    const contribution = (percent * weight) / 100;
    weightedPercentSum += contribution;
    activeWeightSum += weight;
    contributions.push({ dimension, weight, percent: round2(percent), contribution: round2(contribution) });
  }

  if (activeWeightSum === 0) {
    return { score: 0, coverage: 0, contributions: [] };
  }

  // Rescale to the full weight total so an interview that only assessed, say,
  // experience and safety is not penalised for the dimensions never asked about.
  const score = clamp((weightedPercentSum / activeWeightSum) * 100, 0, 100);
  const totalWeight = Object.values(activeWeights).reduce((s, w) => s + w, 0);
  const coverage = totalWeight > 0 ? clamp((activeWeightSum / totalWeight) * 100, 0, 100) : 0;

  return { score: round2(score), coverage: round2(coverage), contributions };
}

/**
 * Rescales weights so they total 100. Administrators may legitimately enter weights
 * that sum to anything; normalising here keeps the arithmetic honest.
 */
export function normaliseWeights(weights: JobWeights): Record<keyof JobWeights, number> {
  const entries = Object.entries(weights).map(([k, v]) => [k, Math.max(0, asNumber(v, 0))] as [keyof JobWeights, number]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return { ...DEFAULT_WEIGHTS };
  return Object.fromEntries(entries.map(([k, v]) => [k, (v / total) * 100])) as Record<keyof JobWeights, number>;
}

/** Which weighting dimensions a question feeds. Never empty for scored questions. */
export function dimensionKeysFor(answer: Pick<ScoredAnswer, 'skillTags' | 'category'>): Array<keyof JobWeights> {
  const out = new Set<keyof JobWeights>();
  for (const tag of answer.skillTags) {
    const dimension = TAG_TO_DIMENSION[tag];
    if (dimension) out.add(dimension);
  }
  if (out.size === 0) {
    const fromCategory = TAG_TO_DIMENSION[answer.category.toUpperCase().replace(/\s+/g, '_')];
    if (fromCategory) out.add(fromCategory);
  }
  // Communication is deliberately not inferred from how fluently someone spoke.
  return [...out];
}

/** Reads `Job.weights` JSON from the database into a typed, defaulted object. */
export function parseJobWeights(raw: unknown): JobWeights {
  const record = asRecord(raw);
  // `asNumber` alone is not enough here: Number(null) is 0 and Number('') is 0, both of
  // which are finite and would therefore pass through. A stored `null` must mean "no
  // value saved", not "this dimension is worth nothing", otherwise a partially written
  // weights column silently drops whole dimensions out of the rubric.
  const weight = (key: keyof JobWeights): number =>
    record[key] === null || record[key] === undefined || record[key] === ''
      ? DEFAULT_WEIGHTS[key]
      : asNumber(record[key], DEFAULT_WEIGHTS[key]);

  return {
    relevantExperience: weight('relevantExperience'),
    jobKnowledge: weight('jobKnowledge'),
    practicalUnderstanding: weight('practicalUnderstanding'),
    safetyAwareness: weight('safetyAwareness'),
    communication: weight('communication'),
    reliability: weight('reliability'),
    other: weight('other'),
  };
}

/** Extracts skill scores from a stored report's JSON payload. */
export function parseSkillScoreJson(raw: unknown): Array<{ skill: string; score: number; max: number; evidence: string }> {
  return asArray<Record<string, unknown>>(raw)
    .map((entry) => ({
      skill: asString(entry.skill),
      score: asNumber(entry.score ?? entry.earned),
      max: asNumber(entry.max),
      evidence: asString(entry.evidence),
    }))
    .filter((s) => s.skill.length > 0);
}

/**
 * Whether any answer in the interview raised a guard flag of any kind.
 *
 * Flags include protected-attribute references, provider fallback and score drift. A flag
 * is never a finding about the candidate: it means the evaluation should be read by a
 * person before the report is relied upon.
 */
export function hasBiasFlag(answers: ScoredAnswer[]): boolean {
  return answers.some((a) => a.biasFlags.length > 0);
}

/** The subset of flags that indicate a protected attribute reached the evaluation. */
export function hasProtectedAttributeFlag(answers: ScoredAnswer[]): boolean {
  return answers.some((a) => a.biasFlags.some((f) => f.startsWith('protected_attribute_referenced')));
}

export function collectBiasFlags(answers: ScoredAnswer[]): string[] {
  return [...new Set(answers.flatMap((a) => a.biasFlags))];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}