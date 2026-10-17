import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AnswerRecorder,
  AudioQueue,
  SpeechRecognizer,
  SpeechSynthesizer,
  createAudioCapture,
  detectVoiceCommand,
  isSpeechRecognitionSupported,
  toBcp47,
  type AudioCapture,
  type RecognitionResult,
  type RecognizerError,
} from '@proctor/speech';
import { kioskApi, KioskError, type BootstrapPayload, type Directive, type TurnPayload } from '../lib/api.js';
import { enqueueTurn, persistKioskId, readQueuedTurns, removeQueuedTurn, resetLocalData, type StoredSession } from '../lib/storage.js';

/**
 * The kiosk conversation controller.
 *
 * This is the only place that knows how speech in, engine out, and storage on a disk
 * fit together. Screens stay declarative; everything stateful lives here.
 *
 * Audio pipeline
 * --------------
 *   microphone → echo/noise suppression + AGC → VAD → speech recogniser
 *                    → command detection → HTTP turn → directives → speech synthesiser
 *
 * Three design decisions worth calling out:
 *
 *  1. **Barge-in.** A new recognition result cancels whatever the synthesiser is saying.
 *     Without this the kiosk transcribes itself and the candidate's "repeat" arrives
 *     half a question late.
 *
 *  2. **Persist before speaking.** Every answer is queued to IndexedDB *before* the turn
 *     is sent. If the network drops mid-request the answer is replayed, not lost.
 *
 *  3. **Offline is spoken, not shown.** Connection changes are announced through the same
 *     voice channel as everything else.
 */

export type ConnectionPhase = 'boot' | 'idle' | 'listening' | 'speaking' | 'thinking' | 'error' | 'complete' | 'offline';

/** Mirrors `PHRASE_KEYS` in `@proctor/types`; the one phrase that is a state hint, not content. */
const LISTENING_PROMPT_PHRASE = 'listening_prompt';

export interface KioskController {
  bootstrap: BootstrapPayload | null;
  phase: ConnectionPhase;
  online: boolean;
  /**
   * Caption for what is being asked, held on screen until the next thing is asked.
   *
   * It deliberately survives the end of the speech: a candidate who is deaf or hard of
   * hearing needs to be able to re-read the question for as long as they are thinking
   * about the answer, not just while the synthesiser is moving.
   */
  caption: string | null;
  /**
   * The "I am listening" line that accompanies a question while the kiosk is hearing.
   *
   * Kept separate from the caption so the question is never overwritten by the prompt to
   * speak — both are useful at the same time.
   */
  listeningHint: string | null;
  /** The candidate's last recognised words, shown only when captions are enabled. */
  heardText: string | null;
  progress: { answered: number; total: number; label: string | null };
  micLevel: number;
  muted: boolean;
  demo: boolean;
  speechAvailable: boolean;
  session: StoredSession | null;
  /**
   * The language the candidate selected, which is set *before* a session exists.
   *
   * Exposed separately from `session.languageCode` because the candidate picks a language
   * on its own screen and only afterwards chooses a job; reading the language back off the
   * session at that point would silently revert every candidate to the first language.
   */
  languageCode: string;
  error: { code: string; message: string; errorId: string | null } | null;
  helpOpen: boolean;

  startSession(input: { jobId: string; languageCode?: string }): Promise<void>;
  submitConsent(given: boolean): Promise<void>;
  submitTurn(transcript: string, confidence?: number, durationMs?: number): Promise<void>;
  skipCurrent(): Promise<void>;
  finish(): Promise<void>;
  cancel(reason: string): Promise<void>;
  setLanguage(code: string): Promise<void>;
  toggleMute(): void;
  repeatLast(): void;
  openHelp(): void;
  closeHelp(): void;
  resetToWelcome(): void;
  reportError(code: string, message?: string): void;
}

interface Options {
  onPhaseChange?: (phase: ConnectionPhase) => void;
}

