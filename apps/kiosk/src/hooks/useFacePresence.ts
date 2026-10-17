import { useEffect, useRef, useState } from 'react';

/**
 * Polls the local face-presence sidecar (`scripts/face-presence.py`) and reports whether a
 * person is in front of the camera.
 *
 * The sidecar owns the webcam and does the OpenCV detection; this hook only asks it a
 * yes/no question a couple of times a second. It is intentionally forgiving:
 *
 *  * `checking`  — no answer yet, the service was just started.
 *  * `ready`     — the service answered; `present` is trustworthy.
 *  * `unavailable` — the service could not be reached. The kiosk treats this as a
 *    degraded mode (see `App`), so a missing sidecar cannot brick the whole kiosk.
 */

export type FaceStatus = 'checking' | 'ready' | 'unavailable';

export interface FacePresence {
  /** A face is in front of the camera right now (the sidecar applies a short hold). */
  present: boolean;
  /** How many faces the last frame contained. */
  count: number;
  status: FaceStatus;
}

const FACE_URL = import.meta.env.VITE_FACE_URL ?? 'http://localhost:8090';
const POLL_MS = 650;
/** Failures in a row before we decide the sidecar is simply not running. */
const FAILURES_BEFORE_UNAVAILABLE = 4;

export function useFacePresence(enabled: boolean): FacePresence {
  const [present, setPresent] = useState(false);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<FaceStatus>('checking');
  const failuresRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`${FACE_URL}/presence`, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { face?: boolean; count?: number };
        if (cancelled) return;
        failuresRef.current = 0;
        setStatus('ready');
        setPresent(Boolean(data.face));
        setCount(typeof data.count === 'number' ? data.count : 0);
      } catch {
        if (cancelled) return;
        failuresRef.current += 1;
        if (failuresRef.current >= FAILURES_BEFORE_UNAVAILABLE) {
          setStatus('unavailable');
          setPresent(false);
          setCount(0);
        }
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return { present, count, status };
}
