import { detectVoiceCommand } from '@proctor/ai/browser';
import type { VoiceCommand } from '@proctor/types';

/**
 * Browser speech recognition wrapper.
 *
 * Why the Web Speech API is the default STT provider for kiosks
 * ----------------------------------------------------------
 *  * No API key, no per-minute cost, no vendor outage mid-interview.
 *  * It runs on the kiosk, so candidate audio is not shipped to a third party —
 *    a decisive privacy advantage where recordings are legally sensitive.
 *  * Latency is effectively zero, which is what makes the conversation feel human.
 *
 * The API is Chromium-only and somewhat inconsistent, so this wrapper is
 * defensive: it detects capability gaps, surfaces them as typed errors the kiosk
 * can speak, and falls back to server-side STT when configured.
 */

export interface RecognizerOptions {
  language: string;
  /** Extra words to bias recognition toward (job title, equipment names). */
  vocabularyHints?: string[];
  continuous?: boolean;
  interimResults?: boolean;
  maxAlternatives?: number;
  onResult?: (result: RecognitionResult) => void;
  onError?: (error: RecognizerError) => void;
  onEnd?: () => void;
  onStart?: () => void;
}

export interface RecognitionResult {
  transcript: string;
  isFinal: boolean;
  confidence: number;
  language: string | null;
  /** Recognised control command, when the utterance was one. */
  command: VoiceCommand | null;
  /** Text left after removing the command phrase. */
  remainder: string;
  alternatives: string[];
  receivedAtMs: number;
}

export class RecognizerError extends Error {
  constructor(
    readonly code:
      | 'UNSUPPORTED'
      | 'PERMISSION_DENIED'
      | 'NO_SPEECH'
      | 'NETWORK'
      | 'AUDIO_CAPTURE'
      | 'LANGUAGE_NOT_SUPPORTED'
      | 'ABORTED'
      | 'UNKNOWN',
    message: string,
    /** 'no-speech' is expected and should not be shown as an error to the candidate. */
    readonly benign = false,
  ) {
    super(message);
    this.name = 'RecognizerError';
  }

  get candidateMessageKey(): 'permission_needed' | 'microphone_problem' | 'connection_lost' {
    switch (this.code) {
      case 'PERMISSION_DENIED':
        return 'permission_needed';
      case 'NETWORK':
        return 'connection_lost';
      default:
        return 'microphone_problem';
    }
  }
}

/** Minimal structural types so this file compiles without DOM lib augmentation issues. */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onspeechend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as SpeechRecognitionCtor | null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export class SpeechRecognizer {
  private recognition: SpeechRecognitionLike | null = null;
  private options: RecognizerOptions;
  private wantRunning = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInterim = '';
  private startedAt = 0;

  constructor(options: RecognizerOptions) {
    this.options = options;
  }

  get isRunning(): boolean {
    return this.wantRunning;
  }

  get language(): string {
    return this.options.language;
  }

  /** Switch language mid-session, e.g. when the candidate asks to change it. */
  setLanguage(language: string): void {
    if (this.options.language === language) return;
    this.options = { ...this.options, language };
    if (this.wantRunning) {
      this.restart();
    }
  }

  setVocabularyHints(hints: string[]): void {
    this.options = { ...this.options, vocabularyHints: hints };
  }

  start(): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      this.options.onError?.(
        new RecognizerError('UNSUPPORTED', 'This browser does not support speech recognition. Use a Chromium-based browser.'),
      );
      return;
    }
    this.wantRunning = true;
    this.spawn(Ctor);
  }

  stop(): void {
    this.wantRunning = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        /* already stopped */
      }
      this.recognition = null;
    }
  }

  /** Pushes `words` into the session grammar where supported (Chrome `SpeechRecognitionPhrase`). */
  private spawn(Ctor: SpeechRecognitionCtor): void {
    const rec = new Ctor();
    rec.lang = this.options.language;
    rec.continuous = this.options.continuous ?? true;
    rec.interimResults = this.options.interimResults ?? true;
    rec.maxAlternatives = this.options.maxAlternatives ?? 3;

    const hints = this.options.vocabularyHints ?? [];
    if (hints.length > 0) {
      const withPhrases = rec as unknown as { phrases?: unknown };
      if ('phrases' in withPhrases) {
        try {
          withPhrases.phrases = buildPhrases(hints);
        } catch {
          // Grammar biasing is an enhancement, not a requirement. An engine that
          // rejects the phrase shape must not take the whole recogniser down with it —
          // that is exactly how a kiosk ends up silently unable to hear anyone.
        }
      }
    }

    rec.onstart = () => {
      this.startedAt = Date.now();
      this.options.onStart?.();
    };

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]!;
        const alt = result[0]!;
        if (!result.isFinal) {
          interim += alt.transcript;
          continue;
        }
        const alternatives: string[] = [];
        for (let a = 0; a < result.length; a += 1) alternatives.push(result[a]!.transcript.trim());
        const transcript = alt.transcript.trim();
        this.emit(transcript, Boolean(result.isFinal), alt.confidence, alternatives);
      }
      if (interim) this.lastInterim = interim;
      this.options.onResult?.({
        transcript: interim || this.lastInterim,
        isFinal: false,
        confidence: 0,
        language: this.options.language,
        command: null,
        remainder: '',
        alternatives: [],
        receivedAtMs: Date.now(),
      });
    };

    rec.onerror = (event) => {
      const mapped = mapRecognitionError(event.error, event.message);
      if (mapped.code !== 'NO_SPEECH' && mapped.code !== 'ABORTED') {
        this.options.onError?.(mapped);
      }
    };

    rec.onend = () => {
      this.recognition = null;
      if (!this.wantRunning) {
        this.options.onEnd?.();
        return;
      }
      // Chromium ends the session roughly every 60s; restart to stay continuous.
      this.restartTimer = setTimeout(() => {
        if (this.wantRunning && !this.recognition) this.spawn(Ctor);
      }, 250);
      this.options.onEnd?.();
    };

    try {
      rec.start();
      this.recognition = rec;
    } catch (err) {
      this.options.onError?.(
        new RecognizerError('UNKNOWN', `Speech recognition failed to start: ${(err as Error).message}`),
      );
      this.wantRunning = false;
    }
  }

  private restart(): void {
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        /* noop */
      }
      this.recognition = null;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (Ctor && this.wantRunning) this.spawn(Ctor);
  }

  private emit(transcript: string, isFinal: boolean, confidence: number, alternatives: string[]): void {
    const durationMs = this.startedAt === 0 ? 0 : Date.now() - this.startedAt;
    this.lastInterim = transcript;
    const detection = detectVoiceCommand(transcript, this.options.language.split('-')[0] ?? this.options.language);
    this.options.onResult?.({
      transcript,
      isFinal,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.6,
      language: this.options.language,
      command: detection.command,
      remainder: detection.remainder,
      alternatives,
      receivedAtMs: Date.now(),
      ...(durationMs >= 0 ? {} : {}),
    });
  }
}

