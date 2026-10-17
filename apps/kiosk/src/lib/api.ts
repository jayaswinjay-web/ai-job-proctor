/**
 * Typed kiosk API client.
 *
 * Responsibilities kept deliberately narrow:
 *  - never throw a raw network error at the UI; every failure becomes a `KioskError`
 *    carrying a candidate-safe message
 *  - retry idempotent reads automatically, because kiosks lose connectivity often
 *  - surface the server's error id so a candidate-visible message can be traced
 */

import { readKioskId } from './storage.js';

const BASE = '/api/v1';

/**
 * Headers every kiosk request carries.
 *
 * The stable kiosk id lets the server match an interrupted interview to this device and
 * offer it back after a reload. Without it the server falls back to an address-derived id,
 * which never matches the id the session was created under, so resume silently never
 * happens.
 */
function baseHeaders(): Record<string, string> {
  const kioskId = readKioskId();
  return kioskId ? { 'x-kiosk-id': kioskId } : {};
}

export class KioskError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly errorId: string | null = null,
  ) {
    super(message);
    this.name = 'KioskError';
  }
}

export interface BootstrapPayload {
  siteName: string;
  demoMode: boolean;
  providers: { stt: string; tts: string };
  languages: Array<{ code: string; name: string; nativeName: string; sttLocale: string | null; ttsVoiceHint: string | null }>;
  jobs: Array<{ id: string; title: string; description: string; location: string; department: string; languages: string[]; questionCount: number; durationMinutes: number }>;
  privacyNoticeRequired: boolean;
  /** Preselected on the language screen; comes from the server's general settings. */
  defaultLanguage: string;
  consentPhraseKey: string | null;
  jurisdictionNote: string;
  kiosk: {
    kioskId: string;
    sessionTimeoutMinutes: number;
    preventRefresh: boolean;
    clearLocalDataOnReset: boolean;
    autoStartAudio: boolean;
    requireWakeWord: boolean;
    accessibility: { reducedMotion: boolean; highContrast: boolean; largeText: boolean };
  };
  voice: {
    rate: number;
    pitch: number;
    volume: number;
    slowRate: number;
    interruptible: boolean;
    bargeInEnabled: boolean;
    maxAnswerSeconds: number;
    silenceTimeoutSeconds: number;
  };
  scoring: { discloseScoreToCandidate: boolean; passingScore: number };
  resetDelaySeconds: number;
  sessionTimeoutMinutes: number;
  demoScriptEnabled: boolean;
  resume: {
    sessionId: string;
    publicId: string;
    state: string;
    jobTitle: string;
    questionIndex: number;
    totalQuestions: number;
  } | null;
  /**
   * Voice transport the kiosk should use.
   *
   * `configured` is false when LiveKit Cloud or the agent key is missing; the kiosk then
   * shows an explicit configuration error rather than pretending to work (spec §29).
   */
  voiceAi: {
    mode: 'livekit' | 'browser';
    configured: boolean;
    defaultLanguage: string;
    livekitUrl: string | null;
    agentName: string;
    allowBrowserFallback: boolean;
  };
}

export interface VoiceTokenPayload {
  url: string;
  roomName: string;
  identity: string;
  token: string;
  expiresInSeconds: number;
  agentName: string;
  languageCode?: string;
  defaultLanguage?: string;
}

export interface Directive {
  text: string;
  phraseKey?: string;
  emotion: 'neutral' | 'encouraging' | 'listening' | 'gentle_retry';
  displayText: string | null;
  slowRate: boolean;
  sequence: number;
}

export interface TurnPayload {
  state: string;
  stage: string;
  directives: Directive[];
  progress: { answered: number; total: number; stage: string; label: string | null };
  terminal: 'COMPLETED' | 'FAILED' | 'CANCELLED' | null;
  recoveryNotice?: string;
  stepAbandoned: boolean;
  meta: {
    isCommand: boolean;
    command: string | null;
    retryKind: 'UNINTELLIGIBLE' | 'CONFIDENCE' | null;
    retriesRemaining: number;
    degraded: boolean;
  };
}

async function request<T>(path: string, init: RequestInit & { retries?: number } = {}): Promise<T> {
  const { retries = 0, ...rest } = init;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(`${BASE}${path}`, {
          ...rest,
          headers: { ...baseHeaders(), ...(rest.headers as Record<string, string> | undefined) },
          signal: controller.signal,
        });
        const text = await res.text();
        let body: unknown = null;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = null;
          }
        }
        if (!res.ok) {
          const err = (body as { error?: { code?: string; message?: string; userMessage?: string; errorId?: string } } | null)?.error;
          throw new KioskError(
            err?.code ?? 'UNKNOWN',
            err?.userMessage ?? err?.message ?? 'Something went wrong.',
            res.status,
            err?.errorId ?? null,
          );
        }
        return body as T;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastError = err;
      if (err instanceof KioskError) throw err;
      if (attempt === retries) break;
      await sleep(400 * 2 ** attempt);
    }
  }

  throw new KioskError(
    'NETWORK',
    'The connection is temporarily lost. Please wait, we will continue.',
    0,
    null,
  );
  void lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function post<T>(path: string, body: unknown, retries = 0): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    retries,
  });
}

