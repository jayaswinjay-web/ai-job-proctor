/**
 * Speech synthesis wrapper with a spoken-queue, barge-in and level reporting.
 *
 * Barge-in is the single most important behaviour here. When a candidate says
 * "Repeat" while the AI is still talking, the audio must stop *immediately* —
 * waiting for the current utterance to finish makes the kiosk feel broken and
 * causes the recogniser to transcribe the AI's own voice.
 */

export type SynthesizerState = 'IDLE' | 'SPEAKING' | 'PAUSED' | 'UNAVAILABLE';

export interface SynthesizerOptions {
  language: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  voiceHint?: string | null;
  onStateChange?: (state: SynthesizerState) => void;
  onUtteranceStart?: (text: string) => void;
  onUtteranceEnd?: (text: string) => void;
  onError?: (error: Error) => void;
  /**
   * Called when the requested language has no installed voice and another was used.
   *
   * The words will not be pronounced correctly, so this is worth surfacing to an operator
   * rather than hiding: a silent kiosk is confusing, but so is an English voice reading
   * Tamil and being taken for a working one.
   */
  onVoiceSubstituted?: (requestedLocale: string, usedLocale: string) => void;
  /** Live output level in dBFS, used by the VAD to reject self-echo. */
  onLevel?: (levelDb: number) => void;
}

export interface SpeakRequest {
  text: string;
  /** Overrides the instance rate; used for the slow-down variant. */
  rate?: number;
  /** Optional slower, simpler phrasing the engine can substitute. */
  alternativeText?: string;
  /** When true, any pending utterance is cancelled first. */
  interrupt?: boolean;
}

interface QueueItem extends SpeakRequest {
  resolve: (finished: boolean) => void;
  reject: (err: Error) => void;
}

export interface VoiceDescriptor {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export class SpeechSynthesizer {
  private readonly synth: SpeechSynthesis | null;
  private options: SynthesizerOptions;
  private queue: QueueItem[] = [];
  private current: QueueItem | null = null;
  private state: SynthesizerState = 'IDLE';
  private analysisCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelRaf = 0;
  private outputDeviceId: string | null = null;

  constructor(options: SynthesizerOptions) {
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    this.options = options;
    if (!this.synth) {
      this.setState('UNAVAILABLE');
    }
  }

  get currentState(): SynthesizerState {
    return this.state;
  }

  get isAvailable(): boolean {
    return this.synth !== null;
  }

  get isSpeaking(): boolean {
    return this.state === 'SPEAKING';
  }