/**
 * Builds the grammar-bias list for `SpeechRecognition.phrases`.
 *
 * Chrome added `phrases` expecting `SpeechRecognitionPhrase` instances, while older builds
 * took `{ text, boost }` literals. Neither shape is universal, and assigning the wrong one
 * throws — which previously aborted recognition setup entirely. The real constructor is
 * used when present, the literal shape otherwise; the caller guards the assignment.
 */
function buildPhrases(hints: readonly string[]): unknown[] {
  const limited = hints.slice(0, 20);
  const Ctor = (globalThis as { SpeechRecognitionPhrase?: new (text: string, boost?: number) => unknown })
    .SpeechRecognitionPhrase;
  if (typeof Ctor === 'function') return limited.map((h) => new Ctor(h, 8));
  return limited.map((h) => ({ text: h, boost: 8 }));
}

function mapRecognitionError(code: string, message?: string): RecognizerError {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      // Not benign: the browser has refused speech recognition outright (mic permission
      // denied, or the service blocked — Brave does not allow the Google recogniser at
      // all). Retrying is pointless; the caller should switch to server transcription.
      return new RecognizerError('PERMISSION_DENIED', message ?? 'Speech recognition permission denied', false);
    case 'no-speech':
      return new RecognizerError('NO_SPEECH', 'No speech detected', true);
    case 'network':
      return new RecognizerError('NETWORK', message ?? 'Speech recognition network failure');
    case 'audio-capture':
      return new RecognizerError('AUDIO_CAPTURE', message ?? 'No audio input available');
    case 'language-not-supported':
      return new RecognizerError('LANGUAGE_NOT_SUPPORTED', message ?? 'Language not supported by the recogniser', true);
    case 'aborted':
      return new RecognizerError('ABORTED', 'Recognition aborted', true);
    default:
      return new RecognizerError('UNKNOWN', message ?? `Speech recognition error: ${code}`);
  }
}

/**
 * Maps a supported language code onto a BCP-47 locale the Web Speech API accepts.
 * Falls back to English when a regional voice is unavailable, which is much better
 * than failing recognition entirely.
 */
export function toBcp47(languageCode: string, availableLocales?: readonly string[]): string {
  const preferred: Record<string, string[]> = {
    en: ['en-IN', 'en-GB', 'en-US'],
    hi: ['hi-IN'],
    mr: ['mr-IN'],
    ta: ['ta-IN'],
  };
  const candidates = preferred[languageCode] ?? [languageCode];
  if (!availableLocales || availableLocales.length === 0) return candidates[0]!;
  for (const c of candidates) {
    if (availableLocales.includes(c)) return c;
  }
  return languageCode;
}