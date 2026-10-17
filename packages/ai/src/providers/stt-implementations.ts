import {
  normalizeLanguageCode,
  type SpeechToTextProvider,
  type SttTranscribeOptions,
  type SttTranscript,
} from './stt.js';
import { httpRequest } from '../http.js';

export interface MockSttConfig {
  defaultLanguage?: string;
  /**
   * Optional scripted responses, consumed in order. Lets integration tests and
   * offline demos drive the pipeline with exact transcripts and confidences.
   */
  script?: Array<{ text: string; language?: string; confidence?: number }>;
  /**
   * Returned once the script is exhausted and the audio carries no inline text.
   *
   * Only ever set for the offline demo, where there is no real recogniser to hear the
   * candidate. Left unset everywhere else so tests still exercise the unintelligible path
   * rather than being handed invented words.
   */
  fallbackText?: string;
  defaultConfidence?: number;
}

/**
 * Deterministic STT double.
 *
 * If the audio buffer is a JSON document (`{"text": "..."}`) it is used verbatim —
 * this is how the automated end-to-end interview test drives the real engine.
 * Otherwise a scripted response is consumed, and finally an empty transcript with
 * zero confidence is returned so callers exercise their "unintelligible" path
 * rather than inventing words.
 */
export class MockSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = 'mock';
  readonly isMock = true;
  readonly runsInBrowser = false;
  private queue: Array<{ text: string; language?: string; confidence?: number }>;

  constructor(private readonly config: MockSttConfig = {}) {
    this.queue = [...(config.script ?? [])];
  }

  push(response: { text: string; language?: string; confidence?: number }): void {
    this.queue.push(response);
  }

  async transcribe(audio: Buffer, options: SttTranscribeOptions = {}): Promise<SttTranscript> {
    const text = extractInlineText(audio) ?? this.queue.shift()?.text ?? this.config.fallbackText ?? '';
    const language =
      options.language ?? normalizeLanguageCode(options.locale) ?? this.config.defaultLanguage ?? null;
    const confidence =
      extractInlineConfidence(audio) ?? this.queue[0]?.confidence ?? this.config.defaultConfidence ?? (text ? 0.75 : 0);

    return {
      text: text.trim(),
      language,
      confidence,
      durationMs: Math.round((audio.byteLength / 32_000) * 1000),
      provider: this.name,
    };
  }

  async health() {
    return { ok: true, detail: 'mock STT' };
  }
}

function extractInlineText(audio: Buffer): string | null {
  const head = audio.byteLength > 4096 ? audio.subarray(0, 4096) : audio;
  const s = head.toString('utf8');
  if (!s.trimStart().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(audio.toString('utf8')) as { text?: string };
    return typeof parsed.text === 'string' ? parsed.text : null;
  } catch {
    return null;
  }
}

