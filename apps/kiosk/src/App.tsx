import { useCallback, useEffect, useState } from 'react';
import { kioskStyles } from './kiosk.css.js';
import { useKioskController, type KioskController } from './hooks/useKioskController.js';
import { useVoiceAgent } from './hooks/useVoiceAgent.js';
import { useFacePresence } from './hooks/useFacePresence.js';
import { TopBar, WelcomeScreen, WelcomeVideo } from './components/WelcomeScreen.js';
import { JobScreen, LanguageScreen } from './components/LanguageScreen.js';
import { CompletionScreen, ErrorScreen, HelpOverlay, InterviewScreen } from './components/InterviewScreen.js';
import { ConsentScreen } from './components/ConsentScreen.js';
import { ConfigurationErrorScreen, VoiceScreen, WaitingScreen } from './components/VoiceScreen.js';
import { installKioskGuards, keepScreenAwake } from './lib/shell.js';

/**
 * Kiosk application shell.
 *
 * Routing is a small explicit state machine rather than a router. A kiosk has one
 * linear journey, and a candidate should never be able to navigate backwards into a
 * broken state, use the browser back button, or land on an unexpected URL.
 */

type Screen = 'welcome' | 'language' | 'job' | 'consent' | 'interview' | 'complete' | 'error';

const FLOW_ORDER: readonly Screen[] = ['welcome', 'language', 'job', 'consent', 'interview', 'complete'];

/**
 * Whether the kiosk insists on seeing a face before the voice agent may speak.
 *
 * `true` (default): the agent stays silent until the local face-presence sidecar reports a
 * person at the camera — if that sidecar is not running the kiosk waits and says so.
 * `false`: an unreachable sidecar is treated as "present", so the kiosk still runs without
 * a camera (useful for development on a machine with no webcam).
 */
const FACE_GATE_REQUIRED = false;

