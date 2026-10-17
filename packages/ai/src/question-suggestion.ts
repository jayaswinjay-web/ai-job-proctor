import { z } from 'zod';
import { reviewQuestionContent, detectProhibitedTopics, untrustedBlock } from './guardrails.js';
import { parseStructured, type LlmProvider } from './providers/llm.js';
import { SKILL_TAGS, type Difficulty } from '@proctor/types';

/**
 * AI-assisted question authoring.
 *
 * Output is *never* auto-published. Everything returned here is marked
 * `source: AI_SUGGESTED` and stays at `validationStatus: UNVALIDATED` until an
 * administrator reviews, edits and approves it. The safety review below runs
 * unconditionally so a subtly discriminatory suggestion is rejected before a human
 * ever sees it in an editable form.
 */

export interface QuestionSuggestionInput {
  jobTitle: string;
  jobDescription: string;
  jobLocation: string;
  requiredSkills: string[];
  eligibilityCriteria: string[];
  minExperienceYears: number;
  count: number;
  languageCode: string;
  categories: string[];
  difficulty: Difficulty;
  otherLanguages: string[];
}

export interface SuggestedCriterion {
  label: string;
  description: string;
  points: number;
  keywords: string[];
  isKnockout: boolean;
  knockoutMessage: string;
  sortOrder: number;
}

export interface SuggestedFollowUp {
  question: string;
  trigger: 'ALWAYS' | 'IF_POSITIVE' | 'IF_NEGATIVE' | 'IF_SHORT' | 'MANUAL';
  maxUses: number;
  weight: number;
  sortOrder: number;
}

export interface SuggestedTranslation {
  languageCode: string;
  text: string;
  speakText: string;
}

export interface QuestionSuggestion {
  text: string;
  category: string;
  difficulty: Difficulty;
  expectedAnswerGuidance: string;
  keywords: string[];
  skillTags: string[];
  weight: number;
  scoreMax: number;
  scoringCriteria: SuggestedCriterion[];
  followUpRules: SuggestedFollowUp[];
  translations: SuggestedTranslation[];
  safetyNotes: string;
  /** Populated by the local safety gate. */
  validationIssues: string[];
  safe: boolean;
}

const suggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      text: z.string(),
      category: z.string(),
      difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
      expectedAnswerGuidance: z.string().default(''),
      keywords: z.array(z.string()).default([]),
      skillTags: z.array(z.string()).default([]),
      weight: z.number().default(10),
      scoreMax: z.number().default(10),
      scoringCriteria: z
        .array(
          z.object({
            label: z.string(),
            description: z.string().default(''),
            points: z.number().default(5),
            keywords: z.array(z.string()).default([]),
          }),
        )
        .default([]),
      followUpRules: z
        .array(
          z.object({
            question: z.string(),
            trigger: z.enum(['ALWAYS', 'IF_POSITIVE', 'IF_NEGATIVE', 'IF_SHORT', 'MANUAL']).default('MANUAL'),
            maxUses: z.number().default(1),
          }),
        )
        .default([]),
    }),
  ),
});

const SUGGEST_SYSTEM_PROMPT = `You write screening interview questions for employers.

ABSOLUTE RULES — output containing any of these is discarded:
- Ask ONLY about job competence, skills, experience, availability and safety on the job.
- NEVER ask about, or reference: gender, religion, caste, race, ethnicity, colour, skin, accent,
  dialect, grammar, spelling, vocabulary, literacy, disability, illness, medical history, mental
  health, political views, marital status, pregnancy, family planning, number of children, family
  background, income, appearance, height, weight, age, or horoscope/astrology.
- Never ask for information irrelevant to performing the job.
- Write questions a person who may not read can answer by SPEAKING, in one short sentence.
- Keep difficulty gentle: this audience may have limited formal schooling.
- Write 2–3 scoring criteria per question, each worth 4–6 points, summing to the scoreMax.
- Provide 4–10 plain keywords per criterion for deterministic matching.

Write plain text suitable for reading aloud. No markdown.`;

