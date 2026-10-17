/**
 * Provider-agnostic text-to-speech contract.
 *
 * The default `browser` provider uses the platform SpeechSynthesis API: zero
 * latency, works offline, and lets an admin pick a locale-matched system voice on
 * the kiosk itself. Server providers plug in unchanged when a branded or
 * higher-fidelity voice is required.
 */

export interface TtsSynthesizeOptions {
  language: string;
  /** Locale hint for voice selection, e.g. "mr-IN". */
  locale?: string | null;
  voiceHint?: string | null;
  /** 0.4 – 1.8. Kiosk default is deliberately below 1 for low-literacy users. */
  rate?: number;
  pitch?: number;
  volume?: number;
  signal?: AbortSignal;
  traceId?: string;
}

export interface TtsAudio {
  audio: Buffer;
  contentType: string;
  provider: string;
  /** True when no server round-trip happened (client-side synthesis). */
  local: boolean;
}

export interface TextToSpeechProvider {
  readonly name: string;
  readonly isMock: boolean;
  readonly runsInBrowser: boolean;
  synthesize(text: string, options: TtsSynthesizeOptions): Promise<TtsAudio>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}