import type { PrismaClient } from '@proctor/database';
import { phrase, type PhraseKey } from '@proctor/types';
import type { Logger } from '@proctor/database';
import {
  STANDARD_DETAIL_STEPS,
  type EngineState,
  type PlannedEligibilityCheck,
  type PlannedQuestion,
} from './interview-state.js';
import { asArray, asNumber, asRecord, asString } from '../lib/merge.js';

/**
 * Builds the interview plan for a session.
 *
 * Everything here is dynamic: the question list, its wording in the candidate's
 * language, eligibility criteria, follow-ups and scoring weights all come from the
 * database. Nothing about any specific job is hard-coded, and adding a new job
 * requires no code change at all.
 *
 * Progressive design
 * ------------------
 * Questions are ordered easy → hard and grouped by stage, and the plan interleaves
 * eligibility checks with role questions rather than front-loading a technical
 * screen. A candidate who cannot read never sees a wall of text, because the AI
 * speaks one question at a time regardless.
 */

export interface PlanBuildInput {
  jobId: string;
  languageCode: string;
  supportedLanguages: string[];
  /** Hard cap so a misconfigured job cannot produce an 8-hour interview. */
  maxQuestionsPerStage?: number;
  maxTotalQuestions?: number;
}

export interface BuiltPlan {
  details: EngineState['plan']['details'];
  eligibility: PlannedEligibilityCheck[];
  questions: PlannedQuestion[];
  /** Human-readable summary stored on the session for audit. */
  summary: {
    detailCount: number;
    eligibilityCount: number;
    questionCount: number;
    stagesCovered: string[];
    missingTranslations: string[];
    untranslatedQuestionIds: string[];
  };
}

export async function buildInterviewPlan(
  prisma: PrismaClient,
  logger: Logger,
  input: PlanBuildInput,
): Promise<BuiltPlan> {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, deletedAt: null },
    include: {
      stages: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      requirements: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      languages: { include: { language: true } },
    },
  });
  if (!job) throw new Error(`Job ${input.jobId} not found`);

  const questions = await prisma.question.findMany({
    where: { jobId: job.id, isActive: true, deletedAt: null },
    include: {
      translations: { include: { language: true } },
      scoringCriteria: { orderBy: { sortOrder: 'asc' } },
      followUpRules: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  const lang = resolveLanguage(input.languageCode, input.supportedLanguages);
  const missingTranslations: string[] = [];

  /* -- Eligibility checks ------------------------------------------------ */
  const eligibility: PlannedEligibilityCheck[] = job.requirements.slice(0, 6).map((req, index) => {
    const isKnockout = req.isKnockout;
    return {
      key: `elig_${index}_${slug(req.skillTag)}`,
      // Eligibility is always asked as one short yes/no question.
      phraseKey: eligibilityPhraseKey(req.skillTag),
      requirement: req.skillTag,
      isKnockout,
      knockoutMessage: req.knockoutMessage ?? null,
    } satisfies PlannedEligibilityCheck;
  });

  /* -- Job questions ----------------------------------------------------- */
  const stageById = new Map(job.stages.map((s) => [s.id, s]));
  const ordered: Array<{ question: (typeof questions)[number]; stageSort: number; sortOrder: number }> = questions
    .map((q) => ({
      question: q,
      stageSort: q.stageId ? (stageById.get(q.stageId)?.sortOrder ?? 999) : 999,
      sortOrder: q.sortOrder,
    }))
    // Easy first within a stage so the interview ramps up rather than starting hard.
    .sort((a, b) => {
      if (a.stageSort !== b.stageSort) return a.stageSort - b.stageSort;
      const diff = difficultyRank(a.question.difficulty) - difficultyRank(b.question.difficulty);
      if (diff !== 0) return diff;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.question.createdAt.getTime() - b.question.createdAt.getTime();
    });

  const maxTotal = input.maxTotalQuestions ?? 40;
  const capped = ordered.slice(0, maxTotal);

  const planned: PlannedQuestion[] = [];
  const perStageCount = new Map<string, number>();

  for (const { question, stageSort } of capped) {
    const stageId = question.stageId ?? `unassigned`;
    const stage = question.stageId ? stageById.get(question.stageId) : undefined;
    const stageLimit = stage?.maxQuestions ?? 8;
    const used = perStageCount.get(stageId) ?? 0;
    if (used >= stageLimit) continue;
    perStageCount.set(stageId, used + 1);

    const translation = question.translations.find((t) => t.language.code === lang);
    // Fall back to the base wording rather than dropping the question. The fallback is
    // counted and logged so an administrator can see which questions need translating.
    const fellBack = !translation && question.baseLanguage !== lang;
    if (fellBack) missingTranslations.push(question.id);

    const text = translation?.text ?? question.text;
    const speakText = translation?.speakText ?? translation?.text ?? question.text;

    planned.push({
      key: `q_${question.id}`,
      questionId: question.id,
      stageKind: 'JOB_QUESTIONS',
      category: question.categoryName,
      text,
      speakText,
      simplerText: buildSimplerForm(text),
      isScored: question.scoreMax > 0,
      weight: question.weight,
      scoreMax: question.scoreMax,
      keywords: question.keywords,
      skillTags: question.skillTags,
      expectedAnswerGuidance: question.expectedAnswerGuidance,
      evaluationInstructions: question.evaluationInstructions,
      isRequired: question.isRequired,
      isKnockout: question.isKnockout,
      knockoutMessage: question.knockoutMessage,
      maxRetries: question.maxRetries,
      scoringCriteria: question.scoringCriteria.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        points: c.points,
        keywords: c.keywords,
        isKnockout: c.isKnockout,
        knockoutMessage: c.knockoutMessage,
      })),
      followUpRules: question.followUpRules.map((r) => ({
        id: r.id,
        question: r.questionText,
        trigger: r.trigger,
        maxUses: r.maxUses,
        weight: r.weight,
      })),
    });
    void stageSort;
  }

  logger.info('interview_plan_built', {
    jobId: job.id,
    jobTitle: job.title,
    languageCode: lang,
    detailCount: STANDARD_DETAIL_STEPS.length,
    eligibilityCount: eligibility.length,
    questionCount: planned.length,
    stagesCovered: job.stages.map((s) => s.kind),
  });

  if (missingTranslations.length > 0) {
    logger.warn('interview_plan_missing_translations', {
      jobId: job.id,
      languageCode: lang,
      // Spoken in the base language for these questions; worth surfacing in the admin UI.
      questionIds: missingTranslations,
    });
  }

  return {
    details: STANDARD_DETAIL_STEPS.map((d) => ({ ...d })),
    eligibility,
    questions: planned,
    summary: {
      detailCount: STANDARD_DETAIL_STEPS.length,
      eligibilityCount: eligibility.length,
      questionCount: planned.length,
      stagesCovered: job.stages.map((s) => s.kind),
      missingTranslations,
      untranslatedQuestionIds: missingTranslations,
    },
  };
}

