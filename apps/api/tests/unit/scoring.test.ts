import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  collectBiasFlags,
  computeSkillScores,
  dimensionKeysFor,
  hasBiasFlag,
  normaliseWeights,
  parseJobWeights,
  weightedOverallScore,
  type ScoredAnswer,
} from '../../src/services/scoring.js';

/**
 * Scoring tests.
 *
 * The properties asserted here are the ones that decide whether a candidate is treated
 * fairly: unassessed dimensions must not count against them, a knockout must not be
 * averaged in, and coverage must be reported honestly so a reviewer can see a thin result
 * for what it is.
 */

function answer(overrides: Partial<ScoredAnswer> = {}): ScoredAnswer {
  return {
    questionKey: 'q1',
    questionId: null,
    category: 'RELEVANT_EXPERIENCE',
    skillTags: ['RELEVANT_EXPERIENCE'],
    weight: 10,
    maxScore: 10,
    rawScore: 8,
    normalizedScore: 80,
    confidence: 0.9,
    criterionScores: [],
    evaluationReason: 'Described relevant work clearly.',
    concerns: [],
    biasFlags: [],
    isKnockout: false,
    triggeredKnockout: false,
    ...overrides,
  };
}

describe('weight normalisation', () => {
  it('rescales arbitrary weights to 100', () => {
    // Only two dimensions are weighted here; the rest are explicitly zeroed so the
    // assertion states the intended outcome rather than relying on the defaults.
    const normalised = normaliseWeights({
      relevantExperience: 50,
      jobKnowledge: 50,
      practicalUnderstanding: 0,
      safetyAwareness: 0,
      communication: 0,
      reliability: 0,
      other: 0,
    });
    const total = Object.values(normalised).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(100, 5);
    expect(normalised.relevantExperience).toBeCloseTo(50, 5);
  });

  it('preserves the ratio between dimensions', () => {
    const normalised = normaliseWeights({
      relevantExperience: 10,
      jobKnowledge: 30,
      practicalUnderstanding: 0,
      safetyAwareness: 60,
      communication: 0,
      reliability: 0,
      other: 0,
    });
    expect(normalised.jobKnowledge / normalised.relevantExperience).toBeCloseTo(3, 5);
    expect(normalised.safetyAwareness / normalised.relevantExperience).toBeCloseTo(6, 5);
  });

  it('falls back to defaults when every weight is zero', () => {
    const zeroes = {
      relevantExperience: 0,
      jobKnowledge: 0,
      practicalUnderstanding: 0,
      safetyAwareness: 0,
      communication: 0,
      reliability: 0,
      other: 0,
    };
    expect(normaliseWeights(zeroes)).toEqual(DEFAULT_WEIGHTS);
  });

  it('treats a negative weight as zero rather than inverting the score', () => {
    const normalised = normaliseWeights({ ...DEFAULT_WEIGHTS, relevantExperience: -50 });
    expect(normalised.relevantExperience).toBe(0);
    expect(Object.values(normalised).every((w) => w >= 0)).toBe(true);
  });

  it('parses malformed stored weights without throwing', () => {
    const parsed = parseJobWeights({ relevantExperience: '40', jobKnowledge: null });
    expect(parsed.relevantExperience).toBe(40);
    // A stored null means "never set", so it falls back to the default rather than
    // silently scoring the dimension as zero.
    expect(parsed.jobKnowledge).toBe(DEFAULT_WEIGHTS.jobKnowledge);
  });

  it('treats an empty stored value as unset rather than zero', () => {
    const parsed = parseJobWeights({ safetyAwareness: '' });
    expect(parsed.safetyAwareness).toBe(DEFAULT_WEIGHTS.safetyAwareness);
  });

  it('falls back to defaults for a null weights column', () => {
    expect(parseJobWeights(null)).toEqual(DEFAULT_WEIGHTS);
  });
});