export async function suggestQuestions(
  input: QuestionSuggestionInput,
  llm: LlmProvider,
): Promise<QuestionSuggestion[]> {
  const prompt = [
    'ROLE AND REQUIREMENTS',
    untrustedBlock(
      {
        label: 'job',
        text: [
          `Title: ${input.jobTitle}`,
          `Location: ${input.jobLocation || 'not stated'}`,
          `Minimum experience: ${input.minExperienceYears} years`,
          input.jobDescription ? `Description: ${input.jobDescription}` : '',
          input.requiredSkills.length ? `Required skills: ${input.requiredSkills.join(', ')}` : '',
          input.eligibilityCriteria.length ? `Eligibility criteria: ${input.eligibilityCriteria.join('; ')}` : '',
        ].join('\n'),
        maxLength: 4000,
      },
    ),
    `Write ${input.count} questions. Difficulty: ${input.difficulty}. Primary language: ${input.languageCode}.`,
    input.categories.length ? `Cover these skill areas: ${input.categories.join(', ')}.` : 'Cover the main skill areas for this role.',
    input.otherLanguages.length
      ? `Also supply a translation for each of: ${input.otherLanguages.join(', ')}.`
      : 'Only the primary language is required.',
    `Allowed skill tags: ${SKILL_TAGS.join(', ')}.`,
    'Return JSON only.',
  ].join('\n\n');

  let raw: z.infer<typeof suggestionSchema>;
  try {
    const response = await llm.complete({
      task: 'suggest_questions',
      temperature: 0.5,
      maxTokens: 2400,
      messages: [
        { role: 'system', content: SUGGEST_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    });
    raw = parseStructured(response.text, suggestionSchema);
  } catch (err) {
    return [
      {
        ...failedSuggestion(input, (err as Error).message),
      },
    ];
  }

  return raw.suggestions.slice(0, input.count).map((s, index) => {
    const text = s.text.trim();
    const category = s.category.trim() || 'Experience';
    const scoreMax = clampNum(s.scoreMax, 4, 20, 10);
    const criteria: SuggestedCriterion[] = s.scoringCriteria.slice(0, 5).map((c, i) => ({
      label: c.label.trim(),
      description: c.description.trim(),
      points: clampNum(c.points, 1, scoreMax, 5),
      keywords: (c.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 10),
      isKnockout: false,
      knockoutMessage: '',
      sortOrder: i,
    }));
    const review = reviewQuestionContent({
      text,
      expectedAnswerGuidance: s.expectedAnswerGuidance,
      evaluationInstructions: '',
      scoringCriteriaLabels: criteria.map((c) => c.label),
      jobTitle: input.jobTitle,
    });
    const followUpIssues = s.followUpRules
      .map((f) => detectProhibitedTopics(f.question))
      .filter((t) => t.isProhibited)
      .map((t) => `Follow-up blocked: ${t.reason}`);

    const skillTags = (s.skillTags ?? [])
      .map((t) => t.toUpperCase().replace(/\s+/g, '_'))
      .filter((t): t is (typeof SKILL_TAGS)[number] => (SKILL_TAGS as readonly string[]).includes(t));

    return {
      text,
      category,
      difficulty: s.difficulty as Difficulty,
      expectedAnswerGuidance: s.expectedAnswerGuidance.trim(),
      keywords: (s.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 20),
      skillTags,
      weight: clampNum(s.weight, 0, 100, 10),
      scoreMax,
      scoringCriteria: criteria,
      followUpRules: s.followUpRules
        .filter((f) => !detectProhibitedTopics(f.question).isProhibited)
        .slice(0, 3)
        .map((f, i) => ({
          question: f.question.trim(),
          trigger: f.trigger,
          maxUses: clampNum(f.maxUses, 1, 3, 1),
          weight: 0,
          sortOrder: i,
        })),
      translations: input.otherLanguages.map((lang) => ({ languageCode: lang, text: '', speakText: '' })),
      safetyNotes: review.safe
        ? 'Reviewed: no protected characteristics referenced.'
        : `Review required before publishing. ${review.issues.join(' ')}`,
      validationIssues: [...review.issues, ...followUpIssues],
      safe: review.safe && followUpIssues.length === 0,
      ...(index === -1 ? {} : {}),
    };
  });
}

function failedSuggestion(input: QuestionSuggestionInput, message: string): QuestionSuggestion {
  return {
    text: '',
    category: 'Experience',
    difficulty: input.difficulty,
    expectedAnswerGuidance: '',
    keywords: [],
    skillTags: [],
    weight: 10,
    scoreMax: 10,
    scoringCriteria: [],
    followUpRules: [],
    translations: [],
    safetyNotes: `Question generation is unavailable (${message}). Add questions manually or check the AI provider configuration.`,
    validationIssues: [`provider_error: ${message}`],
    safe: false,
  };
}

function clampNum(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Reads generated translations that a model filled in (the mock leaves them blank). */
export function extractTranslations(suggestion: QuestionSuggestion): SuggestedTranslation[] {
  return suggestion.translations.filter((t) => t.text.trim().length > 0);
}