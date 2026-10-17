import { z } from 'zod';
import { untrustedBlock } from './guardrails.js';
import { parseStructured, type LlmProvider } from './providers/llm.js';
import type { Recommendation } from '@proctor/types';

/**
 * Interview-level reporting.
 *
 * The report is explicitly framed as *AI-assisted screening output*. It always
 * carries a disclaimer, it never blocks human review, and a proctoring event alone
 * can never move the recommendation — that is enforced in `deriveRecommendation`.
 */

export interface SkillScoreInput {
  skill: string;
  earned: number;
  max: number;
  questionCount: number;
  evidence: string[];
}

export interface ReportInput {
  candidateName: string | null;
  jobTitle: string;
  jobDescription: string;
  languageCode: string;
  /** Weighted 0–100 score produced by the deterministic scorer. */
  weightedScore: number;
  passingScore: number;
  skillScores: SkillScoreInput[];
  strengths: string[];
  weaknesses: string[];
  eligibilityStatus: string;
  knockoutTriggered: boolean;
  knockoutReason: string | null;
  proctorEventCount: number;
  proctorEventTypes: string[];
  answeredQuestionCount: number;
  totalQuestionCount: number;
  elapsedMinutes: number;
  /** True when any answer fell below the review-confidence floor. */
  lowConfidenceDetected: boolean;
  demoMode: boolean;
}

export interface ReportOutput {
  summary: string;
  experienceSummary: string;
  strengths: string[];
  weaknesses: string[];
  concerns: string[];
  recommendedNextAction: string;
  methodology: string;
  skillScores: Array<{ skill: string; score: number; max: number; evidence: string }>;
}

const reportSchema = z.object({
  summary: z.string().default(''),
  experienceSummary: z.string().default(''),
  strengths: z.array(z.string()).default([]),
  weaknesses: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  recommendedNextAction: z.string().default(''),
  skills: z
    .array(
      z.object({
        skill: z.string(),
        score: z.number(),
        max: z.number(),
        evidence: z.string().default(''),
      }),
    )
    .default([]),
  methodology: z.string().default(''),
});

const REPORT_SYSTEM_PROMPT = `You write a short, factual screening summary for a hiring administrator.

RULES
- Describe only evidence present in the DATA block. Never invent experience.
- Never mention or characterise gender, religion, caste, race, ethnicity, colour, accent,
  dialect, grammar, spelling, literacy, disability, health, age, appearance or family background.
- Never describe the person as "good" or "bad". Describe demonstrated job skills.
- Strengths and weaknesses must each be specific and tied to a skill.
- recommendedNextAction must be a concrete administrative step, and must always be framed as
  something a HUMAN decides. Never state or imply the candidate is hired or rejected.
- Plain text, no markdown. Maximum 3 sentences for summary and experienceSummary.`;