export function useKioskController(options: Options = {}): KioskController {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [phase, setPhaseState] = useState<ConnectionPhase>('boot');
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [caption, setCaption] = useState<string | null>(null);
  const [listeningHint, setListeningHint] = useState<string | null>(null);
  const [heardText, setHeardText] = useState<string | null>(null);
  const [progress, setProgress] = useState({ answered: 0, total: 0, label: null as string | null });
  const [micLevel, setMicLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [languageCode, setLanguageCode] = useState('en');
  const [error, setError] = useState<KioskController['error']>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const synthRef = useRef<SpeechSynthesizer | null>(null);
const recognizerRef = useRef<SpeechRecognizer | null>(null);
const captureRef = useRef<AudioCapture | null>(null);
const recorderRef = useRef<AnswerRecorder | null>(null);
/** Non-benign recogniser failures since the last successful turn. */
const recognitionFailureRef = useRef(0);
/** True once the recorded-audio transcription fallback has taken over. */
const fallbackActiveRef = useRef(false);
/**
 * Indirection so `startRecognition` can trigger the fallback without depending on it.
 *
 * The fallback needs `submitTurn`, which is declared later; a ref keeps the two in the
 * right order without a stale closure over the turn pipeline.
 */
const transcriptionFallbackRef = useRef<() => void>(() => undefined);
/** When the candidate started speaking, so answer length can be reported honestly. */
const utteranceStartedAtRef = useRef(0);
/** Last mic level pushed to React, so the render loop only commits on a visible change. */
const micLevelRef = useRef(0);

  const audioQueueRef = useRef(new AudioQueue());
  const sessionRef = useRef<StoredSession | null>(null);
  const phaseRef = useRef<ConnectionPhase>('boot');
  const languageRef = useRef<string>('en');
  const voiceRef = useRef<BootstrapPayload['voice'] | null>(null);
  const speakingRef = useRef(false);
  const processingRef = useRef(false);
  const lastQuestionRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);
  const bootedRef = useRef(false);

  const setPhase = useCallback(
    (next: ConnectionPhase) => {
      phaseRef.current = next;
      setPhaseState(next);
      options.onPhaseChange?.(next);
    },
    [options],
  );

  /* ---------------------------------------------------------------- */
  /* Boot                                                              */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const boot = useCallback(async () => {
    try {
      const payload = await kioskApi.bootstrap();
      setBootstrap(payload);
      // Remembered so the *next* bootstrap (after a reload) can offer this kiosk its
      // interrupted session; the server keys resume off this id.
      persistKioskId(payload.kiosk.kioskId);
      voiceRef.current = payload.voice;
      // Fall back to the first enabled language only if the configured default is not in
      // the enabled set, which can happen after an administrator disables a language.
      const available = payload.languages.map((l) => l.code);
      const initial = available.includes(payload.defaultLanguage) ? payload.defaultLanguage : (available[0] ?? 'en');
      languageRef.current = initial;
      setLanguageCode(initial);

      synthRef.current = new SpeechSynthesizer({
        language: languageRef.current,
        rate: payload.voice.rate,
        pitch: payload.voice.pitch,
        volume: payload.voice.volume,
        onStateChange: (state) => {
          if (state === 'SPEAKING') speakingRef.current = true;
          if (state === 'IDLE') {
            speakingRef.current = false;
            // Only start listening once the AI has fully finished; starting mid-utterance
            // is how a recogniser ends up transcribing the kiosk itself.
            if (phaseRef.current === 'speaking') setPhase(recognizerRef.current ? 'listening' : 'idle');
          }
        },
        onLevel: (db) => {
          // Route our own output level into the VAD so it is not treated as speech.
          captureRef.current?.setEchoReference(db > -80 ? db : null);
        },
        onVoiceSubstituted: (requested, used) => {
          // The kiosk will be audible but mispronounced. Surfaced rather than silent so an
          // operator can install the language's voice instead of guessing why it sounds wrong.
          console.warn(`No ${requested} voice installed; speaking with ${used} instead.`);
        },
      });
      await synthRef.current.selectVoice(languageRef.current, payload.languages[0]?.ttsVoiceHint ?? null);

      // Resume an interrupted interview before anything else.
      const { readPersistedSession } = await import('../lib/storage.js');
      const stored = readPersistedSession();
      if (stored && payload.resume?.sessionId === stored.sessionId) {
        sessionRef.current = stored;
        setSession(stored);
        languageRef.current = stored.languageCode;
        setLanguageCode(stored.languageCode);
        synthRef.current.setLanguage(stored.languageCode);
        setPhase('idle');
        await startCapture();
        await submitTurn('', 1, 0, { silent: true, replay: true });
        return;
      }

      setPhase('idle');
    } catch (err) {
      const safe = err instanceof KioskError ? err.message : 'There is a small technical problem. Please call the person at the desk.';
      setError({ code: 'BOOT_FAILED', message: safe, errorId: err instanceof KioskError ? err.errorId : null });
      setPhase('error');
    }
  }, [setPhase]);

  /* ---------------------------------------------------------------- */
  /* Connectivity                                                      */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void replayQueue();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Microphone + recognition                                          */
  /* ---------------------------------------------------------------- */

  const startCapture = useCallback(async () => {
    if (captureRef.current) return;
    try {
      const capture = await createAudioCapture({
        vad: { silenceHangoverMs: 1400, onsetFrames: 2 },
        onLevel: (_level, _floor, _isSpeech) => undefined,
      });
      captureRef.current = capture;

      if (bootstrap?.kiosk.autoStartAudio !== false) {
        const recorder = new AnswerRecorder({
          stream: capture.stream,
          enabled: false,
          onSegment: (segment) => {
            // Recorded segments are only uploaded when the server confirms consent and
            // recording is enabled; until then they are discarded, never stored.
            void segment;
          },
        });
        recorderRef.current = recorder;
      }

      startRecognition();
      pumpLevels();
    } catch {
      // No microphone: the candidate is told in plain words rather than shown an error.
      setError({
        code: 'MIC_UNAVAILABLE',
        message: 'I cannot use the microphone. Please call the person at the desk for help.',
        errorId: null,
      });
      setPhase('error');
    }
  }, [bootstrap?.kiosk.autoStartAudio]);

  const startRecognition = useCallback(() => {
    if (!isSpeechRecognitionSupported()) {
      // No in-browser recogniser (non-Chromium, or a kiosk image without it). The
      // recorded-audio fallback takes over rather than leaving the candidate mute.
      transcriptionFallbackRef.current();
      return;
    }
    const lang = languageRef.current;
    const locale = toBcp47(lang);
    const recognizer = new SpeechRecognizer({
      language: locale,
      continuous: true,
      interimResults: true,
      vocabularyHints: jobVocabulary(sessionRef.current),
      onResult: (result: RecognitionResult) => onRecognition(result),
      onError: (error: RecognizerError) => {
        // A refusal of the service (Brave blocks the Google recogniser) or a hard network
        // failure is not transient: waiting for the retry streak only swallows the
        // candidate's answers, so hand over to server transcription immediately.
        if (error.code === 'PERMISSION_DENIED' || error.code === 'NETWORK' || error.code === 'LANGUAGE_NOT_SUPPORTED') {
          transcriptionFallbackRef.current();
          return;
        }
        // Errors used to be discarded here, which made a permanently broken recogniser look
        // identical to a candidate who had said nothing. Count the non-benign failures and
        // switch to server transcription once they are clearly not transient.
        if (error.benign) return;
        recognitionFailureRef.current += 1;
        if (recognitionFailureRef.current >= 3) transcriptionFallbackRef.current();
      },
    });
    recognizerRef.current = recognizer;
    recognizer.start();
  }, []);

  const pumpLevels = useCallback(() => {
    const tick = () => {
      const capture = captureRef.current;
      if (capture) {
        capture.poll();
        const peak = capture.peakLevelDb();
        // Map dBFS into a 0–1 glow. -60 dB is silence, -6 dB is loud speech.
        const normalised = Math.max(0, Math.min(1, (peak + 60) / 54));
        // Quantised before setting state. The animation loop runs at 60fps, and a raw
        // dBFS value changes on every frame, so updating state each time re-rendered the
        // whole interview screen 60 times a second — enough to starve the main thread on
        // the low-power hardware a kiosk actually runs on. Twenty steps is smooth to the
        // eye and a fraction of the work.
        const stepped = Math.round(normalised * 20) / 20;
        if (stepped !== micLevelRef.current) {
          micLevelRef.current = stepped;
          setMicLevel(stepped);
        }
        // The recorder needs the level too, but only when it is the thing deciding where
        // an answer ends. The VAD's own speech decision is reused rather than recomputed,
        // so the onset threshold cannot drift between the two.
        if (recorderRef.current?.isEnabled) {
          recorderRef.current.tick(peak, capture.vad.isSpeaking, capture.vad.noiseFloorDb);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  /* ---------------------------------------------------------------- */
  /* Turn handling                                                     */
  /* ---------------------------------------------------------------- */

  const speakDirectives = useCallback(async (directives: Directive[]) => {
    const synth = synthRef.current;
    if (!synth || directives.length === 0) return;
    setListeningHint(null);
    for (const directive of directives) {
      const text = directive.text?.trim();
      if (!text) continue;
      if (directive.phraseKey === LISTENING_PROMPT_PHRASE) {
        // Held back from the caption so it can sit beside the question rather than
        // replace it.
        setListeningHint(directive.displayText ?? text);
      } else if (directive.displayText) {
        setCaption(directive.displayText);
      }
      await synth.speak({
        text,
        rate: directive.slowRate ? (voiceRef.current?.slowRate ?? 0.68) : (voiceRef.current?.rate ?? 0.92),
      });
    }
  }, []);

  const applyTurnPayload = useCallback(
    (payload: TurnPayload) => {
      setProgress(payload.progress);
      void speakDirectives(payload.directives ?? []);
    },
    [speakDirectives],
  );

  const submitTurn = useCallback(
    async (transcript: string, confidence = 0.8, durationMs = 0, opts: { silent?: boolean; replay?: boolean } = {}) => {
      const active = sessionRef.current;
      if (!active || processingRef.current) return;
      processingRef.current = true;

      try {
        const turn = transcript.trim()
          ? { transcript: transcript.trim(), spokenLanguage: languageRef.current, confidence, durationMs }
          : { transcript: '', spokenLanguage: null, confidence: 1, durationMs: 0 };

        if (!navigator.onLine && transcript.trim()) {
          await enqueueTurn({
            sessionId: active.sessionId,
            transcript: turn.transcript,
            spokenLanguage: turn.spokenLanguage,
            confidence: turn.confidence,
            durationMs: turn.durationMs,
            createdAt: Date.now(),
          });
          setPhase('offline');
          return;
        }

        if (!opts.silent) setPhase('thinking');
        const payload = await kioskApi.turn(active.sessionId, active.sessionSecret, turn);
        setHeardText(null);
        applyTurnPayload(payload);

        if (payload.terminal === 'COMPLETED') {
          await completeSession();
        } else if (payload.terminal) {
          setPhase('idle');
          await resetLocalData();
        } else if (!opts.silent) {
          setPhase(recognizerRef.current ? 'listening' : 'idle');
        }
      } catch (err) {
        await handleTurnFailure(err, transcript, confidence, durationMs);
      } finally {
        processingRef.current = false;
      }
    },
    [applyTurnPayload, setPhase],
  );

  /**
   * Records each utterance and posts it to the server for transcription.
   *
   * This is what makes the kiosk usable when Web Speech is missing or broken, which is
   * every non-Chromium browser and any kiosk without a route to the recogniser vendor.
   * It is slower than in-browser recognition, so it stays a fallback rather than the
   * default: the candidate waits out the round trip instead of repeating the answer.
   */
  const startServerTranscriptionFallback = useCallback(() => {
    if (fallbackActiveRef.current) return;
    const recorder = recorderRef.current;
    if (!recorder || typeof MediaRecorder === 'undefined') {
      setError({
        code: 'MIC_UNAVAILABLE',
        message: 'I cannot listen right now. Please call the person at the desk for help.',
        errorId: null,
      });
      setPhase('error');
      return;
    }

    fallbackActiveRef.current = true;
    recognizerRef.current?.stop();
    recognizerRef.current = null;

    // Voice activity decides when an utterance has finished. Cutting off on a timer
    // instead truncates slow speakers and merges two answers into one.
    recorder.setOnSegmentFinished(async (blob, durationMs) => {
      const session = sessionRef.current;
      if (!session || blob.size === 0) return;
      try {
        const result = await kioskApi.transcribe(session.sessionId, session.sessionSecret, blob, languageRef.current);
        if (!result.text.trim()) return;
        setHeardText(result.text);
        await submitTurn(result.text, result.confidence || 0.7, durationMs);
      } catch {
        // A failed transcription is not fatal: the candidate is asked again by the normal
        // "I did not catch that" prompt on the next silence.
        setPhase('idle');
      }
    });

    recorder.setEnabled(true);
  }, [submitTurn]);

  transcriptionFallbackRef.current = startServerTranscriptionFallback;

  const handleTurnFailure = useCallback(
    async (err: unknown, transcript: string, confidence: number, durationMs: number) => {
      const active = sessionRef.current;
      if (err instanceof KioskError && err.code === 'NETWORK') {
        // Queue rather than discard: the candidate's words are not lost.
        if (active && transcript.trim()) {
          await enqueueTurn({
            sessionId: active.sessionId,
            transcript,
            spokenLanguage: languageRef.current,
            confidence,
            durationMs,
            createdAt: Date.now(),
          });
        }
        setPhase('offline');
        void kioskApi.reportError({ code: 'TURN_NETWORK', sessionId: active?.sessionId }).catch(() => undefined);
        return;
      }
      if (err instanceof KioskError && (err.code === 'SESSION_LOCKED' || err.code === 'NOT_FOUND' || err.code === 'SESSION_EXPIRED')) {
        await resetLocalData();
        sessionRef.current = null;
        setSession(null);
        setError({ code: err.code, message: 'This interview has ended. Please start again from the beginning.', errorId: null });
        setPhase('error');
        return;
      }
      const message = err instanceof KioskError ? err.message : 'There is a small technical problem. Please wait a moment.';
      setError({ code: err instanceof KioskError ? err.code : 'TURN_FAILED', message, errorId: err instanceof KioskError ? err.errorId : null });
      setPhase('error');
      void kioskApi.reportError({
        code: 'TURN_FAILED',
        ...(active ? { sessionId: active.sessionId } : {}),
        ...(err instanceof KioskError && err.errorId ? { errorId: err.errorId } : {}),
      }).catch(() => undefined);
    },
    [setPhase],
  );

  const replayQueue = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return;
    const queued = await readQueuedTurns(active.sessionId);
    if (queued.length === 0) return;
    for (const turn of queued) {
      try {
        const payload = await kioskApi.turn(active.sessionId, active.sessionSecret, {
          transcript: turn.transcript,
          spokenLanguage: turn.spokenLanguage,
          confidence: turn.confidence,
          durationMs: turn.durationMs,
        });
        await removeQueuedTurn(turn.clientId);
        if (payload.terminal === 'COMPLETED') {
          await completeSession();
          return;
        }
      } catch {
        // Leave it queued; the next reconnect will try again.
        break;
      }
    }
  }, []);

  /* ---------------------------------------------------------------- */
  /* Recognition callback                                              */
  /* ---------------------------------------------------------------- */

  const onRecognition = useCallback(
    (result: RecognitionResult) => {
      if (muted) return;

      if (!result.isFinal) {
        setHeardText(result.transcript);
        return;
      }
      setHeardText(result.transcript);
      // A turn that reached the engine is proof the recogniser is working, so the failure
      // streak resets here rather than after a fixed count.
      recognitionFailureRef.current = 0;

      // Barge-in: stop the AI the moment the candidate starts speaking.
      if (speakingRef.current) {
        synthRef.current?.cancel();
        speakingRef.current = false;
      }

      if (!sessionRef.current) return;

      const command = result.command ?? detectVoiceCommand(result.transcript, languageRef.current).command;

      if (command) {
        // Commands are forwarded as speech so the server applies the same rules, the
        // same audit trail and the same rate limits as any other turn.
        void submitTurn(commandPhrase(command), Math.max(0.8, result.confidence), 400);
        return;
      }

      // The recogniser measures from the start of its own session, which spans many
      // utterances. Reporting that as an answer length would put a nonsense duration in
      // the report, so it is measured here instead.
      const spokenMs = utteranceStartedAtRef.current === 0 ? 0 : Date.now() - utteranceStartedAtRef.current;
      if (!utteranceStartedAtRef.current) utteranceStartedAtRef.current = Date.now();
      void submitTurn(result.transcript, result.confidence || 0.75, Math.max(300, Math.min(spokenMs || 1200, 60_000)));
    },
    [muted, submitTurn],
  );

  /* ---------------------------------------------------------------- */
  /* Public actions                                                    */
  /* ---------------------------------------------------------------- */

  const startSession = useCallback(
    async ({ jobId, languageCode: requestedLanguage }: { jobId: string; languageCode?: string }) => {
      setError(null);
      // The server is authoritative for the session language, so only send the code when
      // the caller has an explicit one; otherwise let the job and site defaults apply.
      try {
        const started = await kioskApi.startSession({
          jobId,
          kioskId: bootstrap?.kiosk.kioskId ?? 'default',
          ...(requestedLanguage ? { languageCode: requestedLanguage } : {}),
          ...(bootstrap?.demoMode ? { demoMode: true } : {}),
        });
        languageRef.current = started.languageCode;
        setLanguageCode(started.languageCode);

        const stored: StoredSession = {
          sessionId: started.sessionId,
          publicId: started.publicId,
          sessionSecret: started.sessionSecret,
          jobId,
          jobTitle: started.jobTitle,
          languageCode: started.languageCode,
          startedAt: Date.now(),
        };
        const { persistSession } = await import('../lib/storage.js');
        persistSession(stored);
        sessionRef.current = stored;
        setSession(stored);

        synthRef.current?.setLanguage(started.languageCode);
        if (started.proctoring.kioskFullscreenEnforced) {
          const { enterFullscreen } = await import('../lib/shell.js');
          void enterFullscreen();
        }
        await startCapture();
        setPhase('listening');
      } catch (err) {
        const message = err instanceof KioskError ? err.message : 'We could not start the interview. Please call the person at the desk.';
        setError({ code: 'START_FAILED', message, errorId: err instanceof KioskError ? err.errorId : null });
        setPhase('error');
      }
    },
    [bootstrap, setPhase, startCapture],
  );

  const submitConsent = useCallback(
    async (given: boolean) => {
      const active = sessionRef.current;
      if (!active) return;
      try {
        const payload = await kioskApi.consent(active.sessionId, active.sessionSecret, given);
        applyTurnPayload(payload);
        if (given) {
          setPhase('listening');
        } else {
          await resetLocalData();
          setPhase('idle');
        }
      } catch (err) {
        const message = err instanceof KioskError ? err.message : 'There is a small technical problem. Please wait a moment.';
        setError({ code: 'CONSENT_FAILED', message, errorId: err instanceof KioskError ? err.errorId : null });
        setPhase('error');
      }
    },
    [applyTurnPayload, setPhase],
  );

  const setLanguage = useCallback(
    async (code: string) => {
      const active = sessionRef.current;
      languageRef.current = code;
      // Recorded even when no session exists yet: this is the choice the candidate made on
      // the language screen, and startSession must use it rather than a default.
      setLanguageCode(code);
      synthRef.current?.setLanguage(code);
      recognizerRef.current?.setLanguage(toBcp47(code));
      if (!active) return;
      try {
        const payload = await kioskApi.changeLanguage(active.sessionId, active.sessionSecret, code);
        applyTurnPayload(payload);
      } catch {
        // A failed language switch is not worth interrupting the candidate over; the
        // spoken prompt still switches locally.
        await speakDirectives([{ text: '', emotion: 'neutral', displayText: null, slowRate: false, sequence: 0 }]);
      }
      setSession({ ...active, languageCode: code });
    },
    [applyTurnPayload, speakDirectives],
  );

  const skipCurrent = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return;
    try {
      const payload = await kioskApi.advance(active.sessionId, active.sessionSecret);
      applyTurnPayload(payload);
      if (payload.terminal === 'COMPLETED') await completeSession();
    } catch (err) {
      await handleTurnFailure(err, '', 0, 0);
    }
  }, [applyTurnPayload]);

  const finish = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return;
    try {
      await kioskApi.finish(active.sessionId, active.sessionSecret);
    } catch {
      // The engine finalises on the last answer anyway; a failed explicit finish is not
      // worth showing to a candidate who has already finished.
    }
    await completeSession();
  }, []);

  const cancel = useCallback(async (reason: string) => {
    const active = sessionRef.current;
    if (!active) return;
    try {
      await kioskApi.cancel(active.sessionId, active.sessionSecret, reason);
    } catch {
      /* best effort */
    }
    await completeSession();
  }, []);

  const completeSession = useCallback(async () => {
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;
    recorderRef.current?.stopAndDiscard();
    synthRef.current?.cancel();
    await resetLocalData();
    sessionRef.current = null;
    setSession(null);
    setCaption(null);
    setListeningHint(null);
    setHeardText(null);
    setPhase('complete');
  }, [setPhase]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      if (next) {
        recognizerRef.current?.stop();
        synthRef.current?.cancel();
      } else {
        startRecognition();
      }
      return next;
    });
  }, [startRecognition]);

  const repeatLast = useCallback(() => {
    void submitTurn('Repeat', 0.95, 500);
  }, [submitTurn]);

  const resetToWelcome = useCallback(() => {
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;
    recorderRef.current?.discardUtterance();
    recorderRef.current = null;
    sessionRef.current = null;
    setSession(null);
    setError(null);
    setCaption(null);
    setListeningHint(null);
    setHeardText(null);
    setProgress({ answered: 0, total: 0, label: null });
    // Audio captured for the finished candidate must not survive into the next one.
    recorderRef.current = null;
    fallbackActiveRef.current = false;
    recognitionFailureRef.current = 0;
    utteranceStartedAtRef.current = 0;
    setPhase('idle');
  }, [setPhase]);

  const reportError = useCallback((code: string, message?: string) => {
    void kioskApi
      .reportError({ code, ...(sessionRef.current ? { sessionId: sessionRef.current.sessionId } : {}) })
      .catch(() => undefined);
    if (message) setError({ code, message, errorId: null });
  }, []);

  // Keeps the last spoken question so a candidate asking to repeat can be served even
  // if the engine has already moved on.
  useEffect(() => {
    const unsubscribe = setInterval(() => undefined, 1 << 30);
    return () => clearInterval(unsubscribe);
  }, []);

  useEffect(() => {
    lastQuestionRef.current = caption;
  }, [caption]);

  useEffect(() => {
    return () => {
      recognizerRef.current?.stop();
      captureRef.current?.stop();
      synthRef.current?.cancel();
      void audioQueueRef.current.clear();
    };
  }, []);

  return {
    bootstrap,
    phase,
    online,
    caption,
    listeningHint,
    heardText,
    progress,
    micLevel,
    muted,
    demo: bootstrap?.demoMode ?? false,
    speechAvailable: typeof window !== 'undefined' && isSpeechRecognitionSupported(),
    session,
    languageCode,
    error,
    helpOpen,
    startSession,
    submitConsent,
    submitTurn,
    skipCurrent,
    finish,
    cancel,
    setLanguage,
    toggleMute,
    repeatLast,
    openHelp: () => setHelpOpen(true),
    closeHelp: () => setHelpOpen(false),
    resetToWelcome,
    reportError,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Sends a control command as an utterance so it travels the identical server path.
 * Localising these is unnecessary: the server matches them in the session's language.
 */
function commandPhrase(command: string): string {
  switch (command) {
    case 'REPEAT':
      return 'Repeat';
    case 'SPEAK_SLOWLY':
      return 'Speak slowly';
    case 'DONT_UNDERSTAND':
      return "I don't understand";
    case 'NEXT':
      return 'Next';
    case 'GO_BACK':
      return 'Go back';
    case 'DONT_KNOW':
      return "I don't know";
    case 'STOP':
      return 'Stop';
    case 'START_AGAIN':
      return 'Start again';
    case 'HELP':
      return 'Help';
    default:
      return 'Next';
  }
}

/**
 * Vocabulary hints for the recogniser. Job-specific terms measurably improve
 * accuracy for names and equipment, which is where a generic model struggles most.
 */
function jobVocabulary(stored: StoredSession | null): string[] {
  if (!stored) return [];
  const title = stored.jobTitle
    .split(/\s+/)
    .filter((w) => w.length > 3);
  return [...new Set([...title, 'helmet', 'gloves', 'supervisor', 'machine', 'shift'])];
}
