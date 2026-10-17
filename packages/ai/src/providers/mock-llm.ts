import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse } from './llm.js';
import { normaliseDigits, detectLanguage } from '../language.js';

/**
 * Deterministic in-process LLM.
 *
 * Purpose
 * -------
 *  1. Runs the *entire* product with zero API credentials so the acceptance flow
 *     in the specification is genuinely executable end to end.
 *  2. Gives tests a fast, stable, reproducible "AI" whose behaviour never drifts.
 *  3. Acts as the failover target when a configured provider fails, so an
 *     interview is never lost because a vendor was briefly unavailable.
 *
 * It is honest about being a mock: every response is tagged, and the UI labels
 * demo data as demo data. It is *not* a language model and must never be used to
 * make real hiring decisions — the evaluation layer treats mock output as
 * low-confidence and routes such sessions to human review.
 */

export interface MockLlmOptions {
  supportedLanguages?: string[];
  fallbackLanguage?: string;
  defaultModel?: string;
  /** Deterministic pseudo-latency so the kiosk's "thinking" state is exercised. */
  latencyMs?: number;
}

/* -------------------------------------------------------------------------- */
/* Task-specific handlers                                                    */
/* -------------------------------------------------------------------------- */

const YES = new Set([
  'yes', 'yeah', 'yep', 'yup', 'haan', 'ha', 'hai', 'han', 'haa', 'ji', 'haa', 'theek hai', 'bilkul',
  'sure', 'ok', 'okay', 'of course', 'definitely', 'i did', 'i have', 'i can', 'i will', 'done',
  'अरे', 'हां', 'हा', 'है', 'कर', 'करी', 'सकतो', 'सकते', 'चालेल', 'ठीक', 'बरोबर', 'नक्की', 'हो',
  'होय', 'चालेल', 'स्के', 'करतो', 'मला', 'होते', 'आहे', 'हो', 'चालू', 'ठीक',
]);
const NO = new Set([
  'no', 'nope', 'nahi', 'nahin', 'na', 'never', 'not', 'i cannot', "i can't", 'i did not', "i don't",
  'नहीं', 'नही', 'न', 'ना', 'नाही', 'नकोणी', 'कधीच नाही', 'न करू', 'शक्य नाही', 'नसे', 'नसतो',
]);
const DONT_KNOW = new Set([
  "i don't know", 'i do not know', 'no idea', 'not sure', 'पता नहीं', 'पता नही', 'माहीत नाही',
  'ठाऊक नाही', 'मला माहीत नाही', 'याद नहीं', 'सांगता येत नाही',
]);

