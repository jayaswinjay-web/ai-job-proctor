/**
 * VoiceHire cloud voice agent entry point.
 *
 * Deployed to LiveKit Cloud (or a LiveKit-supported remote host) â€” it must NOT run on the
 * kiosk. On dispatch it joins the interview room, greets the candidate in Tamil, reads out
 * every job and language, runs the speaker/microphone tests, takes consent, creates the
 * interview session in the VoiceHire backend, and then conducts the questions using the
 * existing question database for follow-ups and scoring.
 *
 * Speech and language models.
 *
 * All three route through LiveKit's own agent gateway
 * (`https://agent-gateway.livekit.cloud/v1`) and authenticate with the
 * `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` the project already has â€” so **no Deepgram,
 * ElevenLabs, OpenAI or Google keys are needed**. Usage is billed to the LiveKit project
 * as inference credits.
 *
 * Every model is overridable by environment variable so it can be changed without a code
 * edit.
 */

// The worker is launched from the repository root (npm workspaces), so its own `.env`
// is not picked up automatically. It is loaded first â€” before the LiveKit CLI reads
// process.env to build the server options.
import { config as loadEnvFile } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
loadEnvFile({ path: resolve(here, '..', '.env'), quiet: true });
loadEnvFile({ path: resolve(here, '..', '..', '..', '.env'), quiet: true });

import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
  inference,
  type UserInputTranscribedEvent,
  type UserStateChangedEvent,
  AgentSessionEventTypes,
  asLanguageCode,
} from '@livekit/agents';
import {
  VoiceHireBackend,
  configFromEnv,
  type Directive,
  type JobOption,
  type LanguageOption,
  type SessionCreated,
} from './backend.js';
import {
  copy,
  isAffirmative,
  isNegative,
  isOptionsRequest,
  isRepeatRequest,
  jobsAnnouncement,
  languagesAnnouncement,
  matchOption,
  PHRASES,
} from './conversation.js';

/** Base speaking rate (1.0 = provider default). 1.0 is the natural pace for Tamil. */
const BASE_TTS_SPEED = Number(process.env.VOICE_TTS_SPEED ?? 1);
/** Rate used for directives the engine flags `slowRate`, or when the candidate asks to slow down. */
const SLOW_TTS_SPEED = Number(process.env.VOICE_TTS_SLOW_SPEED ?? 0.65);
/** Breathing room between consecutive spoken directives in one turn. */
const INTER_DIRECTIVE_PAUSE_MS = Number(process.env.VOICE_INTER_DIRECTIVE_PAUSE_MS ?? 350);
/**
 * Window after the agent stops speaking during which incoming transcripts are treated as
 * barge-in fragments and ignored, so a half-word or a cough never becomes a turn.
 */
const REPLY_SETTLE_MS = Number(process.env.VOICE_REPLY_SETTLE_MS ?? 400);
/** directive phraseKeys that are only for the opening and must not repeat after consent. */
const OPENING_PHRASE_KEYS = new Set(['welcome', 'consent_notice', 'consent_ask_confirm']);
/**
 * Silence window after a barge-in before re-asking the last question. The candidate may have
 * stopped the agent with a cough or a false start; if no answer follows, the agent repeats the
 * question rather than leaving them hanging.
 */
const FALSE_INTERRUPTION_RECOVERY_MS = Number(process.env.VOICE_RECOVERY_MS ?? 4000);
/**
 * How long to keep collecting speech after the last final transcript before acting on it. The
 * recogniser splits one answer into several finals at natural pauses ("à®Žà®©à®¤à¯ à®µà®¯à®¤à¯." + "à®¨à®¾à®±à¯à®ªà®¤à¯à®¤à¯
 * à®‡à®°à®£à¯à®Ÿà¯."); committing on the first fragment made the agent read the next question over the rest
 * of the answer, which was then dropped as a barge-in. Debouncing lets the fragments rejoin into a
 * single turn.
 */