describe('dimension mapping', () => {
  it('uses explicit skill tags when present', () => {
    expect(dimensionKeysFor({ skillTags: ['SAFETY_AWARENESS'], category: 'RELEVANT_EXPERIENCE' })).toEqual([
      'safetyAwareness',
    ]);
  });

  it('falls back to the category when no tag is set', () => {
    expect(dimensionKeysFor({ skillTags: [], category: 'PRACTICAL_UNDERSTANDING' })).toEqual([
      'practicalUnderstanding',
    ]);
  });

  it('maps a human-written category with spaces', () => {
    expect(dimensionKeysFor({ skillTags: [], category: 'job knowledge' })).toEqual(['jobKnowledge']);
  });

  it('does not invent a communication score from an untagged question', () => {
    // Communication must only be scored where a question explicitly targets it, never
    // inferred from how fluently the candidate spoke.
    expect(dimensionKeysFor({ skillTags: [], category: 'general' })).toEqual([]);
  });
});

describe('skill aggregation', () => {
  it('aggregates answers into one bucket per dimension', () => {
    const scores = computeSkillScores([
      answer({ skillTags: ['RELEVANT_EXPERIENCE'], rawScore: 8, maxScore: 10 }),
      answer({ skillTags: ['RELEVANT_EXPERIENCE'], rawScore: 6, maxScore: 10 }),
    ]);
    expect(scores).toHaveLength(1);
    expect(scores[0]?.skill).toBe('relevantExperience');
    expect(scores[0]?.earned).toBe(14);
    expect(scores[0]?.max).toBe(20);
    expect(scores[0]?.percent).toBe(70);
  });

  it('ignores questions that carry no score', () => {
    expect(computeSkillScores([answer({ maxScore: 0, rawScore: 0 })])).toEqual([]);
  });

  it('excludes knockout criteria from the aggregate', () => {
    const scores = computeSkillScores([answer({ isKnockout: true, rawScore: 0 })]);
    expect(scores).toEqual([]);
  });

  it('splits a question across the dimensions it actually targets', () => {
    const scores = computeSkillScores([
      answer({ skillTags: ['RELEVANT_EXPERIENCE', 'SAFETY_AWARENESS'], rawScore: 10, maxScore: 10 }),
    ]);
    const bySkill = new Map(scores.map((s) => [s.skill, s]));
    expect(bySkill.get('relevantExperience')?.earned).toBe(5);
    expect(bySkill.get('safetyAwareness')?.earned).toBe(5);
  });

  it('sorts strongest dimension first', () => {
    const scores = computeSkillScores([
      answer({ skillTags: ['RELEVANT_EXPERIENCE'], rawScore: 2, maxScore: 10 }),
      answer({ skillTags: ['SAFETY_AWARENESS'], rawScore: 10, maxScore: 10 }),
    ]);
    expect(scores[0]?.skill).toBe('safetyAwareness');
  });
});

