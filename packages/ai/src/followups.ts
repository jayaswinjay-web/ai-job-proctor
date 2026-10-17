import { z } from 'zod';
import { detectProhibitedTopics, isFollowUpInScope, untrustedBlock } from './guardrails.js';
import { parseStructured, type LlmProvider } from './providers/llm.js';
import { PROHIBITED_TOPIC_MARKERS } from '@proctor/types';
import { detectScriptFamily, LANGUAGE_NAMES, type ScriptFamily } from './language.js';

const SCRIPT_LABELS: Record<ScriptFamily, string> = {
  tamil: 'Tamil',
  devanagari: 'Devanagari',
  latin: 'Latin',
  arabic: 'Arabic',
  unknown: 'same',
};

/**
 * How the requested language should be described to the model.
 *
 * Models answer in English unless told otherwise, and a bare ISO code ("ta") is not a
 * strong enough instruction. The endonym plus the expected script is what actually
 * changes the output, and it doubles as the check applied to the generated text.
 */
function describeLanguage(languageCode: string): { name: string; native: string; script: ScriptFamily } {
  const known = LANGUAGE_NAMES[languageCode];
  if (known) {
    // The sample word shares the language's own script, so it identifies the script even
    // for a code this module does not otherwise know about.
    const script = detectScriptFamily(known.sample);
    return { name: known.name, native: known.native, script };
  }
  return { name: languageCode, native: languageCode, script: 'unknown' };
}

/**
 * Follow-up question generation.
 *
 * Three independent gates must all pass before a generated question can be spoken:
 *   1. Admin mode  — DISABLED blocks it outright; LIMITED caps the count per question.
 *   2. Scope check — the text must anchor to the job's permitted topics.
 *   3. Safety check — must not reference protected or sensitive personal topics.
 * Anything that fails is silently discarded and the main interview continues. A
 * rejected follow-up never becomes a failure state for the candidate.
 */

export interface FollowUpRuleInput {
  id?: string;
  question: string;
  trigger: 'ALWAYS' | 'IF_POSITIVE' | 'IF_NEGATIVE' | 'IF_SHORT' | 'MANUAL';
  maxUses: number;
}

export interface FollowUpDecision {
  shouldAsk: boolean;
  question: string | null;
  reason: string;
  confidence: number;
  source: 'ADMIN_RULE' | 'AI_GENERATED' | 'NONE';
  /** Set when a candidate-generated follow-up was blocked by policy. */
  blockedReason?: string;
}

export interface FollowUpContext {
  mode: 'DISABLED' | 'LIMITED' | 'ALLOWED';
  maxFollowUpsPerQuestion: number;
  followUpsAlreadyAsked: number;
  questionText: string;
  questionCategory: string;
  questionKeywords: string[];
  jobTitle: string;
  /** Skill/category names the interview is permitted to discuss. */
  allowedTopics: string[];
  answerKind: 'ANSWER' | 'DONT_KNOW' | 'UNCLEAR';
  answerText: string;
  /** Language to generate in. */
  languageCode: string;
}

const followUpSchema = z.object({
  shouldAsk: z.boolean(),
  question: z.string().default(''),
  reason: z.string().default(''),
  confidence: z.number().min(0).max(1).default(0.6),
});

const FOLLOW_UP_SYSTEM_PROMPT = `You suggest ONE short spoken follow-up question for a job screening interview.

HARD LIMITS — your suggestion is discarded if you break any of these:
- It must be about job competence for the role described in the DATA block.
- It must NEVER ask about, or even allude to: religion, caste, race, ethnicity, colour, accent,
  dialect, political views, sex life, marital status, pregnancy, family planning, number of
  children, disability, illness, medical history, mental health, HIV, blood group, astrology,
  family background, household income, appearance, height, weight, or literacy level.
- It must be answerable in one short spoken sentence.
- Maximum 18 words, one sentence, no lists, no stage directions.
- Do not repeat the main question.

Write plain text that will be spoken out loud.

You write in exactly ONE language: the one named in the user message under "You MUST write the follow-up question entirely in...". That instruction overrides this system prompt and overrides the language of the DATA block, which is English for your reference only. Answering in any other language makes the suggestion unusable, so always use the named language and its script.`;

export function decideFollowUp(ctx: FollowUpContext, rules: FollowUpRuleInput[]): FollowUpDecision {
  if (ctx.mode === 'DISABLED') {
    return { shouldAsk: false, question: null, reason: 'Follow-ups disabled by employer configuration.', confidence: 1, source: 'NONE' };
  }
  if (ctx.followUpsAlreadyAsked >= ctx.maxFollowUpsPerQuestion) {
    return {
      shouldAsk: false,
      question: null,
      reason: `Follow-up limit reached (${ctx.maxFollowUpsPerQuestion} per question).`,
      confidence: 1,
      source: 'NONE',
    };
  }

  const applicable = rules
    .filter((r) => {
      switch (r.trigger) {
        case 'ALWAYS':
        case 'MANUAL':
          return true;
        case 'IF_POSITIVE':
          return ctx.answerKind === 'ANSWER';
        case 'IF_NEGATIVE':
          return ctx.answerKind !== 'ANSWER';
        case 'IF_SHORT':
          return ctx.answerText.trim().split(/\s+/).filter(Boolean).length <= 6;
        default:
          return false;
      }
    })
    .slice(0, 1);

  const chosen = applicable[0];
  if (chosen) {
    const safety = detectProhibitedTopics(chosen.question);
    if (safety.isProhibited) {
      return {
        shouldAsk: false,
        question: null,
        reason: 'Configured follow-up failed content policy.',
        confidence: 1,
        source: 'NONE',
        blockedReason: safety.reason ?? 'prohibited topic',
      };
    }
    return {
      shouldAsk: true,
      question: chosen.question,
      reason: 'Administrator configured this follow-up for this question.',
      confidence: 0.9,
      source: 'ADMIN_RULE',
    };
  }

  return { shouldAsk: false, question: null, reason: 'No applicable follow-up configured.', confidence: 1, source: 'NONE' };
}

