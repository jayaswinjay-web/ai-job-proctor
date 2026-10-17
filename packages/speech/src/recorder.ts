/**
 * Answer recording with a local persistence queue.
 *
 * Privacy posture
 * ---------------
 * Recording is opt-in per deployment (`recording.storeAudio`) and the kiosk only
 * ever records the candidate's *answer*, never the AI's speech. Segments live in
 * IndexedDB until the server confirms receipt, so a network drop cannot lose an
 * interview — which is the explicit requirement for unreliable-site kiosks.
 *
 * Data minimisation: audio is uploaded only when the session's settings snapshot
 * allows it and consent was recorded. When it is off, nothing is written to disk.
 */

export interface RecordedSegment {
  /** Stable client id so uploads are idempotent. */
  clientId: string;
  sessionPublicId: string;
  contentType: string;
  durationMs: number;
  createdAtMs: number;
  state: 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED' | 'DISCARDED';
  attempt: number;
  bytes: number;
  blob?: Blob;
}

const DB_NAME = 'proctor-audio';
const DB_VERSION = 1;
const STORE = 'segments';
const META_STORE = 'meta';

export interface AudioRecorderOptions {
  stream: MediaStream;
  enabled: boolean;
  /** Longest single segment kept in memory before it is flushed. */
  maxSegmentMs?: number;
  mimeType?: string;
  onSegment?: (segment: RecordedSegment) => void;
  onError?: (error: Error) => void;
}

const CANDIDATE_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm;codecs=mp4a.40.2',
];