export function App() {
  const kiosk = useKioskController();
  // The Ramco Mills intro plays once, as the kiosk loading screen, before any other
  // screen. The voice session only connects after it finishes, so the agent's greeting
  // is not lost behind the video.
  const [showIntro, setShowIntro] = useState(true);
  const voiceMode = kiosk.bootstrap?.voiceAi.mode === 'livekit';
  const voiceConfigured = kiosk.bootstrap?.voiceAi.configured ?? false;
  const allowBrowserFallback = kiosk.bootstrap?.voiceAi.allowBrowserFallback ?? false;

  // Face gate. The kiosk is silent until someone stands at the camera; the local
  // face-presence sidecar (scripts/face-presence.py) owns the webcam. Once a face has been
  // seen the gate stays latched for the rest of the session, so a candidate briefly looking
  // away does not cut off the interview.
  const face = useFacePresence(!showIntro && voiceMode);
  const [faceArmed, setFaceArmed] = useState(false);
  useEffect(() => {
    if (face.present) {
      setFaceArmed(true);
    } else if (!FACE_GATE_REQUIRED && face.status === 'unavailable') {
      setFaceArmed(true);
    }
  }, [face.present, face.status]);

  const voice = useVoiceAgent(kiosk.bootstrap, !showIntro && faceArmed);
  const [screen, setScreenRaw] = useState<Screen>(() => 'welcome');

  const introOverlay = showIntro ? <WelcomeVideo onFinished={() => setShowIntro(false)} /> : null;

  const setScreen = useCallback(
    (next: Screen) => {
      setScreenRaw((current) => {
        if (current === 'error' || current === 'complete') return next;
        const currentIndex = FLOW_ORDER.indexOf(current);
        const nextIndex = FLOW_ORDER.indexOf(next);
        // Never skip a step: a candidate who lands on the interview screen without
        // consent would be asked questions they did not agree to answer.
        if (nextIndex > currentIndex + 1) return current;
        return next;
      });
    },
    [],
  );

  // Phase changes drive terminal screens and recovery from an interrupted session.
  useEffect(() => {
    if (kiosk.phase === 'complete') {
      setScreenRaw('complete');
      return;
    }
    if (kiosk.phase === 'error') {
      setScreenRaw('error');
      return;
    }
    if (kiosk.session && screen === 'welcome') setScreenRaw('interview');
  }, [kiosk.phase, kiosk.session, screen]);

  // Kiosk hardening. A refresh mid-interview is caught and the session resumed; a
  // deliberate reset after completion is allowed through.
  useEffect(() => {
    let releaseWakeLock: (() => void) | undefined;
    void keepScreenAwake().then((release) => {
      releaseWakeLock = release;
    });

    const guards = installKioskGuards({
      preventRefresh: kiosk.session !== null || voice.binding !== null,
      onFullscreenExit: () => reportProctorEvent(proctorSession(kiosk, voice.binding), 'FULLSCREEN_EXITED', 0.9),
      onVisibilityChange: (visible) => {
        if (!visible) reportProctorEvent(proctorSession(kiosk, voice.binding), 'WINDOW_BLURRED', 0.6);
      },
      onBeforeUnload: () => {
        // Best effort: tell the server the kiosk is going away so the session can be
        // closed cleanly instead of lingering until the idle timeout.
        reportProctorEvent(proctorSession(kiosk, voice.binding), 'UNUSUAL_INTERRUPTION', 0.5);
      },
    });

    return () => {
      guards.dispose();
      releaseWakeLock?.();
    };
  }, [kiosk, voice.binding]);

  useEffect(() => {
    const reduced = kiosk.bootstrap?.kiosk.accessibility.reducedMotion ?? false;
    document.documentElement.classList.toggle('k-reduced-motion', reduced);
  }, [kiosk.bootstrap?.kiosk.accessibility.reducedMotion]);

  // Once consent has been given and a session exists, the interview screen owns the UI.
  const effectiveScreen: Screen =
    kiosk.session && screen === 'welcome' ? 'interview' : screen;

  /**
   * Voice-first mode.
   *
   * The cloud agent conducts the entire conversation; the kiosk is a thin audio terminal
   * and shows only a hands-free status screen. When the voice service is not configured we
   * refuse clearly rather than silently degrade to browser speech (spec §29) — unless an
   * administrator has explicitly enabled the development fallback.
   */
  if (voiceMode && kiosk.bootstrap) {
    if (!voiceConfigured && !allowBrowserFallback) {
      return (
        <>
          <style>{kioskStyles}</style>
          {introOverlay}
          {kiosk.demo && <div className="k-demo">DEMO MODE — SAMPLE DATA</div>}
          <ConfigurationErrorScreen message="Voice AI service is not configured. Please configure LiveKit Cloud and the required AI provider credentials." />
        </>
      );
    }
    if (voiceConfigured) {
      return (
        <>
          <style>{kioskStyles}</style>
          {introOverlay}
          {kiosk.demo && <div className="k-demo">DEMO MODE — SAMPLE DATA</div>}
          {faceArmed ? (
            <VoiceScreen voice={voice} />
          ) : (
            <WaitingScreen degraded={face.status === 'unavailable'} />
          )}
        </>
      );
    }
  }

  return (
    <>
      <style>{kioskStyles}</style>
      {introOverlay}

      {kiosk.demo && <div className="k-demo">DEMO MODE — SAMPLE DATA</div>}
      {kiosk.helpOpen && <HelpOverlay kiosk={kiosk} />}

      {effectiveScreen === 'welcome' && (
        <WelcomeScreen kiosk={kiosk} onContinue={() => setScreen('language')} />
      )}

      {effectiveScreen === 'language' && (
        <LanguageScreen
          languages={kiosk.bootstrap?.languages ?? []}
          current={kiosk.languageCode}
          onSelect={(code) => {
            void kiosk.setLanguage(code);
            setScreen('job');
          }}
          onBack={() => setScreen('welcome')}
        />
      )}

      {effectiveScreen === 'job' && (
        <JobScreen
          jobs={kiosk.bootstrap?.jobs ?? []}
          onSelect={(jobId) => {
            void (async () => {
              // The candidate's language choice is passed through explicitly. Falling back
              // to the first language here would start every interview in the wrong
              // language for anyone who chose another one.
              await kiosk.startSession({ jobId, languageCode: kiosk.languageCode });
              setScreen('consent');
            })();
          }}
          onBack={() => setScreen('language')}
        />
      )}

      {effectiveScreen === 'consent' && (
        <ConsentScreen
          kiosk={kiosk}
          onAgree={() => {
            void kiosk.submitConsent(true);
            setScreen('interview');
          }}
          onDecline={() => {
            void kiosk.submitConsent(false);
            setScreenRaw('complete');
          }}
        />
      )}

      {effectiveScreen === 'interview' && <InterviewScreen kiosk={kiosk} />}

      {effectiveScreen === 'complete' && (
        <CompletionScreen
          kiosk={kiosk}
          onDone={() => {
            kiosk.resetToWelcome();
            // Re-arm the face gate so the next candidate is greeted afresh, not the one
            // who has just left.
            setFaceArmed(false);
            setScreenRaw('welcome');
          }}
        />
      )}

      {effectiveScreen === 'error' && (
        <div className="k-screen">
          <TopBar kiosk={kiosk} title={kiosk.bootstrap?.siteName ?? 'Kiosk'} showHelp={false} />
          <ErrorScreen kiosk={kiosk} />
        </div>
      )}
    </>
  );
}

/**
 * Resolves the session to attach a proctoring event to.
 *
 * In browser mode it comes from the kiosk controller; in voice mode the session is created
 * by the cloud agent and pushed to the kiosk over LiveKit, so we use that binding.
 */
function proctorSession(
  kiosk: KioskController,
  binding: { sessionId: string; sessionSecret?: string } | null,
): { sessionId: string; sessionSecret: string } | null {
  if (kiosk.session) return kiosk.session;
  if (binding?.sessionSecret) return { sessionId: binding.sessionId, sessionSecret: binding.sessionSecret };
  return null;
}

/**
 * Reports a proctoring observation.
 *
 * Fire-and-forget, and failure is ignored on purpose: a proctoring event is a record of
 * what a detector saw, never a gate on the candidate's journey.
 */
function reportProctorEvent(
  session: { sessionId: string; sessionSecret: string } | null,
  type: string,
  confidence: number,
): void {
  if (!session) return;
  const url = `/api/v1/kiosk/sessions/${session.sessionId}/proctoring`;
  void fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionSecret: session.sessionSecret, type, confidence }),
  }).catch(() => undefined);
}