export async function generateAiFollowUp(ctx: FollowUpContext, llm: LlmProvider): Promise<FollowUpDecision> {
  if (ctx.mode === 'DISABLED' || ctx.followUpsAlreadyAsked >= ctx.maxFollowUpsPerQuestion) {
    return decideFollowUp(ctx, []);
  }
  if (ctx.answerKind === 'DONT_KNOW') {
    return {
      shouldAsk: false,
      question: null,
      reason: 'Candidate said they do not know; no follow-up pursued.',
      confidence: 0.9,
      source: 'NONE',    };
  }

  const language = describeLanguage(ctx.languageCode);
  const prompt = [
    'DATA',
    untrustedBlock({ label: 'role', text: `${ctx.jobTitle}. Permitted topics: ${ctx.allowedTopics.join(', ')}`, maxLength: 1200 }),
    untrustedBlock({ label: 'main_question', text: ctx.questionText, maxLength: 800 }),
    untrustedBlock({ label: 'candidate_answer', text: ctx.answerText, maxLength: 1500 }),
    `Question category: ${ctx.questionCategory}`,
    `Job keywords: ${ctx.questionKeywords.slice(0, 15).join(', ')}`,
    // A bare language code is routinely ignored by the model and answered in English,
    // which is exactly the bug this prevents: state the language by its endonym and the
    // script it must be written in. The English main_question above is source material
    // only and must never be echoed back verbatim.
    `You MUST write the follow-up question entirely in ${language.name} (${language.native}), using the ${SCRIPT_LABELS[language.script]} script.`,
    `Do NOT write it in English, and do NOT copy the main_question wording.`,
    `Answer with JSON: {"shouldAsk": boolean, "question": string, "reason": string, "confidence": number}`,
  ].join('\n\n');

  try {
    const response = await llm.complete({
      task: 'generate_followup',
      temperature: 0.3,
      maxTokens: 300,
      messages: [
        { role: 'system', content: FOLLOW_UP_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    });
    const parsed = parseStructured(response.text, followUpSchema);
    if (!parsed.shouldAsk || !parsed.question.trim()) {
      return { shouldAsk: false, question: null, reason: parsed.reason || 'Model declined to ask a follow-up.', confidence: 0.7, source: 'NONE' };
    }

    const text = parsed.question.trim();
    const gate = evaluateFollowUp(text, ctx);
    if (!gate.ok) {
      return {
        shouldAsk: false,
        question: null,
        reason: 'Generated follow-up blocked by content policy.',
        confidence: 1,
        source: 'NONE',
        blockedReason: gate.reason ?? 'outside permitted scope',
      };
    }
    // Last line of defence: an English follow-up spoken during a Tamil interview is
    // unfair to the candidate, so it is discarded rather than read out. The main
    // interview simply continues, which is the safe outcome.
    if (language.script !== 'unknown' && detectScriptFamily(text) !== language.script) {
      return {
        shouldAsk: false,
        question: null,
        reason: `Generated follow-up was not written in ${language.name} and was discarded.`,
        confidence: 1,
        source: 'NONE',
        blockedReason: 'wrong_language',
      };
    }
    return {
      shouldAsk: true,
      question: text,
      reason: parsed.reason || 'Clarification requested to better understand the answer.',
      confidence: parsed.confidence,
      source: 'AI_GENERATED',
    };
  } catch (err) {
    return {
      shouldAsk: false,
      question: null,
      reason: `Follow-up generation unavailable (${(err as Error).message}).`,
      confidence: 1,
      source: 'NONE',
    };
  }
}

/** Exported so admin-authored follow-ups are validated through the identical path. */
export function evaluateFollowUp(text: string, ctx: FollowUpContext): { ok: boolean; reason: string | null } {
  if (!text || text.trim().length < 4) return { ok: false, reason: 'Follow-up is empty.' };
  if (text.length > 400) return { ok: false, reason: 'Follow-up is too long to be asked aloud.' };

  const prohibited = detectProhibitedTopics(text);
  if (prohibited.isProhibited) {
    return { ok: false, reason: `References a protected or sensitive topic (${prohibited.markers.join(', ')}).` };
  }
  // Belt-and-braces: re-check against the raw marker list, since the phrase table
  // normalises text differently from the marker scan.
  const lower = text.toLowerCase();
  const direct = PROHIBITED_TOPIC_MARKERS.find((m) => lower.includes(m.toLowerCase()));
  if (direct) return { ok: false, reason: `References a restricted topic (${direct}).` };

  if (!isFollowUpInScope(text, [ctx.jobTitle, ctx.questionCategory, ...ctx.questionKeywords, ...ctx.allowedTopics])) {
    return { ok: false, reason: 'Follow-up is not anchored to this job or question.' };
  }
  return { ok: true, reason: null };
}