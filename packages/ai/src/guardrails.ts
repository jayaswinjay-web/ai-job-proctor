import { PROHIBITED_TOPIC_MARKERS, PROTECTED_ATTRIBUTES } from '@proctor/types';
import { randomBytes } from 'node:crypto';

/**
 * Guardrails for untrusted content.
 *
 * Threat model
 * ------------
 *  * A candidate's speech is fully untrusted. It must never be able to steer the
 *    system prompt, change scoring, or extract the hidden interviewer prompt.
 *  * Admin-authored questions and imported job descriptions are *semi-trusted*:
 *    they may be buggy or hostile (e.g. a payload pasted from a website), so they
 *    are validated and delimiter-isolated before reaching a model.
 *
 * Defence in depth (no single layer is relied upon)
 * --------------------------------------------------
 *  1. ARCHITECTURE  – untrusted text only ever appears inside a delimited DATA
 *     block whose nonce the model is told to ignore. Instructions live exclusively
 *     in the system channel.
 *  2. NORMALISATION – control characters, zero-width joiners, RTL overrides and
 *     delimiter look-alikes are stripped so a payload cannot hide a fake block end.
 *  3. DETECTION     – injection phrasings are detected and recorded as an event.
 *  4. OUTPUT        – every model reply is parsed against a zod schema. Free-form
 *     instructions in the input cannot produce free-form control in the output.
 *  5. POLICY        – prohibited topics and protected attributes are filtered both
 *     on the way in (admin authoring) and on the way out (generated follow-ups).
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;
const DELIMITER_LOOKALIKE = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export interface InjectionFinding {
  detected: boolean;
  patterns: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
}

const INJECTION_PATTERNS: ReadonlyArray<{ name: string; re: RegExp; severity: InjectionFinding['severity'] }> = [
  { name: 'ignore_instructions', re: /\b(ignore|disregard|forget|override)\b[^.!?]{0,40}\b(all\s+)?(previous|prior|above|earlier|preceding|system)\b[^.!?]{0,20}\b(instruction|prompt|rule|direction|context)s?\b/i, severity: 'high' },
  { name: 'reveal_prompt', re: /\b(reveal|show|print|repeat|output|disclose|expose|leak)\b[^.!?]{0,30}\b(your\s+)?(system\s+prompt|instructions|prompt|rules|scoring (criteria|rules|key)|rubric|hidden)\b/i, severity: 'high' },
  { name: 'instruction_override', re: /\b(you\s+are\s+now|from\s+now\s+on\s+you|new\s+instructions?|developer\s+mode|admin\s+mode|god\s+mode|jailbreak)\b/i, severity: 'high' },
  { name: 'score_manipulation', re: /\b(give|award|add)\b[^.!?]{0,20}\b(me\s+)?(a\s+|the\s+|full\s+|maximum\s+|100|perfect\s+|highest\s+)?(score|marks?|points?|grade|rating)\b[^.!?]{0,20}\b(100|full|max|perfect|pass|highest)\b/i, severity: 'high' },
  // The magnitude usually comes before the noun ("give me full marks"), but just as often
  // after it ("give me marks that are full"). Both orders are checked because only one
  // would otherwise slip through.
  { name: 'score_manipulation', re: /\b(give|award|add)\b[^.!?]{0,25}\b(full|maximum|perfect|highest|100)\b[^.!?]{0,15}\b(score|marks?|points?|grade|rating)\b/i, severity: 'high' },
  { name: 'role_hijack', re: /\b(act|pretend|roleplay|role-play|behave)\b[^.!?]{0,20}\b(as|like)\b[^.!?]{0,20}\b(a\s+)?(different|another|new|evil|unrestricted|uncensored)\b/i, severity: 'medium' },
  { name: 'system_role_marker', re: /(^|\n)\s*(system|assistant|developer)\s*[:>]/i, severity: 'medium' },
  { name: 'delimiter_injection', re: /<\|im_(start|end)\|>|\[\/?(INST|SYS)\]|<</i, severity: 'high' },
  { name: 'exfiltration', re: /\b(api[_ -]?key|secret|password|token|env(ironment)?\s+variable|database\s+url)\b/i, severity: 'medium' },
  { name: 'stop_command', re: /\b(stop|end|cancel|quit)\b[^.!?]{0,15}\b(interview|assessment|evaluation|session)\b/i, severity: 'low' },
];

/**
 * Removes only the characters used to *disguise* instructions.
 *
 * Delimiter and role-marker stripping is deliberately absent here. Those strings are what
 * two of the injection patterns look for, so removing them before detection would make the
 * patterns unreachable and let `<|im_start|>system …` pass as ordinary text. Detection
 * therefore runs on this form, and `sanitiseUntrusted` is applied afterwards.
 */
function stripDisguises(text: string): string {
  return text.replace(CONTROL_CHARS, '').replace(DELIMITER_LOOKALIKE, '').replace(/\r\n/g, '\n');
}

export function detectPromptInjection(text: string): InjectionFinding {
  const patterns: string[] = [];
  let severity: InjectionFinding['severity'] = 'none';
  // Detection sees the text with invisible characters removed but delimiters intact,
  // otherwise the delimiter and role-marker patterns could never match anything.
  const haystack = stripDisguises(text);
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(haystack)) {
      patterns.push(p.name);
      if (rank(p.severity) > rank(severity)) severity = p.severity;
    }
  }
  return { detected: patterns.length > 0, patterns: [...new Set(patterns)], severity };
}

