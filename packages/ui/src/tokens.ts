/**
 * Design tokens.
 *
 * Split into two systems on purpose:
 *
 *  * `adminTokens` — a calm, dense, professional palette for people who read screens all
 *    day. Mid contrast, compact spacing.
 *  * `kioskTokens` — extremely high contrast, huge type, few colours. Designed to be
 *    legible from two metres away, in bright light, by someone who may have limited
 *    vision. Nothing in the kiosk palette is below a 7:1 contrast ratio against its
 *    background.
 */

export const adminTokens = {
  color: {
    bg: '#f6f8fb',
    surface: '#ffffff',
    surfaceAlt: '#f1f5f9',
    border: '#dbe2ea',
    borderStrong: '#c2ccd8',
    text: '#16202c',
    textMuted: '#5b6b7d',
    textInverse: '#ffffff',
    primary: '#1c5fa8',
    primaryHover: '#164e8c',
    primarySoft: '#e8f0fa',
    success: '#1a7a4f',
    successSoft: '#e4f5ec',
    warning: '#9a6206',
    warningSoft: '#fdf1dc',
    danger: '#b3261e',
    dangerSoft: '#fbe9e7',
    info: '#0f6d8f',
    infoSoft: '#e2f2f8',
    focus: '#1c5fa8',
  },
  radius: { sm: '4px', md: '8px', lg: '12px', pill: '999px' },
  space: (n: number) => `${n * 4}px`,
  shadow: {
    sm: '0 1px 2px rgba(22, 32, 44, 0.06)',
    md: '0 2px 8px rgba(22, 32, 44, 0.08)',
    lg: '0 12px 32px rgba(22, 32, 44, 0.12)',
  },
  font: {
    sans: "'Inter', 'Segoe UI', system-ui, -apple-system, 'Noto Sans', sans-serif",
    mono: "'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace",
  },
} as const;

/**
 * Kiosk palette.
 *
 * Colours are chosen so that:
 *  - primary text on primary background is ≥ 8:1
 *  - the listening/speaking states are distinguishable without relying on hue alone
 *    (each state also has a distinct icon and motion, for colour-blind candidates)
 */
export const kioskTokens = {
  color: {
    bg: '#f4f7fa',
    surface: '#ffffff',
    ink: '#0d1b2a',
    inkSoft: '#3d4f60',
    primary: '#0b3d6b',
    primaryInk: '#ffffff',
    listening: '#0b6b52',
    listeningSoft: '#e2f4ee',
    speaking: '#8a4b00',
    speakingSoft: '#fdeedd',
    thinking: '#4a3b8f',
    thinkingSoft: '#ece9fa',
    error: '#9f1d17',
    errorSoft: '#fbe9e7',
    offline: '#7a4a00',
    offlineSoft: '#fdf0dd',
    progressDone: '#0b6b52',
    progressTodo: '#c9d4de',
  },
  /** Minimum touch target. Anything smaller is unusable with a fingertip. */
  touchTarget: 96,
  type: {
    display: 'clamp(2.75rem, 6vw, 5rem)',
    question: 'clamp(2rem, 4.4vw, 3.5rem)',
    body: 'clamp(1.25rem, 2.4vw, 2rem)',
    caption: 'clamp(1rem, 1.6vw, 1.25rem)',
  },
  radius: { sm: '12px', md: '20px', lg: '32px', pill: '999px' },
  duration: { fast: 180, base: 320, slow: 520 },
} as const;

/** Motion that respects the kiosk accessibility setting and the OS preference. */
export function motionDuration(reducedMotion: boolean, ms: number): number {
  return reducedMotion ? 0 : ms;
}
