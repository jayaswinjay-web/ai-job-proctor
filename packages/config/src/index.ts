export * from './dotenv.js';
import { z } from 'zod';

/**
 * Environment contract. Loaded and validated once at server boot; the process
 * refuses to start with an invalid configuration rather than failing later at
 * the worst possible moment (mid-interview, in front of a candidate).
 *
 * No secret ever leaves this module into the browser bundle.
 */

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const intFromEnv = (def: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int());

const floatFromEnv = (def: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number());

const csvLanguages = z
  .string()
  .default('en,hi,mr,ta')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(2)).min(1));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // ---- Database -----------------------------------------------------------
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // ---- HTTP ---------------------------------------------------------------
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: intFromEnv(4000),
  API_BASE_PATH: z.string().default('/api/v1'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  TRUST_PROXY: boolish.default(false),
  BODY_LIMIT_BYTES: intFromEnv(2_097_152),

  // ---- Auth ---------------------------------------------------------------
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  AUTH_ACCESS_TOKEN_TTL_MINUTES: intFromEnv(15),
  AUTH_REFRESH_TOKEN_TTL_HOURS: intFromEnv(12),
  AUTH_COOKIE_NAME: z.string().default('proctor_rt'),
  AUTH_COOKIE_SECURE: boolish.default(false),
  AUTH_MAX_FAILED_LOGINS: intFromEnv(8),
  AUTH_LOCKOUT_MINUTES: intFromEnv(15),
  AUTH_REQUIRE_TOTP: boolish.default(false),
  /** Bootstrap super-admin, created by the seed script only. */
  BOOTSTRAP_ADMIN_EMAIL: z.string().default('admin@example.org'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().default(''),

  // ---- Demo mode ----------------------------------------------------------
  /** When true, all AI providers resolve to deterministic local implementations. */
  DEMO_MODE: boolish.default(true),

  // ---- AI providers -------------------------------------------------------
  AI_API_KEY: z.string().default(''),
  AI_BASE_URL: z.string().default(''),
  AI_REQUEST_TIMEOUT_MS: intFromEnv(30_000),
  AI_MAX_RETRIES: intFromEnv(2),

  STT_PROVIDER: z
    .enum(['browser', 'mock', 'openai', 'whisper-http', 'deepgram', 'google'])
    .default('browser'),
  TTS_PROVIDER: z.enum(['browser', 'mock', 'openai', 'elevenlabs', 'google']).default('browser'),
  LLM_PROVIDER: z
    .enum(['mock', 'openai', 'anthropic', 'ollama', 'openai-compatible', 'livekit'])
    .default('mock'),
  EVALUATION_PROVIDER: z.enum(['rules', 'llm', 'hybrid']).default('hybrid'),

  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_TEMPERATURE: floatFromEnv(0.3),
  LLM_MAX_TOKENS: intFromEnv(1400),
  EVALUATION_MODEL: z.string().default('gpt-4o-mini'),
  EVALUATION_TEMPERATURE: floatFromEnv(0.1),

  // ---- Object storage -----------------------------------------------------
  OBJECT_STORAGE_ENDPOINT: z.string().default(''),
  OBJECT_STORAGE_BUCKET: z.string().default('proctor-media'),
  OBJECT_STORAGE_ACCESS_KEY: z.string().default(''),
  OBJECT_STORAGE_SECRET_KEY: z.string().default(''),
  OBJECT_STORAGE_REGION: z.string().default('us-east-1'),
  OBJECT_STORAGE_FORCE_PATH_STYLE: boolish.default(true),
  /** Local filesystem fallback so audio capture works with zero cloud setup. */
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  LOCAL_STORAGE_PATH: z.string().default('.storage'),

  // ---- Session / retention ------------------------------------------------
  SESSION_TIMEOUT_MINUTES: intFromEnv(30),
  KIOSK_RESET_DELAY_SECONDS: intFromEnv(20),
  RECORDING_RETENTION_DAYS: intFromEnv(90),
  TRANSCRIPT_RETENTION_DAYS: intFromEnv(365),
  CANDIDATE_DATA_RETENTION_DAYS: intFromEnv(365),
  SIGNED_URL_TTL_SECONDS: intFromEnv(300),

  // ---- Voice defaults -----------------------------------------------------
  SUPPORTED_LANGUAGES: csvLanguages,
  DEFAULT_LANGUAGE: z.string().default('en'),
  FALLBACK_LANGUAGE: z.string().default('en'),
  TTS_RATE: floatFromEnv(0.92),
  TTS_PITCH: floatFromEnv(1.0),
  TTS_VOLUME: floatFromEnv(1.0),
  TTS_SLOW_RATE: floatFromEnv(0.68),
  STT_SILENCE_TIMEOUT_SECONDS: intFromEnv(6),
  STT_MAX_ANSWER_SECONDS: intFromEnv(120),
  STT_MIN_CONFIDENCE: floatFromEnv(0.35),
  VAD_SILENCE_THRESHOLD_MS: intFromEnv(1200),
  VAD_MAX_SILENCE_MS: intFromEnv(12_000),
  BARGE_IN_ENABLED: boolish.default(true),

  // ---- Interview ----------------------------------------------------------
  INTERVIEW_RETRY_LIMIT: intFromEnv(2),
  INTERVIEW_MAX_DURATION_MINUTES: intFromEnv(45),
  FOLLOW_UP_MODE: z.enum(['DISABLED', 'LIMITED', 'ALLOWED']).default('LIMITED'),
  MAX_FOLLOW_UPS_PER_QUESTION: intFromEnv(1),

  // ---- Scoring ------------------------------------------------------------
  SCORING_STRICTNESS: z.enum(['LENIENT', 'BALANCED', 'STRICT']).default('BALANCED'),
  DEFAULT_PASSING_SCORE: floatFromEnv(60),
  SCORING_CONFIDENCE_FLOOR: floatFromEnv(0.4),
  REQUIRE_HUMAN_REVIEW_BELOW_CONFIDENCE: floatFromEnv(0.4),
  AUTO_RECOMMEND: boolish.default(true),

  // ---- Proctoring ---------------------------------------------------------
  PROCTOR_LEVEL: z.enum(['DISABLED', 'BASIC', 'STANDARD', 'ENHANCED']).default('BASIC'),
  PROCTOR_CAMERA_ENABLED: boolish.default(false),

  // ---- Privacy ------------------------------------------------------------
  PRIVACY_NOTICE_REQUIRED: boolish.default(true),
  JURISDICTION_NOTE: z
    .string()
    .default(
      'Retention periods are configurable per deployment. Confirm local labour, biometric/recording and data-protection law with counsel before production use.',
    ),
  IP_HASH_SALT: z.string().default(''),

  // ---- Kiosk --------------------------------------------------------------
  KIOSK_ID: z.string().default('default'),
  KIOSK_ENFORCE_FULLSCREEN: boolish.default(false),

  // ---- Rate limiting ------------------------------------------------------
  RATE_LIMIT_WINDOW_MS: intFromEnv(60_000),
  RATE_LIMIT_MAX: intFromEnv(600),

  // ---- LiveKit Cloud voice (thin-client architecture) ---------------------
  /**
   * Voice transport mode.
   *
   *  - `livekit` (default): the interview runs over LiveKit Cloud with a cloud AI
   *    agent. The kiosk is a thin audio terminal; it never runs STT/LLM/TTS itself.
   *  - `browser`: the legacy in-browser speech pipeline, for development only. It must
   *    be selected explicitly and is not the production interview path.
   */
  VOICE_MODE: z.enum(['livekit', 'browser']).default('livekit'),
  /** LiveKit Cloud project URL, e.g. wss://your-project.livekit.cloud */
  LIVEKIT_URL: z.string().default(''),
  /** Server-side only. Never exposed to the browser; used solely to sign access tokens. */
  LIVEKIT_API_KEY: z.string().default(''),
  LIVEKIT_API_SECRET: z.string().default(''),
  /**
   * OpenAI-compatible LiveKit Inference gateway used when LLM_PROVIDER=livekit.
   * Defaults to the public cloud gateway; override for self-hosted/staging.
   */
  LIVEKIT_INFERENCE_URL: z.string().default(''),
  /** Optional dedicated inference credentials; fall back to LIVEKIT_API_KEY/SECRET. */
  LIVEKIT_INFERENCE_API_KEY: z.string().default(''),
  LIVEKIT_INFERENCE_API_SECRET: z.string().default(''),
  /** How long a kiosk's LiveKit access token stays valid. Short by design. */
  LIVEKIT_TOKEN_TTL_MINUTES: intFromEnv(15),
  /** Dispatch name that routes a room to the correct cloud voice agent. */
  VOICE_AGENT_NAME: z.string().default('voicehire-interview'),
  /**
   * Shared secret the cloud agent presents when calling back into this backend.
   * Server-side only.
   */
  AGENT_API_KEY: z.string().default(''),
  /** Allow the legacy browser pipeline to be used when LiveKit is not configured (dev only). */
  ALLOW_BROWSER_VOICE_FALLBACK: boolish.default(false),
  /** Language the voice agent opens in. Tamil is the primary experience. */
  VOICE_DEFAULT_LANGUAGE: z.string().default('ta'),

  // ---- Observability ------------------------------------------------------
  SENTRY_DSN: z.string().default(''),
  HEALTHCHECK_PATH: z.string().default('/healthz'),
});