export async function generateReport(input: ReportInput, llm: LlmProvider): Promise<ReportOutput> {
  const skillSummary = input.skillScores
    .map((s) => `${s.skill}: ${round2(s.earned)} / ${round2(s.max)} (${s.questionCount} questions, evidence: ${s.evidence.slice(0, 3).join('; ') || 'none recorded'})`)
    .join('\n');

  const prompt = [
    'DATA',
    untrustedBlock({ label: 'role', text: `${input.jobTitle}\n${input.jobDescription.slice(0, 1200)}`, maxLength: 1800 }),
    `<candidateName>${input.candidateName ?? 'Not stated'}</candidateName>`,
    `<weightedScore>${round2(input.weightedScore)} / 100 (passing score ${input.passingScore})</weightedScore>`,
    `SKILL BREAKDOWN:\n${skillSummary || 'No scored skills recorded.'}`,
    `<questionsAnswered>${input.answeredQuestionCount} of ${input.totalQuestionCount}</questionsAnswered>`,
    `<eligibility>${input.eligibilityStatus}</eligibility>`,
    `<proctoringEvents>${input.proctorEventCount}${input.proctorEventTypes.length ? ` (${input.proctorEventTypes.join(', ')})` : ''}</proctoringEvents>`,
    `<interviewDurationMinutes>${input.elapsedMinutes}</interviewDurationMinutes>`,
    input.lowConfidenceDetected ? '<note>Some answers had low transcription or evaluation confidence and require human verification.</note>' : '',
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const fallback = ruleBasedReport(input);

  if (llm.isMock) {
    try {
      const response = await llm.complete({
        task: 'summarize_report',
        temperature: 0.2,
        maxTokens: 900,
        messages: [
          { role: 'system', content: REPORT_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      });
      const parsed = parseStructured(response.text, reportSchema);
      return {
        summary: parsed.summary || fallback.summary,
        experienceSummary: parsed.experienceSummary || fallback.experienceSummary,
        strengths: (parsed.strengths.length ? parsed.strengths : fallback.strengths).slice(0, 8),
        weaknesses: (parsed.weaknesses.length ? parsed.weaknesses : fallback.weaknesses).slice(0, 8),
        concerns: parsed.concerns.slice(0, 8),
        recommendedNextAction: parsed.recommendedNextAction || fallback.recommendedNextAction,
        methodology: parsed.methodology || fallback.methodology,
        skillScores: (parsed.skills.length ? parsed.skills : fallback.skillScores).map((s) => ({
          skill: s.skill,
          score: round2(s.score),
          max: round2(s.max),
          evidence: s.evidence || 'Derived from rubric scoring.',
        })),
      };
    } catch {
      return fallback;
    }
  }

  try {
    const response = await llm.complete({
      task: 'summarize_report',
      temperature: 0.2,
      maxTokens: 900,
      messages: [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    });
    const parsed = parseStructured(response.text, reportSchema);
    return {
      summary: parsed.summary || fallback.summary,
      experienceSummary: parsed.experienceSummary || fallback.experienceSummary,
      strengths: (parsed.strengths.length ? parsed.strengths : fallback.strengths).slice(0, 8),
      weaknesses: (parsed.weaknesses.length ? parsed.weaknesses : fallback.weaknesses).slice(0, 8),
      concerns: parsed.concerns.slice(0, 8),
      recommendedNextAction: parsed.recommendedNextAction || fallback.recommendedNextAction,
      methodology: parsed.methodology || fallback.methodology,
      skillScores: (parsed.skills.length ? parsed.skills : fallback.skillScores).map((s) => ({
        skill: s.skill,
        score: round2(s.score),
        max: round2(s.max),
        evidence: s.evidence || 'Derived from rubric scoring.',
      })),
    };
  } catch {
    return fallback;
  }
}

/** Deterministic narrative, used directly in demo mode and as the LLM fallback. */
export function ruleBasedReport(input: ReportInput): ReportOutput {
  const name = input.candidateName?.trim() || 'The candidate';
  const pct = (s: SkillScoreInput) => (s.max > 0 ? (s.earned / s.max) * 100 : 0);
  const strong = input.skillScores.filter((s) => pct(s) >= 60).sort((a, b) => pct(b) - pct(a));
  const weak = input.skillScores.filter((s) => pct(s) < 40).sort((a, b) => pct(a) - pct(b));

  const summary =
    `${name} completed the ${input.jobTitle} screening. Weighted overall score ${round2(input.weightedScore)} out of 100 ` +
    `against a passing score of ${input.passingScore}. ${input.answeredQuestionCount} of ${input.totalQuestionCount} questions were answered. ` +
    (input.knockoutTriggered ? `A mandatory requirement was not met: ${input.knockoutReason ?? 'unspecified'}.` : 'All mandatory requirements were met.');

  const experienceSummary = input.skillScores
    .filter((s) => /experience/i.test(s.skill))
    .map((s) => `${s.skill} scored ${Math.round(pct(s))}% across ${s.questionCount} questions.`)
    .join(' ') || 'Experience was captured during the conversation and mapped against the job requirements.';

  const strengths = strong.slice(0, 5).map((s) => `${s.skill}: ${Math.round(pct(s))}% (${s.evidence[0] ?? 'rubric criteria met'})`);
  const weaknesses = weak.slice(0, 5).map((s) => `${s.skill}: ${Math.round(pct(s))}% (little supporting evidence given)`);

  const concerns: string[] = [];
  if (input.proctorEventCount > 0) {
    concerns.push(
      `${input.proctorEventCount} proctoring event(s) were recorded (${input.proctorEventTypes.join(', ')}). These are automated observations requiring human confirmation, not findings of wrongdoing.`,
    );
  }
  if (input.lowConfidenceDetected) concerns.push('Some answers had low recognition or evaluation confidence; verify against the recording.');
  if (input.answeredQuestionCount < input.totalQuestionCount) {
    concerns.push(`${input.totalQuestionCount - input.answeredQuestionCount} question(s) were not answered.`);
  }
  if (input.demoMode) concerns.push('Produced with demo AI providers. Not suitable for a real hiring decision.');

  const methodology =
    `Weighted sum of per-question rubric scores. Each question score decomposes into administrator-defined criteria, ` +
    `each with the evidence that produced it. ${input.eligibilityStatus}. ` +
    `Scoring considered job competence only: accent, dialect, grammar, literacy, disability, health, age, ` +
    `religion, caste, gender, race and socioeconomic background were explicitly excluded.`;

  return {
    summary,
    experienceSummary,
    strengths: strengths.length ? strengths : ['Completed the full conversation without disengaging.'],
    weaknesses,
    concerns,
    recommendedNextAction: nextAction(input),
    methodology,
    skillScores: input.skillScores.map((s) => ({
      skill: s.skill,
      score: round2(s.earned),
      max: round2(s.max),
      evidence: s.evidence.slice(0, 3).join('; ') || 'Derived from rubric scoring.',
    })),
  };
}

function nextAction(input: ReportInput): string {
  if (input.knockoutTriggered) {
    return 'A mandatory requirement was not met. A human reviewer should confirm the finding from the recording before any decision is made.';
  }
  if (input.proctorEventCount > 0) {
    return 'Review the recorded proctoring events and the audio before progressing. Do not act on an automated alert alone.';
  }
  if (input.lowConfidenceDetected) {
    return 'Listen to the recording and verify the AI evaluation before progressing.';
  }
  if (input.weightedScore >= input.passingScore + 15) {
    return 'Proceed to a human interview panel.';
  }
  if (input.weightedScore >= input.passingScore) {
    return 'Proceed to a human review of the transcript and recording before deciding.';
  }
  return 'Do not progress at this stage. Retain the record for future opportunities and consider an alternative role.';
}

/* -------------------------------------------------------------------------- */
/* Recommendation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Maps a weighted score to a screening recommendation.
 *
 * Deliberate design choices:
 *  * A proctoring event NEVER affects the score or the recommendation here.
 *  * Knockouts produce `NOT_RECOMMENDED` regardless of score, and are flagged so a
 *    human verifies the underlying answer.
 *  * Low-confidence or mock-evaluated interviews return `PENDING_REVIEW` so they
 *    land in a human queue instead of being auto-decided.
 */
export function deriveRecommendation(input: {
  weightedScore: number;
  passingScore: number;
  knockoutTriggered: boolean;
  proctorEventCount: number;
  lowConfidenceDetected: boolean;
  demoMode: boolean;
  autoRecommend: boolean;
}): { recommendation: Recommendation; basis: string } {
  if (input.knockoutTriggered) {
    return {
      recommendation: 'NOT_RECOMMENDED',
      basis: 'A mandatory job requirement recorded as not met. A human must confirm from the recording.',
    };
  }
  if (!input.autoRecommend) {
    return { recommendation: 'PENDING_REVIEW', basis: 'Automated recommendations are disabled; awaiting human review.' };
  }
  if (input.demoMode) {
    return { recommendation: 'PENDING_REVIEW', basis: 'Produced with demo AI providers; requires human review.' };
  }
  if (input.lowConfidenceDetected) {
    return { recommendation: 'PENDING_REVIEW', basis: 'Answer confidence below threshold; routed to human review rather than auto-decided.' };
  }

  const delta = input.weightedScore - input.passingScore;
  if (delta >= 20) return { recommendation: 'STRONG_MATCH', basis: `Score is ${Math.round(delta)} points above the passing score.` };
  if (delta >= 5) return { recommendation: 'GOOD_MATCH', basis: `Score is ${Math.round(delta)} points above the passing score.` };
  if (delta >= -10) return { recommendation: 'CONSIDER', basis: 'Score is close to the passing score; human judgement needed.' };
  return { recommendation: 'NOT_RECOMMENDED', basis: `Score is ${Math.round(-delta)} points below the passing score.` };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}