  get queueLength(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  /** Some Chromium builds only populate `getVoices()` after the first tick. */
  async warmUp(): Promise<VoiceDescriptor[]> {
    if (!this.synth) return [];
    const voices = await this.loadVoices();
    return voices;
  }

  async listVoices(): Promise<VoiceDescriptor[]> {
    if (!this.synth) return [];
    const voices = await this.loadVoices();
    return voices.map((v) => ({
      voiceURI: v.voiceURI,
      name: v.name,
      lang: v.lang,
      localService: v.localService,
      default: v.default,
    }));
  }

  private loadVoices(): Promise<SpeechSynthesisVoice[]> {
    if (!this.synth) return Promise.resolve([]);
    const immediate = this.synth.getVoices();
    if (immediate.length > 0) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(this.synth?.getVoices() ?? []);
      };
      this.synth!.addEventListener('voiceschanged', finish, { once: true });
      setTimeout(finish, 1200);
    });
  }

  /** Picks the best voice for a language: exact locale match first, then base language. */
  async selectVoice(languageCode: string, hint?: string | null): Promise<VoiceDescriptor | null> {
    if (!this.synth) return null;
    const voices = await this.loadVoices();
    if (voices.length === 0) return null;

    const locale = localeFor(languageCode);
    const base = locale.split('-')[0]!;
    const usable = voices.filter((v) => v.lang.toLowerCase().startsWith(base));

    /**
     * No voice for this language at all.
     *
     * Returning null here left `utterance.voice` unset, and an engine with no voice for
     * the requested `lang` produces no sound — the candidate simply heard silence with no
     * indication anything was wrong. Falling back to the system default voice at least
     * attempts the words; the caller logs the substitution so the gap is visible.
     */
    if (usable.length === 0) {
      const fallbackVoice = voices.find((v) => v.default) ?? voices[0]!;
      this.options.onVoiceSubstituted?.(locale, fallbackVoice.lang);
      return {
        voiceURI: fallbackVoice.voiceURI,
        name: fallbackVoice.name,
        lang: fallbackVoice.lang,
        localService: fallbackVoice.localService,
        default: fallbackVoice.default,
      };
    }

    const score = (v: SpeechSynthesisVoice): number => {
      let s = 0;
      if (v.lang.toLowerCase() === locale.toLowerCase()) s += 100;
      if (v.localService) s += 20;
      if (hint && v.name.toLowerCase().includes(hint.toLowerCase())) s += 50;
      if (hint && v.voiceURI.toLowerCase().includes(hint.toLowerCase())) s += 50;
      if (v.default) s += 5;
      if (/natural|neural|enhanced|premium|google/i.test(v.name)) s += 15;
      return s;
    };
    const best = [...usable].sort((a, b) => score(b) - score(a))[0]!;
    return { voiceURI: best.voiceURI, name: best.name, lang: best.lang, localService: best.localService, default: best.default };
  }

  setRate(rate: number): void {
    this.options = { ...this.options, rate };
  }

  setVolume(volume: number): void {
    this.options = { ...this.options, volume };
  }

  setLanguage(language: string): void {
    this.options = { ...this.options, language };
  }

  /** Routes speech to a specific output device where the browser supports it. */
  async setOutputDevice(deviceId: string | null): Promise<boolean> {
    this.outputDeviceId = deviceId;
    if (!this.synth) return false;
    try {
      const synth = this.synth as SpeechSynthesis & { setSinkId?: (id: string) => Promise<void> };
      if (typeof synth.setSinkId !== 'function' || !deviceId) return false;
      await synth.setSinkId(deviceId);
      return true;
    } catch {
      return false;
    }
  }

  /** Speaks text after everything already queued. Resolves when this item finished. */
  speak(request: SpeakRequest): Promise<boolean> {
    if (!this.synth) return Promise.resolve(false);
    if (request.interrupt) this.cancel();
    return new Promise<boolean>((resolve, reject) => {
      this.queue.push({ ...request, resolve, reject });
      this.drain();
    });
  }

  /** Speaks text immediately, discarding anything pending. */
  async interruptWith(request: SpeakRequest): Promise<boolean> {
    this.cancel();
    return this.speak({ ...request, interrupt: false });
  }

  /** Stops all speech and clears the queue. Pending promises resolve as `false`. */
  cancel(): void {
    const pending = [...this.queue];
    this.queue = [];
    this.current = null;
    try {
      this.synth?.cancel();
    } catch {
      /* noop */
    }
    this.stopLevelMeter();
    this.setState('IDLE');
    for (const item of pending) item.resolve(false);
  }

  private drain(): void {
    if (!this.synth || this.current || this.queue.length === 0) return;
    const item = this.queue.shift()!;
    this.current = item;
    this.setState('SPEAKING');

    void this.runUtterance(item).then(
      (finished) => {
        if (this.current === item) {
          this.current = null;
          item.resolve(finished);
          this.drain();
        }
      },
      (err) => {
        if (this.current === item) {
          this.current = null;
          item.reject(err);
          this.drain();
        }
      },
    );
  }

  private async runUtterance(item: QueueItem): Promise<boolean> {
    if (!this.synth) return false;
    const text = (item.text ?? '').trim();
    if (!text) {
      this.setState('IDLE');
      return true;
    }

    // Some engines silently fail on very long strings; chunk defensively.
    const segments = chunkForSynthesis(text, 320);
    this.options.onUtteranceStart?.(text);

    try {
      for (const segment of segments) {
        if (!this.synth) return false;
        if (this.outputDeviceId) void this.setOutputDevice(this.outputDeviceId);

        const voice = await this.selectVoice(this.options.language, this.options.voiceHint ?? null);
        const resolved = voice
          ? (this.synth.getVoices().find((v) => v.voiceURI === voice.voiceURI) ?? null)
          : null;
        try {
          // Follow the chosen voice's locale. When it is a substitution for a language the
          // system has no voice for, insisting on the original `lang` can make the engine
          // produce no sound at all.
          await this.speakSegment(segment, item, resolved, resolved?.lang ?? localeFor(this.options.language));
        } catch (err) {
          // The preferred voice could not be used — most often a network voice with no
          // connection, which is common for languages with no locally installed voice.
          // Retry on the system default so the question is still heard rather than leaving
          // the candidate in silence.
          const fallback = this.defaultVoiceFor();
          if (!fallback || fallback.voiceURI === resolved?.voiceURI) throw err;
          this.options.onVoiceSubstituted?.(voice?.lang ?? localeFor(this.options.language), fallback.lang);
          await this.speakSegment(segment, item, fallback, fallback.lang);
        }

        if (this.current !== item) return false;
      }
      this.options.onUtteranceEnd?.(text);
      this.setState(this.queue.length > 0 ? 'SPEAKING' : 'IDLE');
      return true;
    } catch (err) {
      this.options.onError?.(err as Error);
      // Fall back to the alternative phrasing if the primary text failed.
      if (item.alternativeText && item.alternativeText !== text && this.current === item) {
        const alt = new SpeechSynthesisUtterance(item.alternativeText);
        alt.lang = localeFor(this.options.language);
        alt.rate = clamp(item.rate ?? this.options.rate ?? 0.92, 0.4, 1.8);
        this.synth.speak(alt);
      }
      this.options.onUtteranceEnd?.(text);
      this.setState('IDLE');
      return false;
    }
  }

  /** The system default voice, or the first available one. Used as a last resort. */
  private defaultVoiceFor(): SpeechSynthesisVoice | null {
    const voices = this.synth?.getVoices() ?? [];
    return voices.find((v) => v.default) ?? voices[0] ?? null;
  }

  /**
   * Speaks one chunk with a specific voice and resolves when it finishes.
   *
   * Rejects on a real synthesis error so the caller can retry with another voice; a
   * barge-in ('interrupted'/'canceled') resolves normally because it is expected.
   */
  private speakSegment(
    segment: string,
    item: QueueItem,
    voice: SpeechSynthesisVoice | null,
    lang: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.synth) {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(segment);
      utterance.lang = lang;
      utterance.rate = clamp(item.rate ?? this.options.rate ?? 0.92, 0.4, 1.8);
      utterance.pitch = clamp(this.options.pitch ?? 1, 0.4, 1.6);
      utterance.volume = clamp(this.options.volume ?? 1, 0, 1);
      if (voice) utterance.voice = voice;

      let settled = false;
      utterance.onstart = () => {
        this.startLevelMeter();
      };
      utterance.onend = () => {
        if (settled) return;
        settled = true;
        this.stopLevelMeter();
        resolve();
      };
      utterance.onerror = (event) => {
        if (settled) return;
        settled = true;
        this.stopLevelMeter();
        const err = (event as unknown as { error?: string }).error ?? 'unknown';
        // 'interrupted'/'canceled' are the expected result of a barge-in.
        if (err === 'interrupted' || err === 'canceled') {
          resolve();
          return;
        }
        reject(new Error(`Speech synthesis failed: ${err}`));
      };
      try {
        this.synth.speak(utterance);
      } catch (err) {
        if (settled) return;
        settled = true;
        reject(err as Error);
      }
    });
  }

  /**
   * Mutes output level so the VAD does not treat our own voice as candidate speech.
   * Uses a MediaStreamDestination on the same context as the synth when available;
   * otherwise falls back to reporting a nominal level while speaking.
   */
  private startLevelMeter(): void {
    if (!this.options.onLevel) return;
    const synth = this.synth as (SpeechSynthesis & { destination?: unknown }) | null;
    this.options.onLevel(-12);
    if (!synth) return;
    if (!this.analysisCtx) {
      try {
        this.analysisCtx = new AudioContext();
      } catch {
        return;
      }
    }
    try {
      const source = synth.destination as MediaStreamAudioDestinationNode | undefined;
      if (!source || typeof source.stream?.getAudioTracks !== 'function') return;
      const src = this.analysisCtx.createMediaStreamSource(source.stream);
      this.analyser = this.analysisCtx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      const data = new Float32Array(this.analyser.fftSize);
      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i]! * data[i]!;
        const rms = Math.sqrt(sum / data.length);
        this.options.onLevel!(rms <= 1e-6 ? -60 : 20 * Math.log10(rms));
        this.levelRaf = requestAnimationFrame(tick);
      };
      this.levelRaf = requestAnimationFrame(tick);
    } catch {
      /* level metering is best-effort */
    }
  }

  private stopLevelMeter(): void {
    if (this.levelRaf) cancelAnimationFrame(this.levelRaf);
    this.levelRaf = 0;
    this.analyser = null;
    this.options.onLevel?.(-100);
  }

  private setState(state: SynthesizerState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange?.(state);
  }
}

/**
 * Splits on sentence boundaries first so prosody stays natural, then hard-chunks
 * anything still too long.
 */
export function chunkForSynthesis(text: string, maxChars: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return [clean];
  const sentences = clean.split(/(?<=[.!?।॥])\s+/);
  const out: string[] = [];
  let buffer = '';
  for (const sentence of sentences) {
    if ((buffer + ' ' + sentence).trim().length > maxChars && buffer) {
      out.push(buffer.trim());
      buffer = '';
    }
    if (sentence.length > maxChars) {
      const words = sentence.split(' ');
      let piece = '';
      for (const word of words) {
        if ((piece + ' ' + word).trim().length > maxChars && piece) {
          out.push(piece.trim());
          piece = word;
        } else {
          piece = `${piece} ${word}`.trim();
        }
      }
      buffer = piece;
    } else {
      buffer = `${buffer} ${sentence}`.trim();
    }
  }
  if (buffer) out.push(buffer.trim());
  return out.filter(Boolean);
}

function localeFor(languageCode: string): string {
  const map: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
  return map[languageCode] ?? languageCode;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}