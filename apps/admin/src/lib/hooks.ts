import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api.js';

/**
 * Small data-fetching primitives.
 *
 * Deliberately hand-rolled: the dashboard needs abort-on-unmount, a manual refetch, and
 * an honest error state, and a full data library would be more code than that.
 */

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (updater: T | ((current: T | null) => T | null)) => void;
}

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((result) => {
        if (controller.signal.aborted || !mounted.current) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || !mounted.current) return;
        setError(describe(err));
      })
      .finally(() => {
        if (!controller.signal.aborted && mounted.current) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const update = useCallback((updater: T | ((current: T | null) => T | null)) => {
    setData((current) => (typeof updater === 'function' ? (updater as (c: T | null) => T | null)(current) : updater));
  }, []);

  return { data, error, loading, reload, setData: update };
}

export function describe(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

/** Field-keyed validation errors returned by the API, for inline form display. */
export function fieldErrors(err: unknown): Record<string, string[]> {
  if (err instanceof ApiError && err.details && typeof err.details === 'object' && !Array.isArray(err.details)) {
    return err.details as Record<string, string[]>;
  }
  return {};
}

/**
 * Persists a small amount of UI state (table filters, sidebar collapse) per browser.
 * Never used for anything security-relevant.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`admin.${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(`admin.${key}`, JSON.stringify(next));
      } catch {
        /* storage may be unavailable; the session still works */
      }
    },
    [key],
  );

  return [value, update];
}

/** Debounces a fast-changing value, used for search boxes. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
