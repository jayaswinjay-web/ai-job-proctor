import { kioskTokens as k } from '@proctor/ui';

/**
 * Kiosk shell behaviour.
 *
 * Everything here exists to stop a candidate — accidentally or deliberately — from
 * leaving the interview, and to keep the screen awake while they are answering.
 *
 * Note on what is *not* attempted: nothing here claims to be a security boundary. A
 * determined user with physical access to a kiosk browser can defeat all of it. The
 * actual controls are server-side — the session secret, the completed-session lock, and
 * the fact that a kiosk session grants no access to any other candidate's data. This
 * layer only removes accidents.
 */

let wakeLock: WakeLockSentinel | null = null;

export interface KioskShell {
  release(): void;
  dispose(): void;
}

/** Keeps the display awake for the duration of an interview. */
export async function keepScreenAwake(): Promise<() => void> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return () => undefined;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    wakeLock = null;
  }
  return () => {
    void wakeLock?.release().catch(() => undefined);
    wakeLock = null;
  };
}

export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.fullscreenElement);
}

export async function enterFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  if (isFullscreen()) return true;
  try {
    await document.documentElement.requestFullscreen();
    return true;
  } catch {
    // Denied (no user gesture, or kiosk policy). The kiosk still works windowed.
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  try {
    await document.exitFullscreen();
  } catch {
    /* no-op */
  }
}

/**
 * Installs the guard rails.
 *
 * @param options.preventRefresh ask before reloading when a session is active
 * @param options.onFullscreenExit fired when the candidate exits fullscreen
 * @param options.onVisibilityChange fired when the tab is hidden/shown
 */
export function installKioskGuards(options: {
  preventRefresh: boolean;
  onFullscreenExit?: () => void;
  onVisibilityChange?: (visible: boolean) => void;
  onBeforeUnload?: () => void;
}): KioskShell {
  const handler = (event: BeforeUnloadEvent) => {
    if (!options.preventRefresh) return undefined;
    options.onBeforeUnload?.();
    event.preventDefault();
    // Legacy browsers ignore the modern dialog contract; returning a message is the
    // only lever they offer.
    event.returnValue = '';
    return '';
  };
  window.addEventListener('beforeunload', handler);

  const onFullscreen = () => {
    if (!isFullscreen()) options.onFullscreenExit?.();
  };
  document.addEventListener('fullscreenchange', onFullscreen);

  const onVisibility = () => options.onVisibilityChange?.(document.visibilityState === 'visible');
  document.addEventListener('visibilitychange', onVisibility);

  // Suppress the context menu so a long-press cannot surface browser affordances.
  const onContextMenu = (event: MouseEvent) => event.preventDefault();
  document.addEventListener('contextmenu', onContextMenu);

  // Block the browser's own shortcuts that would navigate away.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!options.preventRefresh) return;
    const blocked =
      (event.key === 'F5' && !event.ctrlKey) ||
      (event.ctrlKey && event.key.toLowerCase() === 'r') ||
      (event.ctrlKey && event.key.toLowerCase() === 'w') ||
      (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'i');
    if (blocked) {
      event.preventDefault();
      options.onFullscreenExit?.();
    }
  };
  window.addEventListener('keydown', onKeyDown, true);

  return {
    release() {
      void exitFullscreen();
      void wakeLock?.release().catch(() => undefined);
      wakeLock = null;
    },
    dispose() {
      window.removeEventListener('beforeunload', handler);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown, true);
    },
  };
}

/**
 * Announces whether the network is up.
 *
 * Candidates are told in plain words, through the same voice channel as everything
 * else, rather than being shown a connectivity icon they may not interpret.
 */
export function describeConnectivity(online: boolean): string {
  return online
    ? ''
    : 'The connection is temporarily lost. Please wait. Your answers are saved on this machine.';
}

export const KIOSK_COLORS = k.color;