const USER_UTTERANCE_SETTLE_MS = Number(process.env.VOICE_USER_SETTLE_MS ?? 1600);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildStt(keyterms: string[]) {
  // Speechmatics' `en_ta` code-switching pack leans English and mangles a lone Tamil word
  // ("à®šà®°à®¿" -> "Siri."), so we run the pure Tamil model for genuine Tamil understanding and
  // bias it with the English job / language names the candidate still has to be able to say
  // (spec Â§7/Â§8 lists, spec Â§20 Tamil-first). AssemblyAI's `multi` has no Tamil at all.
  const vocab = Array.from(new Set(keyterms.map((term) => term.trim()).filter(Boolean)));
  return new inference.STT({
    model: process.env.VOICE_STT_MODEL ?? 'speechmatics/linden-1',
    language: process.env.VOICE_STT_LANGUAGE ?? 'ta',
    ...(vocab.length
      ? { modelOptions: { additional_vocab: vocab.map((content) => ({ content })) } }
      : {}),
  });
}

function buildLlm() {
  return new inference.LLM({ model: process.env.VOICE_LLM_MODEL ?? 'google/gemini-2.5-flash' });
}

function buildTts() {
  // sonic-3.6 is the model that pronounces non-Latin text the way a local speaker
  // would; sonic-3 was audible as an English voice reading Tamil. The language code
  // alone does not choose the accent — the voice does — so `VOICE_TTS_VOICE` exists
  // to pin a Tamil voice ID from the Cartesia voice library once one is chosen.
  const voice = process.env.VOICE_TTS_VOICE?.trim();
  return new inference.TTS({
    model: process.env.VOICE_TTS_MODEL ?? 'cartesia/sonic-3.6',
    ...(voice ? { voice } : {}),
    language: process.env.VOICE_TTS_LANGUAGE ?? 'ta',
    modelOptions: { speed: BASE_TTS_SPEED },
  });
}

/**
 * Silero voice-activity detection, tuned so only a loud, sustained human voice registers as
 * speech. The SDK otherwise bundles this VAD with `activationThreshold: 0.5` and a 50ms
 * minimum â€” so a cough, a chair scrape or the room's own ambience would start a "speech"
 * segment, which stalls the agent (audio pause) and feeds noise to the STT. A high
 * activation probability (0.8) means quiet sounds never cross the bar, and requiring ~400ms
 * of continuous speech means brief transients (clicks, scrapes, single coughs) are ignored
 * entirely, while a clearly spoken word or phrase still starts a segment.
 */
function buildVad() {
  return new inference.VAD({
    model: 'silero',
    activationThreshold: Number(process.env.VOICE_VAD_ACTIVATION_THRESHOLD ?? 0.85),
    minSpeechDuration: Number(process.env.VOICE_VAD_MIN_SPEECH_MS ?? 700),
    minSilenceDuration: Number(process.env.VOICE_VAD_MIN_SILENCE_MS ?? 800),
    prefixPaddingDuration: Number(process.env.VOICE_VAD_PREFIX_MS ?? 400),
  });
}