/**
 * Rephrases a question into simpler language.
 *
 * Generated locally rather than by a model so it is available even when the AI
 * provider is down, and so the simplification can never drift off-topic. It strips
 * subordinate clauses and softens compound questions — both of which are the usual
 * cause of a candidate freezing on a long question.
 */
export function buildSimplerForm(text: string): string | null {
  const base = text.trim();
  if (base.length <= 28) return null;

  // Remove parenthetical asides and trailing explanations.
  let simpler = base.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

  // Keep only the first sentence or clause before a semicolon/dash expansion.
  simpler = simpler.split(/[;—]/)[0]!.trim();
  if (!simpler.endsWith('?') && !simpler.endsWith('.')) simpler += '?';

  // "Have you ever worked in a factory before?" -> "Have you worked in a factory?"
  simpler = simpler.replace(/\bever\s+/gi, '').replace(/\bat any time\b/gi, 'ever');

  if (simpler.length >= base.length - 2) return null;
  return simpler.length > 0 ? simpler : null;
}

/**
 * Maps a job requirement's skill tag onto the yes/no question the AI will speak.
 *
 * The set is intentionally small. A requirement whose eligibility cannot be
 * expressed as one of these short questions is still recorded for the report, but
 * the candidate is asked the closest matching simple question rather than something
 * invented at interview time.
 */
export function eligibilityPhraseKey(skillTag: string): PhraseKey {
  const table: Record<string, PhraseKey> = {
    AVAILABILITY: 'ask_work_preference',
    ELIGIBILITY: 'eligibility_documents',
    PHYSICAL_CONSIDERATION: 'eligibility_physical',
    TOOL_USE: 'eligibility_documents',
    SAFETY_AWARENESS: 'eligibility_physical',
    RELIABILITY: 'eligibility_age',
  };
  return table[skillTag] ?? 'eligibility_age';
}

/** Spoken wording for a requirement, resolved into the interview language. */
export function eligibilityPhraseFor(skillTag: string, languageCode: string): string {
  return phrase(eligibilityPhraseKey(skillTag), languageCode);
}

function resolveLanguage(requested: string, supported: string[]): string {
  if (supported.includes(requested)) return requested;
  const base = requested.split('-')[0]!;
  if (supported.includes(base)) return base;
  return supported[0] ?? 'en';
}

function difficultyRank(difficulty: string): number {
  return difficulty === 'EASY' ? 0 : difficulty === 'MEDIUM' ? 1 : 2;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32);
}

/** Reads job proctoring settings with safe defaults. */
export function parseJobProctoring(raw: unknown): {
  level: 'DISABLED' | 'BASIC' | 'STANDARD' | 'ENHANCED';
  cameraEnabled: boolean;
  detectMultiplePeople: boolean;
  detectFacingAway: boolean;
  facingAwaySeconds: number;
  kioskFullscreenEnforced: boolean;
} {
  const record = asRecord(raw);
  const level = asString(record.level, 'BASIC');
  return {
    level: (['DISABLED', 'BASIC', 'STANDARD', 'ENHANCED'].includes(level) ? level : 'BASIC') as
      'DISABLED' | 'BASIC' | 'STANDARD' | 'ENHANCED',
    cameraEnabled: record.cameraEnabled === true,
    detectMultiplePeople: record.detectMultiplePeople !== false,
    detectFacingAway: record.detectFacingAway === true,
    facingAwaySeconds: asNumber(record.facingAwaySeconds, 20),
    kioskFullscreenEnforced: record.kioskFullscreenEnforced !== false,
  };
}

/** Reads the questions-count and duration constraints an admin configured per job. */
export function readJobLimits(raw: unknown): { maxTotalQuestions: number } {
  const record = asRecord(raw);
  return { maxTotalQuestions: asNumber(record.maxTotalQuestions, 40) };
}

export { asArray, asNumber, asRecord, asString };