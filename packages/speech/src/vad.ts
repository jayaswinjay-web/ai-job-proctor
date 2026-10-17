/**
 * Voice activity detection.
 *
 * Kiosks sit in noisy rooms: fan noise, traffic, other people talking, and — most
 * importantly — the kiosk's own speaker output. This detector answers three
 * questions the interview state machine needs:
 *
 *   1. Is the candidate speaking right now?   → enables barge-in, stops silence timers
 *   2. Is it just noise?                      → prevents the AI from prompting mid-clatter
 *   3. Is speech over, and how long was the pause? → ends the turn
 *
 * Design notes
 * ------------
 *  * Energy-based with a **noise floor that adapts** to the room, so a noisy
 *    canteen and a quiet office both work without retuning.
 *  * A **speech/silence hysteresis** prevents chattering between states: entering
 *    speech needs a higher threshold than staying in it.
 *  * When an echo reference (the AI's own audio) is supplied, energy below the
 *    reference is treated as self-echo rather than candidate speech. This is what
 *    lets the AI be interrupted mid-sentence without transcribing itself.
 *  * Works with a plain `AnalyserNode` so it needs no AudioWorklet, keeping the
 *    first-load budget low on modest kiosk hardware.
 */

export interface VadConfig {
  /** dBFS-ish value above which audio is considered speech at the start. */
  speechOnsetThresholdDb: number;
  /** Level at which we stay in the speech state once started. */
  speechSustainThresholdDb: number;
  /** Silence duration that ends a turn. */
  silenceHangoverMs: number;
  /** How long the floor may drift before it is considered stale. */
  noiseFloorAdaptMs: number;
  /** Ignore noise-floor updates from frames this short (protects quiet rooms). */
  minNoiseSampleMs: number;
  /** Consecutive onset frames required before reporting speech start. */
  onsetFrames: number;
  /** Longest turn the detector will report before forcing a silence event. */
  maxTurnMs: number;
  /** Absolute floor so a digital-silent input does not become absurdly sensitive. */
  absoluteMinDb: number;
  /** Absolute ceiling so a clipping input is not treated as endless speech. */
  absoluteMaxDb: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  speechOnsetThresholdDb: -42,
  speechSustainThresholdDb: -48,
  silenceHangoverMs: 1200,
  noiseFloorAdaptMs: 3000,
  minNoiseSampleMs: 400,
  onsetFrames: 2,
  maxTurnMs: 120_000,
  absoluteMinDb: -80,
  absoluteMaxDb: -12,
};

export type VadEventType = 'SPEECH_START' | 'SPEECH_END' | 'SPEECH_CONTINUING' | 'NOISE_ONLY' | 'MAX_TURN';

export interface VadEvent {
  type: VadEventType;
  /** Milliseconds since speech started (0 for SPEECH_START). */
  speechMs: number;
  /** Milliseconds of continuous silence at the time of the event. */
  silenceMs: number;
  /** Current adaptive noise floor in dB. */
  noiseFloorDb: number;
  /** Measured speech level in dB. */
  levelDb: number;
  timestampMs: number;
}

export interface VadCallbacks {
  onEvent?: (event: VadEvent) => void;
  /** Called every analysed frame — used by the UI for the live mic animation. */
  onLevel?: (levelDb: number, noiseFloorDb: number, isSpeech: boolean) => void;
}

/**
 * Rolling noise-floor tracker. Exposed separately so the kiosk can show a
 * "your microphone is very quiet" hint instead of mysteriously failing.
 */
export class NoiseFloorEstimator {
  private floor: number;
  private lastUpdate = 0;
  private accum = 0;
  private samples = 0;

  constructor(
    initialDb = -60,
    private readonly config: VadConfig = DEFAULT_VAD_CONFIG,
  ) {
    this.floor = Math.min(initialDb, -50);
  }

  /** Feed a frame; returns the updated floor. Frames while speech is active are ignored. */
  update(levelDb: number, nowMs: number, isSpeech: boolean): number {
    if (isSpeech) return this.floor;

    if (nowMs - this.lastUpdate < this.config.minNoiseSampleMs) return this.floor;
    this.lastUpdate = nowMs;

    this.accum += levelDb;
    this.samples += 1;

    if (nowMs - (this.earliestSampleAt ?? nowMs) >= 0) {
      // Adapt toward the observed mean slowly so a door slam cannot move it far.
      const mean = this.accum / this.samples;
      this.floor = clamp(mean, this.config.absoluteMinDb, this.config.absoluteMaxDb);
      this.accum = 0;
      this.samples = 0;
      this.earliestSampleAt = nowMs + this.config.noiseFloorAdaptMs;
    }
    return this.floor;
  }

  private earliestSampleAt = 0;

  get value(): number {
    return this.floor;
  }

  /** True when the room is loud enough that recognition will likely struggle. */
  get isNoisyRoom(): boolean {
    return this.floor > -38;
  }
}

export class VoiceActivityDetector {
  private readonly config: VadConfig;
  private readonly estimator: NoiseFloorEstimator;
  private readonly callbacks: VadCallbacks;

  private inSpeech = false;
  private onsetCount = 0;
  private speechStartedAt = 0;
  private lastVoiceAt = 0;
  private lastFrameAt = 0;
  private stopped = false;

