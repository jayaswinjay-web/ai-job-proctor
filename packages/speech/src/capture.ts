import { DEFAULT_VAD_CONFIG, VoiceActivityDetector, type VadConfig, type VadEvent } from './vad.js';

/**
 * Microphone capture with aggressive noise handling.
 *
 * Every constraint below matters for a kiosk in a public space:
 *  * `echoCancellation` stops the candidate's own voice from being re-recognised
 *    out of the loudspeaker.
 *  * `noiseSuppression` handles steady background hum (fans, traffic, AC).
 *  * `autoGainControl` rescues candidates who speak quietly — important because a
 *    quiet voice must not be mistaken for low confidence.
 *  * `channelCount: 1` + a disabled processing limiter keeps CPU free on cheap
 *    kiosk hardware.
 *
 * If `getUserMedia` is denied or unavailable the caller receives a typed failure
 * so it can speak a human message instead of showing a technical error.
 */

export type CaptureErrorKind =
  | 'PERMISSION_DENIED'
  | 'NO_DEVICE'
  | 'DEVICE_BUSY'
  | 'INSECURE_CONTEXT'
  | 'UNSUPPORTED'
  | 'UNKNOWN';

export class CaptureError extends Error {
  constructor(
    readonly kind: CaptureErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CaptureError';
  }

  /** Candidate-safe remedy. Never contains browser API names. */
  get candidateMessageKey(): 'microphone_problem' | 'permission_needed' {
    return this.kind === 'PERMISSION_DENIED' || this.kind === 'INSECURE_CONTEXT' ? 'permission_needed' : 'microphone_problem';
  }
}

export interface CaptureOptions {
  vad?: Partial<VadConfig>;
  onVadEvent?: (event: VadEvent) => void;
  onLevel?: (levelDb: number, noiseFloorDb: number, isSpeech: boolean) => void;
  /** Target sample rate for the analysis loop. */
  fftSize?: number;
}

export interface AudioCapture {
  stream: MediaStream;
  context: AudioContext;
  analyser: AnalyserNode;
  vad: VoiceActivityDetector;
  /** Latest peak level in dBFS — drives the "you are too loud" warning. */
  peakLevelDb(): number;
  /** Route the AI's playback level so the VAD can reject self-echo. */
  setEchoReference(levelDb: number | null): void;
  /** Poll one frame and feed the VAD. Called by the kiosk's animation loop. */
  poll(): void;
  /** True when the audio graph has gone quiet, which usually means a device problem. */
  isStalled(maxGapMs?: number): boolean;
  stop(): void;
}

export async function createAudioCapture(options: CaptureOptions = {}): Promise<AudioCapture> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new CaptureError('UNSUPPORTED', 'Microphone API unavailable');
  }
  const secure = window.isSecureContext ?? (location.protocol === 'https:' || location.hostname === 'localhost');
  if (!secure) {
    throw new CaptureError('INSECURE_CONTEXT', 'Microphone requires a secure context (https or localhost)');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48_000,
      },
      video: false,
    });
  } catch (err) {
    throw toCaptureError(err);
  }

  const tracks = stream.getAudioTracks();
  if (tracks.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError('NO_DEVICE', 'Stream contains no audio track');
  }

  const AudioContextCtor: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioContextCtor();
  if (context.state === 'suspended') await context.resume().catch(() => undefined);

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = options.fftSize ?? 2048;
  analyser.smoothingTimeConstant = 0.15;
  source.connect(analyser);

  const vad = new VoiceActivityDetector(
    { onEvent: options.onVadEvent, onLevel: options.onLevel },
    { ...DEFAULT_VAD_CONFIG, ...options.vad },
  );

  const frame = new Float32Array(analyser.fftSize);
  const timeDomain = new Uint8Array(analyser.fftSize);
  let peakDbValue = -100;

  const capture: AudioCapture = {
    stream,
    context,
    analyser,
    vad,

    peakLevelDb: () => peakDbValue,

    setEchoReference(levelDb: number | null) {
      vad.setEchoReference(levelDb);
    },

    poll() {
      analyser.getByteTimeDomainData(timeDomain);
      for (let i = 0; i < timeDomain.length; i += 1) {
        frame[i] = (timeDomain[i]! - 128) / 128;
      }
      let peak = 0;
      for (let i = 0; i < frame.length; i += 1) {
        const a = Math.abs(frame[i]!);
        if (a > peak) peak = a;
      }
      peakDbValue = peak <= 1e-8 ? -100 : 20 * Math.log10(peak);
      vad.push(frame, performance.now());
    },

    isStalled(maxGapMs = 2000) {
      const last = vad.lastFrameTimestamp;
      return last > 0 && performance.now() - last > maxGapMs;
    },

    stop() {
      vad.stop();
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        /* already disconnected */
      }
      stream.getTracks().forEach((t) => t.stop());
      void context.close().catch(() => undefined);
    },
  };

  // Mark the detector as live so isStalled() does not fire before the first poll.
  vad.push(new Float32Array(analyser.fftSize), performance.now());

  return capture;
}

function toCaptureError(err: unknown): CaptureError {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as Error)?.message ?? 'Microphone unavailable';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new CaptureError('PERMISSION_DENIED', message);
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CaptureError('NO_DEVICE', message);
    case 'NotReadableError':
    case 'TrackStartError':
      return new CaptureError('DEVICE_BUSY', message);
    case 'OverconstrainedError':
    case 'TypeError':
      return new CaptureError('UNSUPPORTED', message);
    default:
      return new CaptureError('UNKNOWN', message);
  }
}

/** Enumerates inputs so an administrator can verify the kiosk's hardware. */
export async function listAudioInputs(): Promise<Array<{ deviceId: string; label: string }>> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone' }));
}

export async function listAudioOutputs(): Promise<Array<{ deviceId: string; label: string }>> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audiooutput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Speaker' }));
}