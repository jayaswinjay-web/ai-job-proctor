import type { Env } from '@proctor/config';
import { AccessToken } from 'livekit-server-sdk';
import { AnthropicProvider, OllamaProvider, OpenAiCompatibleProvider } from './providers/llm-implementations.js';
import type { LlmProvider } from './providers/llm.js';
import { MockLlmProvider } from './providers/mock-llm.js';
import {
  DeepgramSpeechToTextProvider,
  MockSpeechToTextProvider,
  OpenAiSpeechToTextProvider,
  WhisperHttpProvider,
} from './providers/stt-implementations.js';
import type { SpeechToTextProvider } from './providers/stt.js';
import {
  ElevenLabsTextToSpeechProvider,
  GoogleTextToSpeechProvider,
  MockTextToSpeechProvider,
  OpenAiTextToSpeechProvider,
} from './providers/tts-implementations.js';
import type { TextToSpeechProvider } from './providers/tts.js';
import {
  HybridEvaluationProvider,
  LlmEvaluationProvider,
  RulesEvaluationProvider,
} from './providers/evaluation-implementations.js';
import type { EvaluationProvider } from './providers/evaluation.js';

/**
 * Provider registry.
 *
 * This is the single place where a vendor identifier becomes an implementation.
 * Application code receives only interfaces, so changing providers is a
 * deployment configuration change. Nothing above this layer knows a vendor name.
 */

export interface AiStack {
  llm: LlmProvider;
  stt: SpeechToTextProvider;
  tts: TextToSpeechProvider;
  evaluation: EvaluationProvider;
  /** True when every provider is local/deterministic. */
  fullyOffline: boolean;
  warnings: string[];
}

/** LiveKit Inference is OpenAI-compatible; this is the same gateway the voice agent uses. */
const DEFAULT_LIVEKIT_INFERENCE_URL = 'https://agent-gateway.livekit.cloud/v1';

/**
 * Mints the short-lived JWT LiveKit Inference expects, refreshing it before expiry.
 *
 * The gateway authenticates with an access token carrying the `inference.perform`
 * grant (see `@livekit/agents`). Tokens are deliberately short-lived, so a long-running
 * API process must re-mint rather than cache one forever.
 */
function createInferenceTokenFactory(apiKey: string, apiSecret: string): () => Promise<string> {
  const ttlSeconds = 600;
  let cached: { token: string; expiresAt: number } | null = null;
  return async () => {
    const now = Date.now();
    if (cached && cached.expiresAt - now > 60_000) return cached.token;
    const token = new AccessToken(apiKey, apiSecret, { identity: 'proctor-backend', ttl: ttlSeconds });
    token.addInferenceGrant({ perform: true });
    const jwt = await token.toJwt();
    cached = { token: jwt, expiresAt: now + ttlSeconds * 1000 };
    return jwt;
  };
}