type Phase = 'ASK_LANGUAGE' | 'CONFIRM_LANGUAGE' | 'ASK_JOB' | 'CONFIRM_JOB' | 'CONSENT' | 'INTERVIEW';

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const backend = new VoiceHireBackend(configFromEnv());
    await ctx.connect();

    // Heavy initialization happens BEFORE waitForParticipant so the greeting can fire
    // immediately when the kiosk joins — otherwise the ~600ms model-load blocks the event
    // loop and delays the first speak() call, making the agent seem to listen instead of talk.
    const intake = await backend.getIntakeContext();
    let language = intake.defaultLanguage || 'ta';

    const tts = buildTts();

    // Wait for the kiosk participant before speaking, so the greeting is not lost.
    await ctx.waitForParticipant();

    // One instruction block keeps the model in the interview role and enforces the
    // fairness rules from spec Â§21. The LLM is not asked to generate replies (turn
    // detection is `manual`); it is only here so the session has a well-formed agent.
    const instructions = [
      'You are the Rajapalayam Mills (Ramco Group) interview agent for a job screening kiosk.',
      `Speak to the candidate in ${language}. Start in ${language}.`,
      'Understand natural speech, dialects and Tamil-English code-switching; never correct grammar.',
      'Never pass judgement on accent, dialect, literacy or background.',
    ].join(' ');

    const session = new voice.AgentSession({
      stt: buildStt([
        ...intake.jobs.map((job) => job.title),
        ...intake.languages.flatMap((lang) => [lang.name, lang.nativeName ?? '']),
      ]),
      llm: buildLlm(),
      tts,
      // Loud-voice-only VAD; without this the SDK bundles silero at a hair-trigger threshold.
      vad: buildVad(),
      turnHandling: {
        // The interview script is authoritative and every spoken line comes from either the
        // static copy or the backend directives (via the UserInputTranscribed handler). The
        // LLM-driven `voice.Agent` loop is NOT used for replies â€” leaving turn detection on
        // made it auto-answer every utterance, so each answer was handled twice (`manual`
        // keeps STT running, so transcripts still arrive, but never auto-commits a user turn).
        turnDetection: 'manual',
        interruption: {
          // The agent must never be cut off mid-sentence: it always finishes reading its line
          // (the question) before it starts listening, and speech heard while it talks is
          // ignored. `resumeFalseInterruption: false` also turns off the SDK's "pause on any
          // speech start, resume 2s later" behaviour.
          enabled: false,
          resumeFalseInterruption: false,
          minDuration: 1000,
          minWords: 2,
          backchannelBoundary: null,
        },
        endpointing: {
          // More patience after the candidate's last word so short, pause-laden answers
          // ("I think... the second one") are captured whole.
          minDelay: 1200,
        },
      },
    });
    const agent = new voice.Agent({ instructions });
    await session.start({ agent, room: ctx.room });
    {
      const activity = (session as unknown as { activity?: Record<string, unknown> }).activity;
      console.log(
        `[voice-agent] interruption config turnDetection=${JSON.stringify(activity?.turnDetection)} mode=${JSON.stringify(
          activity?.turnDetectionMode,
        )} allowInterruptions=${JSON.stringify(activity?.allowInterruptions)} audioActivity=${JSON.stringify(
          activity?.isInterruptionByAudioActivityEnabled,
        )} detector=${JSON.stringify(Boolean(activity?.interruptionDetector))}`,
      );
    }

    // --- Conversation state -----------------------------------------------------
    let phase: Phase = 'ASK_LANGUAGE';
    let chosenJob: JobOption | null = null;
    let chosenLanguage: LanguageOption | null = null;
    let created: SessionCreated | null = null;
    let lastPrompt = '';
    /** True from the instant a render starts until a short settle window after it ends. */
    let speaking = false;
    let speakingGraceUntil = 0;
    /** Serialises turn handling so two final transcripts cannot interleave. */
    let busy = false;
    let slowActive = false;
    /** Whether the VAD currently hears the candidate speaking. */
    let userSpeaking = false;
    /** Re-asks the last question if a barge-in is not followed by an answer. */
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    /** Final transcript fragments gathered until the candidate pauses (see USER_UTTERANCE_SETTLE_MS). */
    let pendingUtterance = '';
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRecovery = (): void => {
      if (recoveryTimer) {
        clearTimeout(recoveryTimer);
        recoveryTimer = null;
      }
    };

    const setSpeed = (slow: boolean): void => {
      if (slow === slowActive) return;
      slowActive = slow;
      tts.updateOptions({ modelOptions: { speed: slow ? SLOW_TTS_SPEED : BASE_TTS_SPEED } });
    };

    /**
     * Speaks one line and waits for it to play out fully, so directives are never read over
     * each other. `slow` honours the engine's `slowRate`; `pauseMs` adds a gap afterwards.
     * Returns `false` when the line was interrupted (a barge-in), so the caller can stop
     * reading the rest of a multi-line script instead of talking over the candidate.
     */
    const speak = async (
      text: string,
      opts: { slow?: boolean; pauseMs?: number } = {},
    ): Promise<boolean> => {
      const clean = (text ?? '').trim();
      if (!clean) return true;
      speaking = true;
      speakingGraceUntil = Number.POSITIVE_INFINITY;
      setSpeed(Boolean(opts.slow));
      const handle = session.say(clean, { allowInterruptions: false });
      let interrupted = false;
      try {
        await handle;
        interrupted = handle.interrupted;
      } finally {
        setSpeed(false);
        speaking = false;
        console.log(
          `[voice-agent] say done interrupted=${interrupted} playout=${JSON.stringify(clean.slice(0, 40))}`,
        );
        // After a real barge-in, accept the candidate's words immediately rather than
        // discarding them as a settling fragment.
        speakingGraceUntil = interrupted ? 0 : Date.now() + REPLY_SETTLE_MS;
      }
      if (!interrupted && opts.pauseMs) await delay(opts.pauseMs);
      return !interrupted;
    };

    const speakDirectives = async (directives: Directive[]): Promise<void> => {
      for (const directive of directives) {
        if (!directive.text) continue;
        const finished = await speak(directive.text, {
          slow: directive.slowRate,
          pauseMs: INTER_DIRECTIVE_PAUSE_MS,
        });
        if (!finished) break;
      }
    };

    /** The most recent question-ish directive, kept for a pre-interview "repeat". */
    const rememberQuestion = (directives: Directive[]): void => {
      const question = [...directives].reverse().find((d) => d.text && d.phraseKey !== 'listening_prompt');
      if (question?.text) lastPrompt = question.text;
    };

    const publishSessionData = async (): Promise<void> => {
      if (!created) return;
      const localParticipant = ctx.room.localParticipant;
      if (!localParticipant) return;
      await localParticipant.publishData(
        new TextEncoder().encode(
          JSON.stringify({
            type: 'session',
            sessionId: created.sessionId,
            publicId: created.publicId,
            sessionSecret: created.sessionSecret,
          }),
        ),
        { reliable: true },
      );
    };

    const grantConsent = async (): Promise<void> => {
      if (!created) return;
      const payload = await backend.consent(created.publicId, true);
      phase = 'INTERVIEW';
      // `consent(true)` re-emits the opening plus the first question; drop the opening so we
      // do not ask for consent again after the candidate already agreed.
      const speakable = payload.directives.filter(
        (d) => d.text && !(d.phraseKey && OPENING_PHRASE_KEYS.has(d.phraseKey)),
      );
      await speakDirectives(speakable);
      rememberQuestion(speakable);
    };

    const declineConsent = async (): Promise<void> => {
      if (!created) return;
      phase = 'INTERVIEW';
      const payload = await backend.consent(created.publicId, false).catch(() => null);
      if (payload) await speakDirectives(payload.directives.filter((d) => d.text));
      else await speak(copy(PHRASES.READY, language));
    };

    const beginInterview = async (): Promise<void> => {
      if (!chosenJob || !chosenLanguage) return;
      const roomName = ctx.room.name ?? `interview-${ctx.job.id ?? 'unknown'}`;
      created = await backend.createSession({
        roomName,
        jobId: chosenJob.id,
        languageCode: chosenLanguage.code,
        consentGiven: false,
      });
      await backend
        .recordAgentSession(created.publicId, { voiceAgentSessionId: ctx.job.id ?? 'unknown', roomName })
        .catch(() => undefined);
      await publishSessionData();
      if (intake.privacyNoticeRequired) {
        phase = 'CONSENT';
        const consentText = copy(PHRASES.CONSENT, language);
        lastPrompt = consentText;
        await speak(consentText, { pauseMs: 200 });
      } else {
        await grantConsent();
      }
    };

    // Re-asks the last question when a barge-in is not followed by an answer, so a false
    // start (a cough that slipped past the VAD) never leaves the candidate in silence.
    const armRecovery = (): void => {
      clearRecovery();
      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;
        if (busy || speaking) return;
        if (userSpeaking) {
          armRecovery();
          return;
        }
        if (!lastPrompt) return;
        void (async () => {
          busy = true;
          try {
            await speak(lastPrompt, { pauseMs: 200 });
          } finally {
            busy = false;
          }
        })();
      }, FALSE_INTERRUPTION_RECOVERY_MS);
    };

    // The agent must not be interrupted: it reads every line out fully and only then listens.
    // We still track whether the candidate is speaking (used to decide when to re-ask), but we
    // never cut the agent off. Set VOICE_ALLOW_INTERRUPTION=true to restore loud-voice barge-in.
    const allowInterruption = process.env.VOICE_ALLOW_INTERRUPTION === 'true';
    session.on(AgentSessionEventTypes.UserStateChanged, (event: UserStateChangedEvent) => {
      console.log(`[voice-agent] userState ${event.oldState}->${event.newState}`);
      userSpeaking = event.newState === 'speaking';
      if (!allowInterruption) return;
      if (event.newState !== 'speaking' || !speaking) return;
      clearRecovery();
      speaking = false;
      speakingGraceUntil = 0;
      void Promise.resolve(session.interrupt()).catch(() => undefined);
      armRecovery();
    });

    // A turn handler that keeps the interview state machine authoritative. Barge-in fragments
    // (anything heard while the agent is speaking or just after) are ignored, so a half-word
    // never registers as an answer â€” that was the "if I interrupt it says it again" bug.
    const handleUtterance = async (utterance: string): Promise<void> => {
      clearRecovery();
      busy = true;
      try {
        // Before the interview starts, "repeat"/"options" re-reads the last prompt; during the
        // interview the backend engine owns those commands and paces the flow itself.
        if (phase !== 'INTERVIEW' && (isRepeatRequest(utterance) || isOptionsRequest(utterance))) {
          if (lastPrompt) await speak(lastPrompt, {});
          return;
        }

        switch (phase) {
          case 'ASK_JOB': {
            const job = matchOption(utterance, intake.jobs);
            if (!job) {
              await speak(copy(PHRASES.NOT_UNDERSTOOD, language));
              const again = jobsAnnouncement(intake.jobs.map((j) => j.title), language);
              lastPrompt = again;
              await speak(again, { pauseMs: 300 });
              return;
            }
            chosenJob = job;
            phase = 'CONFIRM_JOB';
            const confirm = copy(PHRASES.JOB_CONFIRM, language).replace('{job}', job.title);
            lastPrompt = confirm;
            await speak(confirm);
            return;
          }
          case 'CONFIRM_JOB': {
            if (isAffirmative(utterance)) {
              await beginInterview();
              return;
            }
            if (isNegative(utterance)) {
              chosenJob = null;
              phase = 'ASK_JOB';
              const again = jobsAnnouncement(intake.jobs.map((j) => j.title), language);
              lastPrompt = again;
              await speak(again, { pauseMs: 300 });
              return;
            }
            const confirm = copy(PHRASES.JOB_CONFIRM, language).replace('{job}', chosenJob?.title ?? '');
            lastPrompt = confirm;
            await speak(confirm);
            return;
          }
          case 'ASK_LANGUAGE': {
            const pick = matchOption(utterance, intake.languages);
            if (!pick) {
              await speak(copy(PHRASES.NOT_UNDERSTOOD, language));
              const again = languagesAnnouncement(
                intake.languages.map((l) => l.nativeName ?? l.name),
                language,
              );
              lastPrompt = again;
              await speak(again, { pauseMs: 300 });
              return;
            }
            chosenLanguage = pick;
            language = pick.code;
            tts.updateOptions({ language: asLanguageCode(language) });
            phase = 'CONFIRM_LANGUAGE';
            const confirm = copy(PHRASES.LANGUAGE_CONFIRM, language).replace(
              '{language}',
              pick.nativeName ?? pick.name,
            );
            lastPrompt = confirm;
            await speak(confirm);
            return;
          }
          case 'CONFIRM_LANGUAGE': {
            if (isAffirmative(utterance)) {
              phase = 'ASK_JOB';
              const prompt = jobsAnnouncement(
                intake.jobs.map((j) => j.title),
                language,
              );
              lastPrompt = prompt;
              await speak(prompt, { pauseMs: 300 });
              return;
            }
            if (isNegative(utterance)) {
              chosenLanguage = null;
              phase = 'ASK_LANGUAGE';
              const again = languagesAnnouncement(
                intake.languages.map((l) => l.nativeName ?? l.name),
                language,
              );
              lastPrompt = again;
              await speak(again, { pauseMs: 300 });
              return;
            }
            const confirm = copy(PHRASES.LANGUAGE_CONFIRM, language).replace(
              '{language}',
              chosenLanguage?.nativeName ?? chosenLanguage?.name ?? '',
            );
            lastPrompt = confirm;
            await speak(confirm);
            return;
          }
          case 'CONSENT': {
            if (isAffirmative(utterance)) {
              await grantConsent();
              return;
            }
            if (isNegative(utterance)) {
              await declineConsent();
              return;
            }
            const consentText = copy(PHRASES.CONSENT, language);
            lastPrompt = consentText;
            await speak(consentText, {});
            return;
          }
          case 'INTERVIEW': {
            if (!created) return;
            const payload = await backend.turn(created.publicId, {
              transcript: utterance,
              spokenLanguage: language,
            });
            await speakDirectives(payload.directives);
            rememberQuestion(payload.directives);
            if (payload.terminal === 'COMPLETED') {
              await backend.finish(created.publicId).catch(() => undefined);
              await speak(copy(PHRASES.READY, language));
            }
            return;
          }
        }
      } catch (error) {
        // Never let one bad turn tear down the session; log and keep listening.
        console.error('[voice-agent] turn handling failed', error);
      } finally {
        busy = false;
      }
    };

    // Acts on the merged utterance once the candidate has paused. Re-checks the guard flags so a
    // fragment that arrived just as the agent started speaking is still dropped.
    const flushPending = async (): Promise<void> => {
      pendingTimer = null;
      const utterance = pendingUtterance.trim();
      pendingUtterance = '';
      if (!utterance) return;
      if (busy) {
        // A previous turn is still being handled; hold the words and retry shortly.
        pendingUtterance = utterance;
        scheduleFlush(200);
        return;
      }
      if (speaking) {
        // The agent is still finishing its line. Keep the candidate's words and wait until it is
        // done, so the agent is never interrupted but never misses the answer either.
        pendingUtterance = utterance;
        scheduleFlush(300);
        return;
      }
      await handleUtterance(utterance);
    };

    const scheduleFlush = (ms = USER_UTTERANCE_SETTLE_MS): void => {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        void flushPending();
      }, ms);
    };

    session.on(AgentSessionEventTypes.UserInputTranscribed, (event: UserInputTranscribedEvent) => {
      console.log(
        `[voice-agent] stt final=${event.isFinal} phase=${phase} speaking=${speaking} graceMs=${
          speakingGraceUntil === Number.POSITIVE_INFINITY ? 'inf' : Math.round(speakingGraceUntil - Date.now())
        } busy=${busy} text=${JSON.stringify(event.transcript)}`,
      );
      if (!event.isFinal) return;
      const utterance = event.transcript.trim();
      if (!utterance) return;
      // Speech heard while the agent is talking is not thrown away: it is buffered and acted on
      // once the agent finishes its line. The one exception is a stray final in the settle window
      // when nothing was said during the line -- that is the agent's own voice looping back.
      if (!speaking && Date.now() < speakingGraceUntil && !pendingUtterance) {
        console.log(`[voice-agent] ignore (echo/settle): ${JSON.stringify(utterance)}`);
        return;
      }
      // Merge this final with any fragments still inside the settle window, then act once quiet.
      pendingUtterance = pendingUtterance ? `${pendingUtterance} ${utterance}` : utterance;
      scheduleFlush();
    });

    // --- WELCOME + LANGUAGE_SELECTION (Tamil-first) ---------------------------------
    await speak(copy(PHRASES.GREETING, language), { pauseMs: 200 });
    if (intake.languages.length === 0) {
      await speak(copy(PHRASES.NOT_UNDERSTOOD, language));
      return;
    }
    const langPrompt = languagesAnnouncement(
      intake.languages.map((l) => l.nativeName ?? l.name),
      language,
    );
    lastPrompt = langPrompt;
    await speak(langPrompt, { pauseMs: 300 });
    // `phase` is already ASK_LANGUAGE â€” the handler takes over from here.
  },
});

/**
 * The agent file is passed as a plain filesystem path.
 *
 * The default is `import.meta.url`, which is a `file:///F:/...` URL on Windows; the
 * worker supervisor then tries to import that URL as a relative module path and fails
 * with ERR_MODULE_NOT_FOUND. An absolute path works on every platform.
 */
cli.runApp(new WorkerOptions({ agent: fileURLToPath(new URL('./index.ts', import.meta.url)) }));
