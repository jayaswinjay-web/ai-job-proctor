import type { SVGProps } from 'react';

/**
 * Inline icon set.
 *
 * Hand-drawn as paths rather than pulled from an icon package: the kiosk bundle is
 * loaded on low-power hardware, and shipping ~40 icons to render five of them is a
 * measurable delay before the welcome screen appears.
 *
 * Every icon is `aria-hidden` by default and must be given a label by the caller,
 * because an unlabelled icon is invisible to a screen reader.
 */

export type IconName =
  | 'mic'
  | 'mic-off'
  | 'speaker'
  | 'volume-off'
  | 'speaker-wave'
  | 'check'
  | 'cross'
  | 'repeat'
  | 'help'
  | 'skip'
  | 'stop'
  | 'globe'
  | 'briefcase'
  | 'user'
  | 'alert'
  | 'wifi-off'
  | 'pause'
  | 'arrow-right'
  | 'arrow-left'
  | 'clock'
  | 'shield'
  | 'lock'
  | 'star'
  | 'users'
  | 'camera'
  | 'camera-off'
  | 'search'
  | 'filter'
  | 'download'
  | 'chevron-down'
  | 'chevron-right'
  | 'x'
  | 'menu'
  | 'settings'
  | 'file-text'
  | 'edit'
  | 'plus'
  | 'trash'
  | 'play'
  | 'trending-up'
  | 'clipboard-list'
  | 'sparkles';

const PATHS: Record<IconName, string> = {
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v4M8 22h8',
  'mic-off': 'M9 9v3a3 3 0 0 0 4.6 2.5M15 11.5V5a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 10.9 5.8M19 11a7 7 0 0 1-.4 2.4M12 18v4M8 22h8M3 3l18 18',
  speaker: 'M11 5 6 9H2v6h4l5 4V5z',
  'volume-off': 'M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6',
  'speaker-wave': 'M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  check: 'M20 6 9 17l-5-5',
  cross: 'M18 6 6 18M6 6l12 12',
  repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  skip: 'M5 4l10 8-10 8V4zM19 5v14',
  stop: 'M6 6h12v12H6z',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  briefcase: 'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  'wifi-off': 'M1 1l22 22M16.7 12.7A6 6 0 0 0 12 10M5 12.5A10 10 0 0 1 9 9.8M2 8.8a15 15 0 0 1 4.2-2.7M20 8.8a15 15 0 0 0-9.6-3.3M8.5 16.1a5 5 0 0 1 6.4-.5M12 20h.01',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  'arrow-right': 'M5 12h14M12 5l7 7-7 7',
  'arrow-left': 'M19 12H5M12 19l-7-7 7-7',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  lock: 'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3-6.2 3.3L7 14.2l-5-4.9 6.9-1L12 2z',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  'camera-off': 'M1 1l22 22M9 9a4 4 0 0 0 6 6M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l1.5 2.25',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5L22 3z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  x: 'M18 6 6 18M6 6l12 12',
  menu: 'M3 12h18M3 6h18M3 18h18',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.3 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 7 2.6 1.7 1.7 0 0 0 8 1.4V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 2.3a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  'file-text': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
  play: 'M5 3l14 9-14 9V3z',
  'trending-up': 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  'clipboard-list': 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM9 12h6M9 16h6',
  sparkles: 'M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2zM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6L5 2z',
};

/** Icons that read better filled than stroked. */
const FILLED: ReadonlySet<IconName> = new Set(['play', 'skip', 'trash', 'star']);

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Pixel size for both dimensions. */
  size?: number;
  /** Provide only when the icon is the sole content of an interactive control. */
  label?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 24, label, strokeWidth = 2, className, ...rest }: IconProps) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