export function buildLlmProvider(env: Env, overrides: Partial<Env> = {}): LlmProvider {
  const cfg = { ...env, ...overrides };
  const supported = parseLanguages(cfg.SUPPORTED_LANGUAGES);

  if (cfg.DEMO_MODE) {
    return new MockLlmProvider({
      supportedLanguages: supported,
      fallbackLanguage: cfg.FALLBACK_LANGUAGE,
      defaultModel: 'mock-deterministic-v1',
    });
  }

  const hasKey = Boolean(cfg.AI_API_KEY);
  switch (cfg.LLM_PROVIDER) {
    case 'livekit': {
      const apiKey = cfg.LIVEKIT_INFERENCE_API_KEY || cfg.LIVEKIT_API_KEY;
      const apiSecret = cfg.LIVEKIT_INFERENCE_API_SECRET || cfg.LIVEKIT_API_SECRET;
      if (!apiKey || !apiSecret) return warnMock('LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
      return new OpenAiCompatibleProvider({
        apiKey: '',
        apiKeyProvider: createInferenceTokenFactory(apiKey, apiSecret),
        baseUrl: cfg.LIVEKIT_INFERENCE_URL || DEFAULT_LIVEKIT_INFERENCE_URL,
        defaultModel: cfg.LLM_MODEL,
        timeoutMs: cfg.AI_REQUEST_TIMEOUT_MS,
        maxRetries: cfg.AI_MAX_RETRIES,
        providerName: 'livekit',
      });
    }
    case 'openai':
    case 'openai-compatible':
      if (!hasKey) return warnMock('LLM_API_KEY');
      return new OpenAiCompatibleProvider({
        apiKey: cfg.AI_API_KEY,
        baseUrl: cfg.AI_BASE_URL || 'https://api.openai.com/v1',
        defaultModel: cfg.LLM_MODEL,
        timeoutMs: cfg.AI_REQUEST_TIMEOUT_MS,
        maxRetries: cfg.AI_MAX_RETRIES,
        providerName: cfg.LLM_PROVIDER,
      });
    case 'anthropic':
      if (!hasKey) return warnMock('LLM_API_KEY');
      return new AnthropicProvider({
        apiKey: cfg.AI_API_KEY,
        baseUrl: cfg.AI_BASE_URL || undefined,
        defaultModel: cfg.LLM_MODEL,
        timeoutMs: cfg.AI_REQUEST_TIMEOUT_MS,
        maxRetries: cfg.AI_MAX_RETRIES,
      });
    case 'ollama':
      return new OllamaProvider({
        baseUrl: cfg.AI_BASE_URL || 'http://localhost:11434',
        defaultModel: cfg.LLM_MODEL || 'qwen2.5:7b-instruct',
        timeoutMs: cfg.AI_REQUEST_TIMEOUT_MS,
        maxRetries: cfg.AI_MAX_RETRIES,
      });
    case 'mock':
    default:
      return new MockLlmProvider({ supportedLanguages: supported, fallbackLanguage: cfg.FALLBACK_LANGUAGE });
  }
}

export function buildSttProvider(env: Env): SpeechToTextProvider {
  if (env.DEMO_MODE) {
    // The demo runs with no real recogniser: browser speech is unavailable offline and in
    // browsers that block it (Brave), so a spoken turn falls through to here. Returning a
    // fixed answer keeps the interview usable end to end instead of silently discarding
    // everything the candidate says.
    return new MockSpeechToTextProvider({
      defaultLanguage: env.DEFAULT_LANGUAGE,
      fallbackText: 'I have experience with this kind of work and I am ready to start.',
    });
  }
  switch (env.STT_PROVIDER) {
    case 'openai':
      return new OpenAiSpeechToTextProvider({
        apiKey: env.AI_API_KEY,
        baseUrl: env.AI_BASE_URL || undefined,
        model: 'gpt-4o-mini-transcribe',
        language: env.DEFAULT_LANGUAGE,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
        maxRetries: env.AI_MAX_RETRIES,
      });
    case 'whisper-http':
      return new WhisperHttpProvider({
        endpoint: env.AI_BASE_URL || 'http://localhost:8000/transcribe',
        apiKey: env.AI_API_KEY || undefined,
        language: env.DEFAULT_LANGUAGE,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
        maxRetries: env.AI_MAX_RETRIES,
      });
    case 'deepgram':
      return new DeepgramSpeechToTextProvider({
        apiKey: env.AI_API_KEY,
        language: env.DEFAULT_LANGUAGE,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
        maxRetries: env.AI_MAX_RETRIES,
      });
    case 'browser':
    case 'mock':
    default:
      // `browser` means the kiosk transcribes locally with the Web Speech API; the
      // server-side instance exists only as a fallback for kiosks without support.
      return new MockSpeechToTextProvider({ defaultLanguage: env.DEFAULT_LANGUAGE });
  }
}

export function buildTtsProvider(env: Env): TextToSpeechProvider {
  if (env.DEMO_MODE) return new MockTextToSpeechProvider();
  switch (env.TTS_PROVIDER) {
    case 'openai':
      return new OpenAiTextToSpeechProvider({
        apiKey: env.AI_API_KEY,
        baseUrl: env.AI_BASE_URL || undefined,
        model: 'gpt-4o-mini-tts',
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
        maxRetries: env.AI_MAX_RETRIES,
      });
    case 'elevenlabs':
      return new ElevenLabsTextToSpeechProvider({
        apiKey: env.AI_API_KEY,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
        maxRetries: env.AI_MAX_RETRIES,
      });
    case 'google':
      return new GoogleTextToSpeechProvider({
        apiKey: env.AI_API_KEY,
        timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
        maxRetries: env.AI_MAX_RETRIES,
      });
    case 'browser':
    case 'mock':
    default:
      return new MockTextToSpeechProvider();
  }
}

export function buildEvaluationProvider(env: Env, llm: LlmProvider): EvaluationProvider {
  if (env.DEMO_MODE) return new RulesEvaluationProvider();
  switch (env.EVALUATION_PROVIDER) {
    case 'rules':
      return new RulesEvaluationProvider();
    case 'llm':
      return new LlmEvaluationProvider(llm, env.EVALUATION_MODEL);
    case 'hybrid':
    default:
      return new HybridEvaluationProvider(llm, env.EVALUATION_MODEL);
  }
}

export function buildAiStack(env: Env): AiStack {
  const warnings: string[] = [];
  const llm = buildLlmProvider(env);
  const stt = buildSttProvider(env);
  const tts = buildTtsProvider(env);
  const evaluation = buildEvaluationProvider(env, llm);

  if (env.LLM_PROVIDER !== 'mock' && llm.isMock) warnings.push(`LLM fell back to the mock provider: ${llm.defaultModel}`);
  if (env.EVALUATION_PROVIDER === 'hybrid' && llm.isMock) {
    warnings.push('Hybrid evaluation requested but no LLM is configured; deterministic rubric scoring is in use.');
  }

  return {
    llm,
    stt,
    tts,
    evaluation,
    fullyOffline: llm.isMock && stt.isMock && tts.isMock,
    warnings,
  };
}

function warnMock(_field: string): MockLlmProvider {
  return new MockLlmProvider();
}

function parseLanguages(raw: string | readonly string[]): string[] {
  return (Array.isArray(raw) ? [...raw] : String(raw).split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);
}

/**
 * Runs an operation against the primary provider and, if it fails, against a
 * deterministic fallback. Used so a transient vendor outage degrades the *quality*
 * of an answer rather than destroying a live interview — the fallback marks its
 * result low-confidence, which routes the affected answer to human review instead
 * of silently trusting it.
 */
export async function withFallback<R>(
  primary: () => Promise<R>,
  fallback: () => Promise<R>,
  onFallback: (error: Error, phase: string) => void,
): Promise<{ result: R; degraded: boolean }> {
  try {
    return { result: await primary(), degraded: false };
  } catch (err) {
    const error = err as Error;
    onFallback(error, 'primary');
    try {
      return { result: await fallback(), degraded: true };
    } catch (fallbackErr) {
      onFallback(fallbackErr as Error, 'fallback');
      throw fallbackErr;
    }
  }
}