export function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  for (const type of CANDIDATE_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export class AnswerRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAtMs = 0;
  private readonly options: Required<Pick<AudioRecorderOptions, 'maxSegmentMs'>> & AudioRecorderOptions;

  /**
   * Utterance callback used by the server-transcription fallback.
   *
   * Null until a caller opts in, so the existing recording path (consent-gated upload)
   * is completely unaffected.
   */
  private utteranceHandler: ((blob: Blob, durationMs: number) => void | Promise<void>) | null = null;
  private utteranceSpeechSeen = false;
  private utteranceSilenceMs = 0;
  private lastTickAtMs = 0;
  private utteranceStartedAtMs = 0;
  /** Reused across utterances so recording is continuous, only the buffers rotate. */
  private restarting = false;

  constructor(options: AudioRecorderOptions) {
    this.options = { maxSegmentMs: 120_000, ...options };
  }

  get isEnabled(): boolean {
    return this.options.enabled;
  }

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /**
   * Enables or disables capture at runtime.
   *
   * The kiosk switches this on only when it needs to transcribe recorded audio, which is
   * why it is not a constructor-only option.
   */
  setEnabled(enabled: boolean): void {
    if (this.options.enabled === enabled) return;
    this.options.enabled = enabled;
    if (enabled) this.start();
    else this.stop();
  }

  /**
   * Registers the per-utterance handler and the silence threshold that closes one.
   *
   * `silenceEndMs` is the pause after speech that counts as the end of an answer. It needs
   * to be generous: cutting off a slow speaker mid-sentence loses the answer entirely,
   * which is far worse than a slightly longer turn.
   */
  setOnSegmentFinished(handler: (blob: Blob, durationMs: number) => void | Promise<void>, silenceEndMs = 1400): void {
    this.utteranceHandler = handler;
    this.silenceEndMs = Math.max(400, silenceEndMs);
    this.start();
  }

  private silenceEndMs = 1400;

  /**
   * Called from the capture loop with the current level.
   *
   * Segments on speech onset followed by a sustained silence, which is how a human
   * decides an answer has finished. Timing out on a fixed window truncates slow speakers
   * and merges two answers into one.
   */
  tick(levelDb: number, isSpeech: boolean, speechFloorDb: number): void {
    if (!this.utteranceHandler) return;
    const now = Date.now();
    const elapsed = this.lastTickAtMs === 0 ? 0 : now - this.lastTickAtMs;
    this.lastTickAtMs = now;

    const onset = isSpeech || (this.utteranceSpeechSeen && levelDb > speechFloorDb + 3);

    if (!this.utteranceSpeechSeen) {
      if (onset) {
        this.utteranceSpeechSeen = true;
        this.utteranceStartedAtMs = now;
        this.utteranceSilenceMs = 0;
      }
      return;
    }

    if (onset) {
      this.utteranceSilenceMs = 0;
      return;
    }

    this.utteranceSilenceMs += elapsed;
    if (this.utteranceSilenceMs >= this.silenceEndMs) {
      this.closeUtterance();
    }
  }

  private closeUtterance(): void {
    const handler = this.utteranceHandler;
    this.utteranceSpeechSeen = false;
    this.utteranceSilenceMs = 0;
    const durationMs = Math.max(0, Date.now() - this.utteranceStartedAtMs);

    if (this.restarting) return;
    if (!this.isRecording) return;
    this.restarting = true;

    const wasRecording = this.recorder;
    const pending = this.chunks;
    // Detach the buffers before stopping so the flush does not also emit a stored segment.
    this.chunks = [];
    try {
      if (wasRecording && wasRecording.state !== 'inactive') {
        wasRecording.onstop = () => {
          const blob = new Blob(pending, { type: this.options.mimeType ?? wasRecording.mimeType ?? 'audio/webm' });
          this.restarting = false;
          if (blob.size > 0 && durationMs >= 400) void handler?.(blob, durationMs);
          this.start();
        };
        wasRecording.stop();
        return;
      }
    } catch {
      /* fall through to restarting */
    }
    this.restarting = false;
    this.start();
  }

  start(): boolean {
    if (!this.options.enabled || !this.options.stream.active) return false;
    if (this.recorder) this.stop();
    const mimeType = this.options.mimeType ?? pickRecorderMimeType();
    try {
      this.recorder = mimeType
        ? new MediaRecorder(this.options.stream, { mimeType, audioBitsPerSecond: 32_000 })
        : new MediaRecorder(this.options.stream, { audioBitsPerSecond: 32_000 });
    } catch (err) {
      this.options.onError?.(err as Error);
      return false;
    }

    this.chunks = [];
    this.startedAtMs = Date.now();
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.onerror = (event) => {
      const err = (event as unknown as { error?: DOMException }).error;
      this.options.onError?.(new Error(`Recording failed: ${err?.name ?? 'unknown'}`));
    };
    this.recorder.onstop = () => {
      this.flush();
    };

    try {
      this.recorder.start(1000);
      return true;
    } catch (err) {
      this.options.onError?.(err as Error);
      this.recorder = null;
      return false;
    }
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        this.flush();
      }
    }
  }

  /** Ends the current segment and starts a new one (used on long answers). */
  rotate(): void {
    if (!this.isRecording) return;
    this.stop();
    setTimeout(() => this.start(), 60);
  }

  /**
   * Stops the recorder without emitting a segment.
   *
   * Used by the consent path, where audio captured before the candidate agreed must be
   * destroyed rather than uploaded or transcribed.
   */
  discardUtterance(): void {
    this.utteranceSpeechSeen = false;
    this.utteranceSilenceMs = 0;
    this.chunks = [];
  }

  private flush(): void {
    if (this.chunks.length === 0) return;
    const blob = new Blob(this.chunks, { type: this.options.mimeType ?? this.recorder?.mimeType ?? 'audio/webm' });
    this.chunks = [];
    const durationMs = Date.now() - this.startedAtMs;
    const segment: RecordedSegment = {
      clientId: newClientId(),
      sessionPublicId: '',
      contentType: blob.type || 'audio/webm',
      durationMs,
      createdAtMs: Date.now(),
      state: 'PENDING',
      attempt: 0,
      bytes: blob.size,
      blob,
    };
    this.options.onSegment?.(segment);
  }

  stopAndDiscard(): void {
    this.chunks = [];
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.stop();
      this.recorder = null;
    }
  }
}

function newClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `seg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* -------------------------------------------------------------------------- */
/* Offline queue                                                              */
/* -------------------------------------------------------------------------- */

export class AudioQueue {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'clientId' });
          store.createIndex('state', 'state');
          store.createIndex('sessionPublicId', 'sessionPublicId');
        }
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
    return this.dbPromise;
  }

  async enqueue(segment: RecordedSegment): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...segment, blob: segment.blob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
  }

  async pending(sessionPublicId?: string): Promise<RecordedSegment[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const index = sessionPublicId ? tx.objectStore(STORE).index('sessionPublicId') : null;
      const source = index ?? tx.objectStore(STORE);
      const req = index
        ? (index as IDBIndex).getAll(IDBKeyRange.only(sessionPublicId))
        : (source as IDBObjectStore).getAll();
      req.onsuccess = () => {
        const all = (req.result as RecordedSegment[]).filter((s) => s.state === 'PENDING' || s.state === 'FAILED');
        resolve(all.sort((a, b) => a.createdAtMs - b.createdAtMs));
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  }

  async update(segment: RecordedSegment): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(segment);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB update failed'));
    });
  }

  async remove(clientId: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(clientId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    });
  }

  /** Wipes every queued segment. Called on kiosk reset and on explicit sign-out. */
  async clear(): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, META_STORE], 'readwrite');
      tx.objectStore(STORE).clear();
      tx.objectStore(META_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB clear failed'));
    });
  }

  async count(): Promise<number> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB count failed'));
    });
  }
}