export function classifyAnswer(text: string): {
  kind: 'affirmative' | 'negative' | 'unknown' | 'dontknow' | 'unclear' | 'informative';
  confidence: number;
} {
  const norm = ` ${normaliseDigits(text).toLowerCase().replace(/[.!?]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const has = (set: Set<string>) => [...set].some((k) => norm.includes(` ${k} `) || norm.startsWith(` ${k} `) || norm.includes(` ${k}`));

  if (has(DONT_KNOW)) return { kind: 'dontknow', confidence: 0.85 };
  if (has(YES)) return { kind: 'affirmative', confidence: 0.8 };
  if (has(NO)) return { kind: 'negative', confidence: 0.8 };
  const words = norm.split(' ').filter(Boolean);
  if (words.length <= 2) return { kind: 'unclear', confidence: 0.45 };
  return { kind: 'informative', confidence: 0.6 };
}

/* -------------------------------------------------------------------------- */
/* JSON-schema-driven fallback generator                                     */
/* -------------------------------------------------------------------------- */

interface JsonSchemaLike {
  type?: string;
  properties?: Record<string, JsonSchemaLike>;
  items?: JsonSchemaLike;
  required?: string[];
  enum?: unknown[];
  anyOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
  const?: unknown;
  default?: unknown;
  description?: string;
  nullable?: boolean;
}

const FALLBACK_BY_TYPE: Record<string, unknown> = {
  string: '',
  number: 0,
  integer: 0,
  boolean: false,
  array: [],
  object: {},
};

function generateFromSchema(schema: JsonSchemaLike | undefined, depth = 0): unknown {
  if (!schema || depth > 6) return null;
  if (schema.const !== undefined) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  const variant = schema.anyOf?.[0] ?? schema.oneOf?.[0];
  if (variant) return generateFromSchema(variant, depth + 1);

  const type = schema.type ?? (schema.properties ? 'object' : 'string');
  if (type === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      out[key] = generateFromSchema(sub, depth + 1);
    }
    return out;
  }
  if (type === 'array') {
    return [generateFromSchema(schema.items, depth + 1)];
  }
  if (type === 'string' || type === 'number' || type === 'integer' || type === 'boolean') {
    return FALLBACK_BY_TYPE[type];
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                  */
/* -------------------------------------------------------------------------- */

export class MockLlmProvider implements LlmProvider {
  name = 'mock';
  readonly defaultModel: string;
  readonly isMock = true;
  private readonly supported: string[];
  private readonly fallback: string;
  private readonly latency: number;

  constructor(options: MockLlmOptions = {}) {
    this.supported = options.supportedLanguages ?? ['en', 'hi', 'mr', 'ta'];
    this.fallback = options.fallbackLanguage ?? 'en';
    this.defaultModel = options.defaultModel ?? 'mock-deterministic-v1';
    this.latency = options.latencyMs ?? 40;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    if (this.latency > 0) await new Promise((r) => setTimeout(r, this.latency));

    const userText = lastUserContent(request.messages);
    const systemText = request.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    void this.systemProbe(systemText);
    const payload = this.route(request, userText);

    return {
      text: JSON.stringify(payload),
      finishReason: 'stop',
      provider: this.name,
      model: this.defaultModel,
      latencyMs: Date.now() - started,
    };
  }

  /** Mock does not read the system prompt; retained for interface symmetry. */
  private systemProbe(_systemText: string): void {}

  private route(request: LlmRequest, userText: string): unknown {
    switch (request.task) {
      case 'detect_language': {
        const declared = readTag(userText, 'declaredLanguage');
        const spoken = stripTags(userText);
        const d = detectLanguage(spoken, {
          supported: this.supported,
          fallback: this.fallback,
          declared: declared || null,
        });
        return { language: d.language, confidence: d.confidence, script: d.script };
      }
      case 'extract_field':
        return extractField(userText, readTag(userText, 'field'));
      case 'interpret_answer': {
        const spoken = stripTags(userText);
        const c = classifyAnswer(spoken);
        return {
          classification: c.kind,
          confidence: c.confidence,
          gist: summariseMeaning(spoken),
          isComplete: spoken.trim().split(/\s+/).length >= 3,
        };
      }
      case 'generate_acknowledgement':
        return { text: acknowledgement(readTag(userText, 'name'), readTag(userText, 'kind')) };
      case 'evaluate_answer':
        return evaluateMock(userText);
      case 'generate_followup':
        return followupMock(userText);
      case 'summarize_report':
        return reportMock(userText);
      case 'suggest_questions':
        return suggestMock(userText);
      case 'safety_review':
        return { safe: true, issues: [] };
      default:
        return generateFromSchema(request.responseSchema as JsonSchemaLike | undefined);
    }
  }

  async health() {
    return { ok: true, detail: 'mock provider (deterministic, offline)' };
  }
}

/* -------------------------------------------------------------------------- */
/* Tag helpers — the mock reads a compact, machine-parsable data block         */
/* -------------------------------------------------------------------------- */

function lastUserContent(messages: LlmMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === 'user') return messages[i]!.content;
  }
  return messages.map((m) => m.content).join('\n');
}

function readTag(text: string, tag: string): string {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1]!.trim() : '';
}

function stripTags(text: string): string {
  return text.replace(/<[a-zA-Z]+>[\s\S]*?<\/[a-zA-Z]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------------------------------- */
/* Task generators                                                           */
/* -------------------------------------------------------------------------- */

const NAME_PREFIXES = [
  'my name is', 'myself', 'i am', 'this is', 'my name\'s', 'people call me', 'call me',
  'मेरा नाम', 'मैं', 'मी', 'माझं नाव', 'मला नाव', 'हे',
];

export function extractName(text: string): string | null {
  const norm = normaliseDigits(text).replace(/[।॥]/g, '.');
  for (const prefix of NAME_PREFIXES) {
    const re = new RegExp(`(?:^|[.!?,\\s])${escapeRe(prefix)}\\s+(.{2,40}?)(?:[.!?,\\s]|$)`, 'i');
    const m = norm.match(re);
    if (m && m[1]) {
      const candidate = cleanName(m[1]);
      if (candidate) return candidate;
    }
  }
  // Fallback: a short utterance containing no verb is probably just a name.
  const tokens = norm.split(/[.!?,\s]+/).filter(Boolean);
  if (tokens.length > 0 && tokens.length <= 3) {
    const joined = cleanName(tokens.join(' '));
    if (joined && !/\d/.test(joined) && joined.length >= 2) return joined;
  }
  return null;
}

function cleanName(raw: string): string | null {
  let s = raw
    .trim()
    .replace(/^(is|am|the)\s+/i, '')
    .replace(/\b(and|but|so|then|also)\b.*$/i, '')
    .replace(/[^\p{L}\p{M}'.\-\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const stopWords = /^(thank|thanks|hello|hi|yes|no|ok|okay|fine|good|sure|yes\s+do|worker|man|woman)$/i;
  if (!s || stopWords.test(s)) return null;
  if (s.split(' ').length > 4) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, half: 0.5,
  ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, nau: 9,
  das: 10, solah: 12, bees: 20,
  एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, सात: 7, आठ: 8, नौ: 9, दस: 10, बीस: 20,
  साल: 1, वर्ष: 1, years: 1, year: 1,
};

export function extractNumber(text: string): number | null {
  const norm = normaliseDigits(text);
  const digit = norm.match(/\b(\d{1,2})\b/);
  if (digit) {
    const n = Number(digit[1]);
    if (n >= 0 && n <= 80) return n;
  }
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`(?:^|\\s)${escapeRe(word)}(?:\\s|$)`, 'u').test(norm)) return value;
  }
  const words = norm.split(/[\s,]+/).filter((w) => w.length > 0);
  const joined = words.slice(0, 6).join(' ');
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (joined.toLowerCase().startsWith(`${word} `)) return value;
  }
  return null;
}

function extractField(text: string, field: string): Record<string, unknown> {
  const spoken = stripTags(text);
  switch (field.toLowerCase()) {
    case 'name': {
      const value = extractName(spoken);
      return { found: Boolean(value), value: value ?? '', normalizedValue: value ?? '', confidence: value ? 0.9 : 0.35 };
    }
    case 'age': {
      const n = extractNumber(spoken);
      const age = n !== null && n >= 14 && n <= 70 ? n : null;
      return { found: age !== null, value: age ?? 0, normalizedValue: age ?? 0, confidence: age !== null ? 0.85 : 0.3 };
    }
    case 'years_experience': {
      const n = extractNumber(spoken);
      const years = n !== null && n >= 0 && n <= 60 ? n : null;
      return { found: years !== null, value: years ?? 0, normalizedValue: years ?? 0, confidence: years !== null ? 0.8 : 0.3 };
    }
    case 'village': {
      const cleaned = spoken
        .replace(/^.*?(?:live|living|from|stay|staying|am in|is in)\s+/i, '')
        .replace(/[.!?]+\s*$/, '')
        .replace(/[^\p{L}\p{M}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const value = cleaned.length >= 2 ? cleaned : null;
      return { found: Boolean(value), value: value ?? '', normalizedValue: value ?? '', confidence: value ? 0.7 : 0.3 };
    }
    case 'work_preference': {
      const c = classifyAnswer(spoken);
      const full = /\b(full\s*time|fulltime|purna|पूरा\s*समय|पुर्ण\s*वेळ|संपूर्ण)\b/i.test(spoken);
      const part = /\b(part\s*time|parttime|अंश\s*समय|अर्ध\s*वेळ|आंशिक)\b/i.test(spoken);
      const value = full ? 'FULL_TIME' : part ? 'PART_TIME' : c.kind === 'affirmative' ? 'FULL_TIME' : c.kind === 'negative' ? 'PART_TIME' : '';
      return { found: Boolean(value), value, normalizedValue: value, confidence: full || part ? 0.85 : 0.4 };
    }
    case 'can_travel': {
      const c = classifyAnswer(spoken);
      const value = c.kind === 'affirmative' ? 'YES' : c.kind === 'negative' ? 'NO' : '';
      return { found: Boolean(value), value, normalizedValue: value, confidence: c.confidence };
    }
    default: {
      const value = spoken.slice(0, 200);
      return { found: value.length > 1, value, normalizedValue: value, confidence: 0.6 };
    }
  }
}

function summariseMeaning(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 160) return clean;
  return `${clean.slice(0, 157)}…`;
}

const ACK_VARIANTS: Record<string, string[]> = {
  informative: ['Thank you. I have noted your answer.', 'Thank you, that is helpful.', 'Okay, I have noted that.'],
  affirmative: ['Thank you.', 'Okay, thank you.', 'Good, thank you.'],
  negative: ['Okay. Thank you for telling me.', 'I understand. Thank you.'],
  unknown: ['That is okay.', 'No problem, thank you.'],
  dontknow: ['That is okay. It is not a problem to say you do not know.'],
  unclear: ['Thank you. Let us continue.'],
};

function acknowledgement(name: string, kind: string): string {
  const list = ACK_VARIANTS[kind] ?? ACK_VARIANTS.unclear!;
  const idx = hashString(`${name}:${kind}`) % list.length;
  const base = list[idx]!;
  return name ? base.replace('Thank you.', `Thank you, ${name}.`) : base;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/* -------------------------------------------------------------------------- */
/* Deterministic keyword-rubric evaluation                                  */
/* -------------------------------------------------------------------------- */

interface MockEvalCriterion {
  label: string;
  description: string;
  points: number;
  keywords: string[];
}

function parseCriteriaBlock(text: string): MockEvalCriterion[] {
  const block = text.match(/<criteria>([\s\S]*?)<\/criteria>/i)?.[1];
  if (!block) return [];
  const out: MockEvalCriterion[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^\[(?<label>[^\]]+)\]\s*(?<points>[\d.]+)\s*\|?\s*(?<desc>.*)$/);
    if (!m?.groups) continue;
    const label = m.groups.label!.trim();
    const desc = m.groups.desc ?? '';
    const points = Number(m.groups.points);
    out.push({
      label,
      description: desc,
      points: Number.isFinite(points) ? points : 1,
      keywords: [...label.toLowerCase().split(/\s+/), ...extractQuoted(desc)],
    });
  }
  return out;
}

function extractQuoted(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]{2,40})"|'([^']{2,40})'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push((m[1] ?? m[2] ?? '').toLowerCase());
  return out;
}

function tokenise(text: string): string[] {
  return normaliseDigits(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function evaluateMock(userText: string): Record<string, unknown> {
  const spoken = normaliseDigits(readTag(userText, 'answer')).toLowerCase();
  const isSkipped = readTag(userText, 'skipped') === 'true';
  const isDontKnow = readTag(userText, 'dontKnow') === 'true';
  const guidance = readTag(userText, 'guidance');
  const instructions = readTag(userText, 'instructions');
  const isScored = readTag(userText, 'scored') === 'true';
  const criteria = parseCriteriaBlock(userText);
  const scoreMax = Number(readTag(userText, 'scoreMax')) || 10;

  const spokenTokens = new Set(tokenise(spoken));
  const haystack = `${spoken} ${guidance}`.toLowerCase();

  const criterionScores = criteria.map((c) => {
    const kw = [...new Set([...c.keywords, ...tokenise(c.label)])].filter((k) => k.length > 2);
    const hitKeywords = kw.filter((k) => haystack.includes(k));
    // Fraction of the criterion's vocabulary present, damped so a single keyword
    // cannot produce full marks.
    const ratio = kw.length === 0 ? 0 : Math.min(1, hitKeywords.length / Math.max(2, Math.ceil(kw.length * 0.6)));
    const lengthBoost = Math.min(1, spokenTokens.size / 18);
    const points = round2(Math.max(c.points, 0) * (0.45 * ratio + 0.55 * ratio * lengthBoost));
    return {
      label: c.label,
      points,
      max: c.points,
      hitKeywords,
      reasoning:
        ratio === 0
          ? 'No evidence of this point in the answer.'
          : `Answer mentions ${hitKeywords.slice(0, 4).join(', ')}.`,
    };
  });

  const totalMax = criteria.reduce((s, c) => s + c.points, 0);
  const totalPoints = criterionScores.reduce((s, c) => s + (c.points as number), 0);
  let raw = totalMax > 0 ? (totalPoints / totalMax) * scoreMax : scoreMax * 0.4;

  const lenFactor = Math.min(1, spokenTokens.size / 20);
  raw = raw * (0.6 + 0.4 * lenFactor);

  if (!isScored) raw = 0;
  if (isSkipped || isDontKnow || spoken.trim().length < 2) {
    raw = 0;
    return {
      rawScore: 0,
      normalizedScore: 0,
      confidence: 0.6,
      evaluationReason: isDontKnow
        ? 'Candidate stated they do not know. Recorded without penalty framing.'
        : 'No answer provided for this question.',
      strengths: [],
      concerns: isSkipped ? ['Question not answered.'] : [],
      aiNotes: instructions ? `Evaluator instruction applied: ${instructions}` : 'Deterministic rubric scoring.',
      criterionScores: criterionScores.map((c) => ({ ...c, points: 0 })),
      missingCriteria: criteria.map((c) => c.label),
    };
  }

  const hitAll = criterionScores.filter((c) => (c.max as number) > 0 && (c.points as number) / (c.max as number) >= 0.4);
  const strengths = hitAll.slice(0, 3).map((c) => `${c.label}: evidence present`);
  const concerns = criterionScores
    .filter((c) => (c.points as number) === 0)
    .slice(0, 3)
    .map((c) => `${c.label}: not addressed`);

  return {
    rawScore: round2(raw),
    normalizedScore: round2(Math.min(100, (raw / scoreMax) * 100)),
    confidence: round2(Math.min(0.62, 0.28 + lenFactor * 0.3)),
    evaluationReason:
      criterionScores.length > 0
        ? `Awarded ${totalPoints.toFixed(1)} of ${totalMax.toFixed(1)} available rubric points across ${hitAll.length} of ${criteria.length} criteria.`
        : 'Short descriptive answer recorded. No explicit rubric criteria were configured for this question.',
    strengths,
    concerns,
    aiNotes: 'Scored by the deterministic demo evaluator against administrator-defined rubric criteria.',
    criterionScores,
    missingCriteria: criterionScores.filter((c) => (c.points as number) === 0).map((c) => c.label),
  };
}

/* -------------------------------------------------------------------------- */
/* Follow-ups, report, suggestions                                          */
/* -------------------------------------------------------------------------- */

function followupMock(userText: string): Record<string, unknown> {
  const allowed = parseList(readTag(userText, 'allowedFollowUps'));
  const category = readTag(userText, 'category');
  const answerKind = readTag(userText, 'answerKind');
  const scope = readTag(userText, 'scope');

  if (allowed.length > 0) {
    const idx = hashString(`${category}:${answerKind}:${allowed.join('|')}`) % allowed.length;
    return {
      shouldAsk: true,
      question: allowed[idx]!,
      reason: 'Administrator configured this follow-up for this category and answer type.',
      confidence: 0.8,
    };
  }

  const generic: Record<string, string[]> = {
    Experience: [`Can you tell me a little more about the work you did in ${scope || 'that job'}?`],
    Safety: ['What would you do to stay safe while doing this work?'],
    Knowledge: ['Can you explain how you would start this job on your first day?'],
    Eligibility: ['Are you able to work on the required days and times?'],
  };
  const pool = generic[category] ?? [`Can you tell me a little more about your experience with ${scope || 'this job'}?`];
  const idx = hashString(`${category}:${answerKind}`) % pool.length;
  return {
    shouldAsk: answerKind !== 'unclear',
    question: pool[idx]!,
    reason: 'Scoped clarification requested to better understand the answer.',
    confidence: 0.6,
  };
}

function reportMock(userText: string): Record<string, unknown> {
  const score = Number(readTag(userText, 'overallScore')) || 0;
  const name = readTag(userText, 'candidateName') || 'The candidate';
  const job = readTag(userText, 'jobTitle') || 'the role';
  const experience = readTag(userText, 'experienceSummary');
  const skillLines = readTag(userText, 'skillSummary')
    .split('\n')
    .filter(Boolean);

  const skills = skillLines.map((line) => {
    const m = line.match(/^(?<skill>[^:]+):\s*(?<score>[\d.]+)\s*\/\s*(?<max>[\d.]+)\s*(?:-\s*(?<evidence>.*))?$/);
    if (!m?.groups) return null;
    return {
      skill: m.groups.skill!.trim(),
      score: Number(m.groups.score),
      max: Number(m.groups.max),
      evidence: (m.groups.evidence ?? 'Derived from rubric scoring across job questions.').trim(),
    };
  }).filter((x): x is { skill: string; score: number; max: number; evidence: string } => x !== null);

  const strengths = skills.filter((s) => s.max > 0 && s.score / s.max >= 0.6).map((s) => `${humanise(s.skill)} (${Math.round((s.score / s.max) * 100)}%)`);
  const weaknesses = skills.filter((s) => s.max > 0 && s.score / s.max < 0.4).map((s) => `${humanise(s.skill)} (${Math.round((s.score / s.max) * 100)}%)`);

  return {
    summary: `${name} completed the ${job} screening with an overall score of ${score} out of 100.`,
    experienceSummary: experience || 'Experience was captured during the conversation and mapped against the job requirements.',
    strengths: strengths.length ? strengths : ['Completed every stage of the screening conversation.'],
    weaknesses: weaknesses.length ? weaknesses : ['No material gaps were identified in the assessed categories.'],
    concerns: [],
    recommendedNextAction:
      score >= 75
        ? 'Proceed to a human interview panel.'
        : score >= 55
          ? 'Proceed to a human review of the transcript before deciding.'
          : 'Do not progress at this stage; retain for future opportunities.',
    skills: skills.length
      ? skills
      : [{ skill: 'Relevant experience', score, max: 100, evidence: 'Aggregate score across all assessed questions.' }],
    methodology:
      'Weighted sum of per-question rubric scores, each decomposed into administrator-defined criteria. No protected characteristics were considered.',
  };
}

function humanise(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const SUGGESTION_TEMPLATES: Record<string, Array<{ text: string; criteria: Array<[string, string, string[]]> }>> = {
  Experience: [
    {
      text: 'Have you worked in a job like this before?',
      criteria: [['Relevant experience', 'Describes real work in a comparable role', ['worked', 'job', 'factory', 'years']]],
    },
    {
      text: 'Tell me about your previous work.',
      criteria: [
        ['Relevant experience', 'Work matches the role being screened', ['worked', 'experience', 'machine', 'team']],
        ['Understanding of responsibilities', 'Knows what the role involves day to day', ['duty', 'responsible', 'task', 'daily']],
      ],
    },
  ],
  'Job knowledge': [
    {
      text: 'What do you do if a machine makes an unusual sound?',
      criteria: [
        ['Practical understanding', 'Knows to stop and report the problem', ['stop', 'switch off', 'report', 'supervisor', 'maintenance']],
        ['Safety awareness', 'Treats unusual noise as a hazard', ['safety', 'danger', 'careful', 'accident']],
      ],
    },
    {
      text: 'How do you start your work safely each day?',
      criteria: [
        ['Safety awareness', 'Mentions protective equipment and checks', ['equipment', 'helmet', 'gloves', 'check', 'safe']],
        ['Reliability', 'Follows a routine without being told', ['daily', 'checklist', 'always', 'routine']],
      ],
    },
  ],
  Safety: [
    {
      text: 'What should you do if you see an accident at work?',
      criteria: [
        ['Safety awareness', 'Knows to stop work and get help', ['stop', 'call', 'help', 'first aid', 'report']],
        ['Practical understanding', 'Knows who to inform and how', ['supervisor', 'manager', 'emergency', 'number']],
      ],
    },
  ],
  Eligibility: [
    {
      text: 'Are you able to work on the required shift and days?',
      criteria: [['Availability', 'Can meet the schedule offered', ['yes', 'morning', 'evening', 'night', 'any time']]],
    },
  ],
};

function suggestMock(userText: string): Record<string, unknown> {
  const jobTitle = readTag(userText, 'jobTitle') || 'this role';
  const language = readTag(userText, 'language') || 'en';
  const count = Number(readTag(userText, 'count')) || 6;
  const categories = parseList(readTag(userText, 'categories'));
  const pool = categories.length
    ? categories.flatMap((c) => SUGGESTION_TEMPLATES[c] ?? [])
    : Object.values(SUGGESTION_TEMPLATES).flat();

  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i += 1) {
    const tpl = pool[i % pool.length]!;
    const category = categories.length ? categories[i % categories.length]! : tpl.text.length > 45 ? 'Job knowledge' : 'Experience';
    out.push({
      text: tpl.text,
      category,
      difficulty: i < count * 0.4 ? 'EASY' : i < count * 0.8 ? 'MEDIUM' : 'HARD',
      expectedAnswerGuidance: tpl.criteria.map(([, desc]) => desc).join(' '),
      keywords: [...new Set(tpl.criteria.flatMap(([, , kws]) => kws))].slice(0, 12),
      skillTags: [category.toUpperCase().replace(/\s+/g, '_')],
      weight: 10,
      scoreMax: 10,
      scoringCriteria: tpl.criteria.map(([label, desc, kws]) => ({
        label,
        description: desc,
        points: 5,
        keywords: kws,
      })),
      followUpRules: [
        {
          question: `Can you tell me more about your experience with ${jobTitle.toLowerCase()} work?`,
          trigger: 'ALWAYS',
          maxUses: 1,
          weight: 0,
          sortOrder: 0,
        },
      ],
      translations: language === 'en' ? [] : [],
      safetyNotes: 'Assesses job competence only. No protected characteristics referenced.',
    });
  }
  return { suggestions: out };
}

function parseList(raw: string): string[] {
  return raw
    .split(/\r?\n|;/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}