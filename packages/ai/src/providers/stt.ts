import { z } from 'zod';

/**
 * Provider-agnostic speech-to-text contract.
 *
 * Note on deployment: the default `browser` provider uses the Web Speech API and
 * therefore needs no API key and no outbound audio traffic — the right choice for
 * kiosks in low-connectivity sites and for jurisdictions that forbid shipping
 * candidate audio to a third party. Server providers are available behind the
 * same interface when higher accuracy or server-side diarisation is required.
 */

export interface SttTranscribeOptions {
  language?: string | null;
  /** BCP-47 hint; providers map this onto their own locale identifiers. */
  locale?: string | null;
  /** Free-form hints, e.g. job keywords that bias a keyword-based recogniser. */
  vocabularyHints?: string[];
  previousText?: string;
  signal?: AbortSignal;
  traceId?: string;
}

export interface SttTranscript {
  text: string;
  language: string | null;
  confidence: number;
  durationMs: number;
  provider: string;
  /** Per-utterance segments when the provider can supply them. */
  segments?: Array<{ startMs: number; endMs: number; text: string; confidence: number }>;
}

export interface SpeechToTextProvider {
  readonly name: string;
  readonly isMock: boolean;
  /**
   * True when recognition runs on the client. The kiosk uses this to know it must
   * not also stream audio to the server for transcription.
   */
  readonly runsInBrowser: boolean;
  transcribe(audio: Buffer, options?: SttTranscribeOptions): Promise<SttTranscript>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

export const sttTranscriptSchema = z.object({
  text: z.string(),
  language: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  durationMs: z.number().int().min(0),
  provider: z.string(),
});

/**
 * Deterministic identifier heuristic for STT engines (Whisper, Deepgram) that
 * only report a language code. Maps ISO-639-1 codes onto our supported set.
 */
export function normalizeLanguageCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  const map: Record<string, string> = {
    en: 'en',
    'en-us': 'en',
    'en-gb': 'en',
    eng: 'en',
    english: 'en',
    hi: 'hi',
    'hi-in': 'hi',
    hin: 'hi',
    hindi: 'hi',
    mr: 'mr',
    'mr-in': 'mr',
    mar: 'mr',
    marathi: 'mr',
    ta: 'ta',
    'ta-in': 'ta',
    tam: 'ta',
    tamil: 'ta',
  };
  return map[lower] ?? map[lower.split(/[-_]/)[0] ?? ''] ?? lower.split(/[-_]/)[0] ?? null;
}