function rank(s: InjectionFinding['severity']): number {
  return { none: 0, low: 1, medium: 2, high: 3 }[s];
}

/**
 * Strips characters used to disguise instructions, plus the exact delimiters
 * and role markers the prompt templates rely on. Length-capped.
 */
export function sanitiseUntrusted(text: string, maxLength = 8000): string {
  let out = stripDisguises(text);
  // Any angle-bracket run is treated as a candidate delimiter and removed, rather than
  // matching only the exact tag names. Enumerating them means a new prompt format
  // silently becomes injectable.
  out = out.replace(/<{1,3}\/?[A-Za-z_][^>]{0,80}>{0,3}/g, '');
  out = out.replace(/\[\/?(?:INST|SYS|ASSISTANT)\]/gi, '');
  out = out.replace(/(^|\n)\s*(system|assistant|developer)\s*:/gi, '$1');
  out = out.replace(/\n{4,}/g, '\n\n\n');
  if (out.length > maxLength) out = `${out.slice(0, maxLength)}\n[TRUNCATED]`;
  return out.trim();
}

export interface UntrustedBlockOptions {
  label: string;
  text: string;
  maxLength?: number;
}

/**
 * Wraps untrusted content in a nonce-delimited DATA block. The nonce is random
 * per call, so text copied from an earlier prompt (or from a public question
 * bank) cannot forge a closing delimiter.
 */
export function untrustedBlock({ label, text, maxLength = 4000 }: UntrustedBlockOptions): string {
  const nonce = randomBytes(9).toString('base64url');
  const body = sanitiseUntrusted(text, maxLength);
  return [
    `<<<UNTRUSTED_DATA id="${nonce}" kind="${label.replace(/[^a-z_]/gi, '')}">`,
    body,
    `<<<END_UNTRUSTED_DATA id="${nonce}">`,
  ].join('\n');
}

export interface ProhibitedTopicFinding {
  isProhibited: boolean;
  markers: string[];
  /** Human-readable reason shown to the admin, never to the candidate. */
  reason: string | null;
}

/**
 * Content policy for admin-authored questions, imported job descriptions and
 * AI-generated follow-ups. Only job-competence topics are permitted.
 */
export function detectProhibitedTopics(text: string): ProhibitedTopicFinding {
  const haystack = sanitiseUntrusted(text, 20000).toLowerCase();
  const markers = PROHIBITED_TOPIC_MARKERS.filter((m) => haystack.includes(m.toLowerCase()));
  if (markers.length === 0) return { isProhibited: false, markers: [], reason: null };
  return {
    isProhibited: true,
    markers: [...new Set(markers)],
    reason:
      'This text refers to protected or irrelevant personal characteristics. ' +
      'Interview questions must assess job competence only. Remove references to: ' +
      [...new Set(markers)].join(', '),
  };
}

/**
 * Blocks AI follow-ups that drift outside the configured scope. Applied to every
 * generated follow-up before it can be spoken to a candidate.
 */
export function isFollowUpInScope(followUpText: string, allowedContext: string[]): boolean {
  const topics = detectProhibitedTopics(followUpText);
  if (topics.isProhibited) return false;
  const hay = sanitiseUntrusted(followUpText, 2000).toLowerCase();
  const contextHay = allowedContext.join(' ').toLowerCase();
  const contentWords = hay
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4);
  if (contentWords.length === 0) return false;
  const anchored = contentWords.filter((w) => contextHay.includes(w)).length;
  // Require at least some lexical anchoring to the job, or an explicit wh-question
  // that a model produced from the supplied guidance.
  return anchored >= 1 || /\b(what|which|how|when|where|why|tell me|describe)\b/.test(hay);
}

/** Strips protected-attribute words from any string that will be shown to a human. */
export function redactProtectedAttributes(text: string): string {
  let out = text;
  for (const attr of PROTECTED_ATTRIBUTES) {
    out = out.replace(new RegExp(`\\b${attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[not assessed]');
  }
  return out;
}

export interface SafetyReviewResult {
  safe: boolean;
  issues: string[];
  injection: InjectionFinding;
}

/** Composite gate run by the admin question validator before a question goes live. */
export function reviewQuestionContent(fields: {
  text: string;
  expectedAnswerGuidance: string;
  evaluationInstructions: string;
  scoringCriteriaLabels: string[];
  jobTitle?: string;
}): SafetyReviewResult {
  const issues: string[] = [];
  const combined = [
    fields.text,
    fields.expectedAnswerGuidance,
    fields.evaluationInstructions,
    ...fields.scoringCriteriaLabels,
  ].join('\n');

  const topics = detectProhibitedTopics(combined);
  if (topics.isProhibited && topics.reason) issues.push(topics.reason);

  const injection = detectPromptInjection(combined);
  if (injection.detected) {
    issues.push(
      `Text contains instruction-like content (${injection.patterns.join(', ')}). Interview content must not contain instructions to the AI.`,
    );
  }
  if (fields.text.trim().length < 5) issues.push('Question text is too short to be answered.');
  if (/\?\s*$/.test(fields.text.trim()) === false && fields.text.trim().length > 0) {
    // Not fatal: statements are legitimate for screening prompts.
  }

  return { safe: issues.length === 0, issues, injection };
}