export const kioskApi = {
  bootstrap: () => request<BootstrapPayload>('/kiosk/bootstrap', { retries: 2 }),

  /** LiveKit token for the pre-interview intake conversation (job/language/tests/consent). */
  voiceIntakeToken: (kioskId: string) =>
    post<VoiceTokenPayload>('/kiosk/voice/intake-token', { kioskId }, 1),

  /** LiveKit token for an established interview session. */
  voiceSessionToken: (id: string, sessionSecret: string) =>
    post<VoiceTokenPayload>(`/kiosk/sessions/${id}/voice-token`, { sessionSecret }, 1),

  startSession: (body: { jobId: string; kioskId: string; languageCode?: string; consentGiven?: boolean; demoMode?: boolean }) =>
    post<{
      sessionId: string;
      publicId: string;
      sessionSecret: string;
      state: string;
      languageCode: string;
      totalQuestions: number;
      jobTitle: string;
      proctoring: {
        level: string;
        cameraEnabled: boolean;
        detectMultiplePeople: boolean;
        detectFacingAway: boolean;
        facingAwaySeconds: number;
        kioskFullscreenEnforced: boolean;
        snapshotOnEvent: boolean;
      };
    }>('/kiosk/sessions', body, 1),

  sessionState: (id: string) =>
    request<{ state: string; stage: string; answered: number; total: number; locked: boolean }>(
      `/kiosk/sessions/${id}`,
      { retries: 2 },
    ),

  /**
   * Server-side transcription fallback.
   *
   * Used when in-browser recognition is unavailable or has failed. The audio is sent as a
   * raw body so no multipart boundary is needed, and it is never persisted: the server
   * hands it to the configured STT provider and discards it.
   */
  transcribe: async (sessionId: string, sessionSecret: string, audio: Blob, language: string, signal?: AbortSignal) => {
    const res = await fetch(`${BASE}/kiosk/sessions/${sessionId}/transcribe?sessionSecret=${encodeURIComponent(sessionSecret)}&language=${encodeURIComponent(language)}`, {
      method: 'POST',
      headers: { 'content-type': audio.type || 'audio/webm', ...baseHeaders() },
      body: audio,
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new KioskError(
        'PROVIDER_ERROR',
        payload?.error?.message ?? 'The recording could not be understood.',
        res.status,
        null,
      );
    }
    return (await res.json()) as { text: string; language: string | null; confidence: number; durationMs: number; provider: string };
  },

  consent: (id: string, sessionSecret: string, given: boolean) =>
    post<TurnPayload>(`/kiosk/sessions/${id}/consent`, { sessionSecret, given }, 1),

  changeLanguage: (id: string, sessionSecret: string, languageCode: string) =>
    post<TurnPayload>(`/kiosk/sessions/${id}/language`, { sessionSecret, languageCode }, 1),

  turn: (
    id: string,
    sessionSecret: string,
    body: { transcript: string; spokenLanguage: string | null; confidence: number; durationMs: number },
  ) => post<TurnPayload>(`/kiosk/sessions/${id}/turns`, { sessionSecret, ...body }, 1),

  advance: (id: string, sessionSecret: string) => post<TurnPayload>(`/kiosk/sessions/${id}/advance`, { sessionSecret }, 1),

  finish: (id: string, sessionSecret: string) =>
    post<{ completed: boolean; revealScore: boolean; resetDelaySeconds: number }>(
      `/kiosk/sessions/${id}/finish`,
      { sessionSecret },
      2,
    ),

  cancel: (id: string, sessionSecret: string, reason?: string) =>
    post<{ cancelled: boolean }>(`/kiosk/sessions/${id}/cancel`, { sessionSecret, reason }, 0),

  proctor: (id: string, sessionSecret: string, body: Record<string, unknown>) =>
    post<{ accepted: boolean }>(`/kiosk/sessions/${id}/proctoring`, { sessionSecret, ...body }, 0),

  reportError: (body: { code: string; sessionId?: string; errorId?: string; context?: Record<string, unknown> }) =>
    post<{ ok: boolean; userMessage: string }>('/kiosk/report-error', body, 0),

  audioTicket: (id: string, sessionSecret: string, body: Record<string, unknown>) =>
    post<{ uploadUrl: string; objectKey: string; expiresAt: string; method: 'PUT'; headers: Record<string, string> }>(
      `/kiosk/sessions/${id}/audio/ticket`,
      { sessionSecret, ...body },
      1,
    ),

  uploadAudioDirect: async (
    id: string,
    sessionSecret: string,
    blob: Blob,
    durationMs: number,
    contentType: string,
  ): Promise<{ id: string; objectKey: string }> => {
    const params = new URLSearchParams({ sessionSecret, durationMs: String(durationMs) });
    const res = await fetch(`${BASE}/kiosk/sessions/${id}/audio?${params.toString()}`, {
      method: 'PUT',
      headers: { 'content-type': contentType, ...baseHeaders() },
      body: blob,
    });
    if (!res.ok) throw new KioskError('AUDIO_UPLOAD_FAILED', 'The recording could not be saved.', res.status);
    return (await res.json()) as { id: string; objectKey: string };
  },
};