  /** Optional live level of the AI's own playback, used to reject self-echo. */
  private echoReferenceDb: number | null = null;

  constructor(callbacks: VadCallbacks = {}, config: Partial<VadConfig> = {}) {
    this.callbacks = callbacks;
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
    this.estimator = new NoiseFloorEstimator(-60, this.config);
  }

  get isSpeaking(): boolean {
    return this.inSpeech;
  }

  get noiseFloorDb(): number {
    return this.estimator.value;
  }

  get noisyRoom(): boolean {
    return this.estimator.isNoisyRoom;
  }

  /** Tell the detector how loud the AI is speaking, to reject it as candidate speech. */
  setEchoReference(levelDb: number | null): void {
    this.echoReferenceDb = levelDb;
  }

  /**
   * Analyse one time-domain frame.
   * @param samples Float32Array in [-1, 1]
   * @param nowMs Performance.now()
   */
  push(samples: Float32Array, nowMs: number): VadEvent | null {
    if (this.stopped) return null;
    const levelDb = rmsDb(samples);
    this.lastFrameAt = nowMs;

    // Self-echo gate: while the AI is speaking, only accept louder frames.
    const echoDb = this.echoReferenceDb;
    const isEchoSuspect = echoDb !== null && levelDb < echoDb + 6;

    const effectiveThreshold = isEchoSuspect
      ? Math.max(this.estimator.value + 12, this.config.speechOnsetThresholdDb + 12)
      : this.config.speechOnsetThresholdDb;
    const sustainThreshold = isEchoSuspect
      ? Math.max(this.estimator.value + 9, this.config.speechSustainThresholdDb + 9)
      : this.config.speechSustainThresholdDb;

    const isSpeechLevel =
      levelDb > effectiveThreshold &&
      levelDb < this.config.absoluteMaxDb &&
      !isEchoSuspect;

    const floor = this.estimator.update(levelDb, nowMs, this.inSpeech || isSpeechLevel);

    if (!this.inSpeech) {
      if (isSpeechLevel) {
        this.onsetCount += 1;
        if (this.onsetCount >= this.config.onsetFrames) {
          this.inSpeech = true;
          this.speechStartedAt = nowMs;
          this.lastVoiceAt = nowMs;
          this.onsetCount = 0;
          this.callbacks.onLevel?.(levelDb, floor, true);
          return this.emit('SPEECH_START', nowMs, levelDb, floor);
        }
      } else {
        this.onsetCount = 0;
        this.callbacks.onLevel?.(levelDb, floor, false);
        if (floor > -34) return this.emit('NOISE_ONLY', nowMs, levelDb, floor);
      }
      return null;
    }

    // In speech.
    if (isSpeechLevel) this.lastVoiceAt = nowMs;
    const silenceMs = nowMs - this.lastVoiceAt;
    const speechMs = nowMs - this.speechStartedAt;
    this.callbacks.onLevel?.(levelDb, floor, true);

    if (silenceMs >= this.config.maxTurnMs || speechMs >= this.config.maxTurnMs) {
      const event = this.emit('MAX_TURN', nowMs, levelDb, floor);
      this.inSpeech = false;
      return event;
    }
    if (silenceMs >= this.config.silenceHangoverMs && levelDb < sustainThreshold + 10) {
      const event = this.emit('SPEECH_END', nowMs, levelDb, floor);
      this.inSpeech = false;
      return event;
    }
    return this.emit('SPEECH_CONTINUING', nowMs, levelDb, floor);
  }

  /** Manually end the current turn (e.g. the recognizer produced a final result). */
  forceEnd(nowMs = Date.now()): VadEvent | null {
    if (!this.inSpeech) return null;
    const event = this.emit('SPEECH_END', nowMs, -60, this.estimator.value);
    this.inSpeech = false;
    return event;
  }

  reset(): void {
    this.inSpeech = false;
    this.onsetCount = 0;
    this.speechStartedAt = 0;
    this.lastVoiceAt = 0;
  }

  stop(): void {
    this.stopped = true;
    this.reset();
  }

  /** Reports the last frame time — lets the caller detect a stalled audio graph. */
  get lastFrameTimestamp(): number {
    return this.lastFrameAt;
  }

  private emit(type: VadEventType, nowMs: number, levelDb: number, noiseFloorDb: number): VadEvent {
    const event: VadEvent = {
      type,
      speechMs: this.speechStartedAt === 0 ? 0 : Math.max(0, nowMs - this.speechStartedAt),
      silenceMs: this.speechStartedAt === 0 ? 0 : Math.max(0, nowMs - this.lastVoiceAt),
      noiseFloorDb: Math.round(noiseFloorDb * 10) / 10,
      levelDb: Math.round(levelDb * 10) / 10,
      timestampMs: Math.round(nowMs),
    };
    this.callbacks.onEvent?.(event);
    return event;
  }
}

/** RMS level in dBFS. */
export function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  if (rms <= 1e-8) return -100;
  return 20 * Math.log10(rms);
}

/** Peak level in dBFS — used to warn about a microphone that is clipping. */
export function peakDb(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = Math.abs(samples[i]!);
    if (a > peak) peak = a;
  }
  return peak <= 1e-8 ? -100 : 20 * Math.log10(peak);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}