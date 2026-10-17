import { z } from 'zod';

/**
 * Provider-agnostic LLM contract.
 *
 * Application code depends only on this interface. Swapping OpenAI for Anthropic,
 * Ollama or an on-prem model is a config change, never a code change.
 */

export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Logical operation the caller is performing, e.g. `evaluate_answer`.
   * Mock providers use it to produce deterministic but plausible output; real
   * providers ignore it. Never derived from user input.
   */
  task?: string;
  /**
   * JSON Schema the response must satisfy. Providers that support native
   * structured output should use it; the rest fall back to prompt+JSON repair.
   */
  responseSchema?: Record<string, unknown>;
  /** Correlation id used in logs. Never contains candidate content. */
  traceId?: string;
  signal?: AbortSignal;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmResponse {
  text: string;
  finishReason?: string;
  usage?: LlmUsage;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly defaultModel: string;
  /** True when the provider is deterministic and requires no credentials. */
  readonly isMock: boolean;
  complete(request: LlmRequest): Promise<LlmResponse>;
  /** Cheap reachability probe used by /healthz. Must not perform real inference. */
  health(): Promise<{ ok: boolean; detail?: string }>;
}

/** Shared helper: parse an LLM reply that was asked to return JSON. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through to bracket scanning */
  }
  const firstObj = candidate.indexOf('{');
  const firstArr = candidate.indexOf('[');
  const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) throw new Error('No JSON found in model output');
  const openChar = candidate[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const ch = candidate[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error('Unterminated JSON in model output');
}

export function parseStructured<T extends z.ZodTypeAny>(text: string, schema: T): z.infer<T> {
  const parsed = parseJsonLoose(text);
  const result = schema.safeParse(parsed);
  if (result.success) return result.data;
  // One tolerant retry pass: coerce numeric strings, which smaller models emit often.
  const coerced = schema.safeParse(coerceTypes(parsed));
  if (coerced.success) return coerced.data;
  throw new Error(`Model output failed schema validation: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
}

function coerceTypes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(coerceTypes);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) {
        const n = Number(v);
        out[k] = Number.isInteger(n) ? n : n;
      } else out[k] = coerceTypes(v);
    }
    return out;
  }
  return value;
}