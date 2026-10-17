import { useCallback, useEffect, useRef, useState } from 'react';
import { kioskApi, KioskError, type BootstrapPayload } from '../lib/api.js';
import { connectVoiceRoom, type VoiceBinding, type VoiceConnection, type VoiceStatus } from '../lib/voice.js';

/**
 * Drives the LiveKit Cloud thin-client connection for the voice-first kiosk.
 *
 * The kiosk itself decides nothing about the conversation: it fetches a short-lived token,
 * joins the room, publishes the microphone and plays the agent. Everything else —
 * greeting, job/language selection, tests, consent, questions and evaluation — happens in
 * the cloud agent.
 */

export interface VoiceAgentController {
  status: VoiceStatus;
  agentSpeaking: boolean;
  /** Session binding pushed by the agent once the interview session is created. */
  binding: VoiceBinding | null;
  error: { code: string; message: string } | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const NOT_CONFIGURED_MESSAGE =
  'Voice AI service is not configured. Please configure LiveKit Cloud and the required AI provider credentials.';

export function useVoiceAgent(bootstrap: BootstrapPayload | null, enabled = true): VoiceAgentController {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [binding, setBinding] = useState<VoiceBinding | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const connectionRef = useRef<VoiceConnection | null>(null);
  const startingRef = useRef(false);

  const stop = useCallback(async () => {
    const connection = connectionRef.current;
    connectionRef.current = null;
    if (connection) await connection.disconnect();
    setStatus('disconnected');
  }, []);

  const start = useCallback(async () => {
    if (!bootstrap || startingRef.current || connectionRef.current) return;
    if (bootstrap.voiceAi.mode !== 'livekit') return;

    if (!bootstrap.voiceAi.configured) {
      // Deliberately explicit: never silently fall back to the browser pipeline in
      // production (spec §29).
      setError({ code: 'VOICE_AI_NOT_CONFIGURED', message: NOT_CONFIGURED_MESSAGE });
      return;
    }

    startingRef.current = true;
    try {
      const token = await kioskApi.voiceIntakeToken(bootstrap.kiosk.kioskId);
      connectionRef.current = await connectVoiceRoom({
        url: token.url,
        token: token.token,
        handlers: {
          onStatus: (next) => {
            setStatus(next);
            if (next === 'disconnected' && !connectionRef.current) setStatus('disconnected');
          },
          onAgentSpeaking: setAgentSpeaking,
          onData: (message) => {
            // The agent pushes the session binding once the candidate has chosen a job and
            // language and consent is given, so the kiosk can report proctoring events.
            if (message.type === 'session' && typeof message.sessionId === 'string') {
              setBinding({
                sessionId: message.sessionId,
                ...(typeof message.publicId === 'string' ? { publicId: message.publicId } : {}),
                ...(typeof message.sessionSecret === 'string' ? { sessionSecret: message.sessionSecret } : {}),
              });
            }
          },
        },
      });
    } catch (err) {
      const message =
        err instanceof KioskError ? err.message : 'Could not reach the voice service.';
      setError({ code: err instanceof KioskError ? err.code : 'VOICE_CONNECT_FAILED', message });
      setStatus('disconnected');
    } finally {
      startingRef.current = false;
    }
  }, [bootstrap]);

  // Auto-start once bootstrap is known and the kiosk is in LiveKit mode. Keyed on the
  // mode/config only, so a re-render never tears the connection down. `enabled` is false
  // while the introductory video is on screen, so the agent's greeting is not missed.
  useEffect(() => {
    if (!bootstrap) return;
    if (bootstrap.voiceAi.mode !== 'livekit') return;
    if (!enabled) return;
    void start();
    return () => {
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap?.voiceAi.mode, bootstrap?.voiceAi.configured, enabled]);

  return { status, agentSpeaking, binding, error, start, stop };
}
