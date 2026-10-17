import { Icon, type IconName } from '@proctor/ui';
import type { KioskState } from '../ui.js';

/**
 * The microphone orb.
 *
 * It is the single most important element on the screen, so it carries four
 * redundant signals at once — colour, icon, a pulsing ring, and a live audio-level
 * glow. Nothing depends on any single one of them, which matters because a candidate
 * may not distinguish the colours, may not see the ring, or may not hear themselves.
 *
 * It is also a real button: tapping it stops and starts listening, because on a noisy
 * kiosk the fastest recovery is always "tap the microphone again".
 */
export function MicOrb({
  state,
  level,
  onToggle,
  disabled,
}: {
  state: KioskState;
  level: number;
  onToggle?: () => void;
  disabled?: boolean;
}) {
  const config: Record<KioskState, { icon: IconName; label: string; text: string }> = {
    listening: { icon: 'mic', label: 'Listening', text: 'I am listening' },
    speaking: { icon: 'speaker-wave', label: 'Speaking', text: 'Please listen' },
    thinking: { icon: 'help', label: 'Thinking', text: 'One moment' },
    error: { icon: 'alert', label: 'Problem', text: 'There is a problem' },
    offline: { icon: 'wifi-off', label: 'No connection', text: 'Please wait' },
    muted: { icon: 'mic-off', label: 'Microphone off', text: 'Microphone off' },
  };
  const current = config[state];

  return (
    <button
      type="button"
      className={`k-orb k-orb-${state}`}
      onClick={onToggle}
      disabled={disabled}
      aria-label={onToggle ? `${current.label}. Tap to ${state === 'listening' ? 'pause' : 'resume'}` : current.label}
      style={{ transform: `scale(${1 + level * 0.05})` }}
    >
      <span className="k-orb-ring" aria-hidden="true" />
      <span className="k-orb-level" style={{ ['--level' as string]: 1 + level * 0.4 }} aria-hidden="true" />
      <Icon name={current.icon} size={96} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

export function StateChip({ state }: { state: KioskState }) {
  const map: Record<KioskState, { icon: IconName; text: string }> = {
    listening: { icon: 'mic', text: 'I am listening — please speak' },
    speaking: { icon: 'speaker-wave', text: 'Please listen' },
    thinking: { icon: 'help', text: 'One moment please' },
    error: { icon: 'alert', text: 'There is a problem' },
    offline: { icon: 'wifi-off', text: 'Connection lost — your answers are saved' },
    muted: { icon: 'mic-off', text: 'Microphone is off' },
  };
  const current = map[state];
  return (
    <div className={`k-state k-state-${state}`}>
      <Icon name={current.icon} size={34} aria-hidden />
      <span>{current.text}</span>
    </div>
  );
}
