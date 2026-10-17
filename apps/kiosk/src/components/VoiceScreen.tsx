import { Icon } from '@proctor/ui';
import { LiveRegion } from '../ui.js';
import type { VoiceAgentController } from '../hooks/useVoiceAgent.js';

/**
 * The hands-free interview screen.
 *
 * While the interview runs over LiveKit Cloud the screen is only visual reassurance: it
 * shows that the AI is listening or speaking and tells the candidate not to touch
 * anything. There are deliberately no buttons — the whole flow is conducted by voice
 * (spec §24).
 */
export function VoiceScreen({ voice }: { voice: VoiceAgentController }) {
  const connecting = voice.status === 'connecting' || voice.status === 'idle';
  const reconnecting = voice.status === 'reconnecting';

  const statusLine = connecting
    ? 'இணைக்கிறது…'
    : reconnecting
      ? 'இணைப்பு மீண்டும் ஏற்படுத்தப்படுகிறது…'
      : voice.status === 'disconnected'
        ? 'இணைப்பு துண்டிக்கப்பட்டது'
        : voice.agentSpeaking
          ? 'AI பேசுகிறது…'
          : 'AI கேட்கிறது…';

  return (
    <div className="k-screen">
      <main className="k-center" style={{ gap: 26, paddingTop: 20 }}>
        <h1 className="k-display" style={{ marginBottom: 0 }}>
          ராஜபாளையம் மில்ஸ் AI
        </h1>

        <div
          className={`k-orb ${voice.agentSpeaking ? 'k-orb-speaking' : 'k-orb-listening'}`}
          style={{ width: 190, height: 190, cursor: 'default' }}
          aria-hidden
        />

        <p className="k-question" style={{ margin: 0 }}>
          🎙️ நேர்காணல் நடைபெறுகிறது
        </p>

        <p className="k-body" aria-live="polite">
          {statusLine}
        </p>

        <Dots active={!connecting && !reconnecting} speaking={voice.agentSpeaking} />

        <p className="k-caption">திரையைத் தொட வேண்டாம்</p>
      </main>
    </div>
  );
}

/** Three gentle dots whose rhythm follows the conversation. */
function Dots({ active, speaking }: { active: boolean; speaking: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12 }} aria-hidden>
      <style>{`@keyframes k-dot-pulse { 0%,100% { opacity: .25 } 50% { opacity: 1 } }`}</style>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: 'var(--k-primary, #1f6feb)',
            display: 'inline-block',
            animation: active ? `k-dot-pulse ${speaking ? 0.7 : 1.4}s ease-in-out ${i * 0.18}s infinite` : 'none',
            opacity: active ? 1 : 0.25,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Shown after the intro while the kiosk waits for someone to step in front of the camera.
 *
 * The voice agent stays silent until a face is detected, so a candidate is never greeted
 * into an empty room. There is nothing to touch: the moment a face appears the greeting
 * begins on its own.
 */
export function WaitingScreen({ degraded = false }: { degraded?: boolean }) {
  return (
    <div className="k-screen">
      <style>{`@keyframes k-scan { 0%,100% { transform: scale(1); opacity: .55 } 50% { transform: scale(1.08); opacity: 1 } }`}</style>
      <main className="k-center" style={{ gap: 24, paddingTop: 20 }}>
        <h1 className="k-display" style={{ marginBottom: 0 }}>
          வரவேற்கிறோம்
        </h1>

        <div
          className="k-orb k-orb-listening"
          style={{ width: 190, height: 190, cursor: 'default', animation: 'k-scan 2.4s ease-in-out infinite' }}
          aria-hidden
        >
          <Icon name={degraded ? 'camera-off' : 'user'} size={96} color="#fff" />
        </div>

        <p className="k-question" style={{ margin: 0 }}>
          கேமராவின் முன் நில்லுங்கள்
        </p>

        <p className="k-body" style={{ maxWidth: '24ch' }}>
          Please stand in front of the camera.
        </p>

        <p className="k-caption">
          நீங்கள் வந்ததும் நான் பேசத் தொடங்குவேன் · I will begin as soon as I see you.
        </p>

        {degraded && (
          <div className="k-state k-state-offline" style={{ maxWidth: 620 }} role="status">
            <Icon name="alert" size={30} aria-hidden />
            <span>Camera check is unavailable. Please call the person at the desk.</span>
          </div>
        )}

        <LiveRegion message="Please stand in front of the camera. I will begin as soon as I see you." />
      </main>
    </div>
  );
}

/**
 * Shown when the voice service is not configured.
 *
 * The message is for the operator, not the candidate: the kiosk refuses to pretend the
 * interview can run (spec §29).
 */
export function ConfigurationErrorScreen({ message }: { message: string }) {
  return (
    <div className="k-screen">
      <main className="k-center" style={{ gap: 20 }}>
        <h1 className="k-question">Voice AI service is not configured</h1>
        <p className="k-body">{message}</p>
        <p className="k-caption">Please contact the person at the desk for assistance.</p>
      </main>
    </div>
  );
}