function extractInlineConfidence(audio: Buffer): number | null {
  try {
    const parsed = JSON.parse(audio.toString('utf8')) as { confidence?: number };
    return typeof parsed.confidence === 'number' ? parsed.confidence : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */

export interface OpenAiSttConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  language?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
}

interface WhisperResponse {
  text?: string;
  language?: string;
  segments?: Array<{ start: number; end: number; text: string; avg_logprob?: number; no_speech_prob?: number }>;
}

/**
 * OpenAI audio transcription (`gpt-4o-mini-transcribe` or `whisper-1`).
 * Audio is uploaded as multipart because that is the shape the API expects.
 */
export class OpenAiSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = 'openai';
  readonly isMock = false;
  readonly runsInBrowser = false;

  constructor(private readonly config: OpenAiSttConfig) {}

  async transcribe(audio: Buffer, options: SttTranscribeOptions = {}): Promise<SttTranscript> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/webm' }), 'audio.webm');
    form.append('model', this.config.model ?? 'gpt-4o-mini-transcribe');
    form.append('response_format', 'verbose_json');
    const language = options.language ?? this.config.language;
    if (language) form.append('language', language.split('-')[0]!);

    const base = (this.config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30_000);
    try {
      const res = await fetch(`${base}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        signal: options.signal ?? controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`OpenAI STT failed (${res.status}): ${body.slice(0, 300)}`);
      }
      const data = (await res.json()) as WhisperResponse;
      const noSpeech = (data.segments ?? []).reduce((m, s) => Math.max(m, s.no_speech_prob ?? 0), 0);
      const confidence = Math.max(0, Math.min(1, 1 - noSpeech));
      return {
        text: (data.text ?? '').trim(),
        language: normalizeLanguageCode(data.language ?? language ?? null),
        confidence,
        durationMs: Math.round(((data.segments ?? []).at(-1)?.end ?? 0) * 1000),
        provider: this.name,
        segments: (data.segments ?? []).map((s) => ({
          startMs: Math.round(s.start * 1000),
          endMs: Math.round(s.end * 1000),
          text: s.text,
          confidence: Math.max(0, Math.min(1, 1 - (s.no_speech_prob ?? 0))),
        })),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async health() {
    return this.config.apiKey ? { ok: true } : { ok: false, detail: 'AI_API_KEY not configured' };
  }
}

/* -------------------------------------------------------------------------- */

export interface WhisperHttpConfig {
  endpoint: string;
  apiKey?: string;
  model?: string;
  language?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
}

interface WhisperHttpResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start?: number; end?: number; text?: string; confidence?: number; avg_logprob?: number }>;
}

/**
 * Self-hosted faster-whisper / whisper.cpp HTTP server. The deployment path for
 * air-gapped kiosks where audio must never leave the site.
 */
export class WhisperHttpProvider implements SpeechToTextProvider {
  readonly name = 'whisper-http';
  readonly isMock = false;
  readonly runsInBrowser = false;

  constructor(private readonly config: WhisperHttpConfig) {}

  async transcribe(audio: Buffer, options: SttTranscribeOptions = {}): Promise<SttTranscript> {
    const data = await httpRequest<WhisperHttpResponse>({
      url: this.config.endpoint,
      headers: this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {},
      body: {
        audio: audio.toString('base64'),
        model: this.config.model ?? 'whisper-1',
        language: options.language ?? this.config.language ?? null,
        task: 'transcribe',
        response_format: 'verbose_json',
        temperature: 0,
      },
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      signal: options.signal,
    });

    const segments = (data.segments ?? []).map((s) => ({
      startMs: Math.round((s.start ?? 0) * 1000),
      endMs: Math.round((s.end ?? 0) * 1000),
      text: (s.text ?? '').trim(),
      confidence: Math.max(0, Math.min(1, s.confidence ?? 1 - (s.avg_logprob ?? -0.2))),
    }));

    return {
      text: (data.text ?? segments.map((s) => s.text).join(' ')).trim(),
      language: normalizeLanguageCode(data.language ?? options.language ?? null),
      confidence: segments.length ? segments.reduce((s, x) => s + x.confidence, 0) / segments.length : 0.7,
      durationMs: Math.round((data.duration ?? (segments.at(-1)?.endMs ?? 0)) * 1000),
      provider: this.name,
      segments,
    };
  }

  async health() {
    try {
      const res = await fetch(this.config.endpoint, { method: 'OPTIONS', signal: AbortSignal.timeout(2500) });
      return { ok: res.status < 500, detail: `status ${res.status}` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}

/* -------------------------------------------------------------------------- */

export interface DeepgramConfig {
  apiKey: string;
  model?: string;
  language?: string | null;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

interface DeepgramResponse {
  metadata?: { language?: string };
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string; confidence?: number; words?: Array<{ word: string; start: number; end: number }> }>;
    }>;
    utterances?: Array<{ start?: number; end?: number; transcript?: string; confidence?: number }>;
  };
}

/** Deepgram Nova-3 with keyword boosting, which materially improves low-resource-language accuracy. */
export class DeepgramSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = 'deepgram';
  readonly isMock = false;
  readonly runsInBrowser = false;

  constructor(private readonly config: DeepgramConfig) {}

  async transcribe(audio: Buffer, options: SttTranscribeOptions = {}): Promise<SttTranscript> {
    const language = options.language ?? this.config.language ?? 'en';
    const params = new URLSearchParams({
      model: this.config.model ?? 'nova-3',
      language,
      smart_format: 'true',
      punctuate: 'true',
      utterances: 'true',
      detect_language: 'true',
    });
    if (options.vocabularyHints?.length) {
      params.set('keyterm', options.vocabularyHints.slice(0, 20).join(','));
    }
    const base = (this.config.baseUrl ?? 'https://api.deepgram.com/v1').replace(/\/$/, '');

    const data = await httpRequest<DeepgramResponse>({
      url: `${base}/listen?${params.toString()}`,
      headers: {
        authorization: `Token ${this.config.apiKey}`,
        'content-type': 'audio/webm',
      },
      body: audio.toString('base64'),
      timeoutMs: this.config.timeoutMs,
      maxRetries: this.config.maxRetries,
      signal: options.signal,
    });

    const alt = data.results?.channels?.[0]?.alternatives?.[0];
    const utterances = data.results?.utterances ?? [];
    return {
      text: (alt?.transcript ?? utterances.map((u) => u.transcript ?? '').join(' ')).trim(),
      language: normalizeLanguageCode(data.metadata?.language ?? language),
      confidence: Math.max(0, Math.min(1, alt?.confidence ?? utterances[0]?.confidence ?? 0.7)),
      durationMs: utterances.length ? Math.round((utterances.at(-1)!.end ?? 0) * 1000) : 0,
      provider: this.name,
      segments: utterances.map((u) => ({
        startMs: Math.round((u.start ?? 0) * 1000),
        endMs: Math.round((u.end ?? 0) * 1000),
        text: (u.transcript ?? '').trim(),
        confidence: u.confidence ?? 0.7,
      })),
    };
  }

  async health() {
    return this.config.apiKey ? { ok: true } : { ok: false, detail: 'AI_API_KEY not configured' };
  }
}