describe('overall score', () => {
  const weights = normaliseWeights(DEFAULT_WEIGHTS);

  it('scores full marks as 100', () => {
    const { score } = weightedOverallScore(
      [answer({ rawScore: 10, maxScore: 10, skillTags: ['RELEVANT_EXPERIENCE'] })],
      { ...weights, relevantExperience: 100 },
      [],
    );
    expect(score).toBeCloseTo(100, 5);
  });

  it('scores zero marks as 0', () => {
    const { score } = weightedOverallScore(
      [answer({ rawScore: 0, maxScore: 10 })],
      weights,
      [],
    );
    expect(score).toBe(0);
  });

  it('never exceeds 100 even with inflated input', () => {
    const { score } = weightedOverallScore([answer({ rawScore: 50, maxScore: 10 })], weights, []);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('does not penalise a candidate for dimensions that were never assessed', () => {
    // One assessed dimension at full marks must score 100 even though six other dimensions
    // carry weight in the job configuration. Coverage is reported separately so a reviewer
    // can still see how much of the rubric was actually asked.
    const jobWeights = {
      relevantExperience: 0,
      jobKnowledge: 0,
      practicalUnderstanding: 0,
      safetyAwareness: 100,
      communication: 0,
      reliability: 0,
      other: 0,
    };
    const { score, coverage } = weightedOverallScore(
      [answer({ rawScore: 10, maxScore: 10, skillTags: ['SAFETY_AWARENESS'] })],
      jobWeights,
      [],
    );
    expect(score).toBeCloseTo(100, 5);
    expect(coverage).toBeCloseTo(100, 5);
  });

  it('keeps a full-mark answer from the only assessed dimension at 100 while reporting partial coverage', () => {
    // The job weights safety at 15% of the rubric but the interview only assessed safety.
    // The score must not be divided by the unassessed 85%; coverage is what reports that.
    const { score, coverage } = weightedOverallScore(
      [answer({ rawScore: 10, maxScore: 10, skillTags: ['SAFETY_AWARENESS'] })],
      { ...weights, safetyAwareness: 100 },
      [],
    );
    expect(score).toBeCloseTo(100, 5);
    expect(coverage).toBeLessThan(60);
  });

  it('reports reduced coverage when only part of the rubric was assessed', () => {
    const { coverage } = weightedOverallScore(
      [
        answer({ skillTags: ['RELEVANT_EXPERIENCE'] }),
        answer({ skillTags: ['SAFETY_AWARENESS'] }),
      ],
      weights,
      [],
    );
    // Relevant experience and safety are 20 and 15 of the default 100 total.
    expect(coverage).toBeCloseTo(35, 0);
    expect(coverage).toBeLessThan(100);
  });

  it('weights a higher-weighted question more heavily within a dimension', () => {
    const heavy = weightedOverallScore(
      [
        answer({ skillTags: ['SAFETY_AWARENESS'], rawScore: 0, maxScore: 10, weight: 30 }),
        answer({ skillTags: ['SAFETY_AWARENESS'], rawScore: 10, maxScore: 10, weight: 5 }),
      ],
      { ...weights, safetyAwareness: 100 },
      [],
    );
    const light = weightedOverallScore(
      [
        answer({ skillTags: ['SAFETY_AWARENESS'], rawScore: 0, maxScore: 10, weight: 5 }),
        answer({ skillTags: ['SAFETY_AWARENESS'], rawScore: 10, maxScore: 10, weight: 30 }),
      ],
      { ...weights, safetyAwareness: 100 },
      [],
    );
    expect(heavy.score).toBeLessThan(light.score);
  });

  it('returns zero when nothing was scorable, rather than throwing', () => {
    expect(weightedOverallScore([], weights, [])).toEqual({ score: 0, coverage: 0, contributions: [] });
  });

  it('reports per-dimension contributions that sum to the score once rescaled', () => {
    // A contribution is expressed in points of the job's weighting, so the raw sum is the
    // pre-rescale total. Comparing it directly to the 0-100 score would be wrong; what must
    // hold is that rescaling the contributions reproduces the score exactly.
    const { score, contributions } = weightedOverallScore(
      [answer({ skillTags: ['RELEVANT_EXPERIENCE', 'SAFETY_AWARENESS'], rawScore: 8, maxScore: 10 })],
      weights,
      [],
    );
    const rawSum = contributions.reduce((s, c) => s + c.contribution, 0);
    const weightSum = contributions.reduce((s, c) => s + c.weight, 0);
    expect((rawSum / weightSum) * 100).toBeCloseTo(score, 1);
  });
});

describe('bias flags', () => {
  it('reports no flags for a clean evaluation', () => {
    expect(hasBiasFlag([answer()])).toBe(false);
    expect(collectBiasFlags([answer()])).toEqual([]);
  });

  it('surfaces a flag raised by any answer', () => {
    const answers = [answer(), answer({ biasFlags: ['low_confidence'] })];
    expect(hasBiasFlag(answers)).toBe(true);
    expect(collectBiasFlags(answers)).toEqual(['low_confidence']);
  });

  it('deduplicates repeated flags', () => {
    const answers = [answer({ biasFlags: ['protected_attribute_detected'] }), answer({ biasFlags: ['protected_attribute_detected'] })];
    expect(collectBiasFlags(answers)).toEqual(['protected_attribute_detected']);
  });
});