export type Env = z.infer<typeof envSchema>;

/** True when a LiveKit Cloud project is fully configured for token signing. */
export function livekitConfigured(env: Env): boolean {
  return Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
}

/**
 * True when the production voice-AI path is usable.
 *
 * The kiosk uses this to decide between the LiveKit thin-client flow and the explicit
 * "not configured" screen. It is deliberately strict: a partial LiveKit configuration is
 * treated as unconfigured rather than silently degrading.
 */
export function voiceAiConfigured(env: Env): boolean {
  if (env.VOICE_MODE !== 'livekit') return false;
  return livekitConfigured(env) && Boolean(env.AGENT_API_KEY);
}


export interface LoadEnvResult {
  env: Env;
  warnings: string[];
}

/**
 * Validates process.env. In development we allow a default AUTH_SECRET so the
 * project runs immediately; in production a default secret is a hard failure.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): LoadEnvResult {
  const warnings: string[] = [];
  const raw: Record<string, unknown> = { ...source };

  if (!raw.AUTH_SECRET || String(raw.AUTH_SECRET).length < 32) {
    if (source.NODE_ENV === 'production') {
      throw new Error('AUTH_SECRET must be set to at least 32 characters in production.');
    }
    warnings.push('AUTH_SECRET was not set; using an insecure development-only value.');
    raw.AUTH_SECRET = 'dev-only-insecure-auth-secret-change-me-0123456789';
  }
  if (raw.IP_HASH_SALT === undefined || raw.IP_HASH_SALT === '') {
    raw.IP_HASH_SALT = raw.AUTH_SECRET;
    warnings.push('IP_HASH_SALT not set; deriving from AUTH_SECRET.');
  }
  if (!raw.BOOTSTRAP_ADMIN_PASSWORD) {
    warnings.push('BOOTSTRAP_ADMIN_PASSWORD not set; seeding will generate a random password and print it once.');
  }
  if (raw.DEMO_MODE === 'true' || raw.DEMO_MODE === undefined) {
    warnings.push('DEMO_MODE is on: AI providers are local mocks and no external calls are made.');
  }
  const voiceMode = raw.VOICE_MODE ?? 'livekit';
  const hasLivekit = Boolean(raw.LIVEKIT_URL && raw.LIVEKIT_API_KEY && raw.LIVEKIT_API_SECRET && raw.AGENT_API_KEY);
  if (voiceMode === 'livekit' && !hasLivekit) {
    // In development the legacy browser pipeline stays available so the app keeps working
    // without cloud credentials; production refuses and shows the configuration error.
    if (source.NODE_ENV !== 'production' && raw.ALLOW_BROWSER_VOICE_FALLBACK === undefined) {
      raw.ALLOW_BROWSER_VOICE_FALLBACK = 'true';
    }
    warnings.push(
      'VOICE_MODE=livekit but LiveKit Cloud is not configured (LIVEKIT_URL/API_KEY/API_SECRET/AGENT_API_KEY). ' +
        (raw.ALLOW_BROWSER_VOICE_FALLBACK === 'true'
          ? 'Development fallback to the browser voice pipeline is enabled; this must not be used in production.'
          : 'The kiosk will show a configuration error rather than silently degrading.'),
    );
  }

  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return { env: parsed.data, warnings };
}

export function corsOrigins(env: Env): string[] {
  return env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}