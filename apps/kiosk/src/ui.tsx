import { kioskTokens as k } from '@proctor/ui';
import type { CSSProperties } from 'react';

/** Small inline helpers so screens stay declarative and consistent. */

export function KButton({
  children,
  onClick,
  variant = 'primary',
  disabled,
  icon,
  ariaLabel,
  type = 'button',
  style,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  icon?: React.ReactNode;
  ariaLabel?: string;
  type?: 'button' | 'submit';
  style?: CSSProperties;
}) {
  return (
    <button
      type={type}
      className={`k-btn k-btn-${variant}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={style}
    >
      {icon}
      {children}
    </button>
  );
}

/** Announced politely rather than assertively: kiosk speech is already the channel. */
export function LiveRegion({ message }: { message: string }) {
  return (
    <div className="k-sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

export function ProgressDots({
  answered,
  total,
  label,
}: {
  answered: number;
  total: number;
  label?: string | null;
}) {
  if (total <= 0) return null;
  // Cap the visual at 12 so the row stays readable on a small screen.
  const visible = Math.min(total, 12);
  const doneRatio = total <= visible ? answered : Math.round((answered / total) * visible);

  return (
    <div className="k-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
      {Array.from({ length: visible }, (_, i) => (
        <span
          key={i}
          className={`k-dot${i < doneRatio ? ' k-dot--done' : ''}${i === doneRatio ? ' k-dot--current' : ''}`}
          aria-hidden="true"
        />
      ))}
      {label && <span className="k-progress-label">{label}</span>}
    </div>
  );
}

export type KioskState = 'listening' | 'speaking' | 'thinking' | 'error' | 'offline' | 'muted';

export function StateBanner({ state, children }: { state: KioskState; children: React.ReactNode }) {
  return <div className={`k-state k-state-${state}`}>{children}</div>;
}

/** Cards that fill their container height on large displays. */
export function fillRow(style?: CSSProperties): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    flexWrap: 'wrap',
    ...style,
  };
}

export function orbSize(): string {
  return `clamp(180px, 22vw, 280px)`;
}

export const KIOSK_PADDING = { padding: 'clamp(24px, 4vw, 56px)' } as const;

export function visuallyHidden(): CSSProperties {
  return {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
  };
}

export function useReducedMotionPref(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export { k };
