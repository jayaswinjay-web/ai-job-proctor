/**
 * Admin API client.
 *
 * Auth model
 * -----------
 *  * The refresh token lives in an httpOnly cookie set by the API and is never visible
 *    to this code.
 *  * The access token is held in memory only. It is deliberately NOT written to
 *    localStorage: a persisted token is exfiltratable by any injected script, and the
 *    short TTL plus silent refresh removes the need for it.
 *  * On a 401 the client refreshes once and retries, so an expired access token never
 *    surfaces to a user mid-task.
 */

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const listeners = new Set<(authenticated: boolean) => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of listeners) listener(Boolean(token));
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function onAuthChange(listener: (authenticated: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Refreshes the access token using the httpOnly cookie plus the CSRF double-submit token. */
export async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const csrf = readCookie('proctor_csrf');
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: csrf ? { 'x-csrf-token': csrf } : {},
      });
      if (!res.ok) {
        setAccessToken(null);
        return false;
      }
      const data = (await res.json()) as { accessToken: string };
      setAccessToken(data.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Set for multipart uploads, where the browser must set the boundary. */
  raw?: boolean;
  signal?: AbortSignal;
  retryOn401?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, options, true);
}

async function request<T>(path: string, options: RequestOptions, canRetry: boolean): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined && !options.raw) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const csrf = readCookie('proctor_csrf');
  if (csrf) headers['x-csrf-token'] = csrf;

  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : options.raw ? (options.body as BodyInit) : JSON.stringify(options.body),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (res.status === 401 && canRetry && options.retryOn401 !== false) {
    if (await refreshSession()) return request<T>(path, options, false);
    throw new ApiError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.', 401);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Request failed (${res.status})`,
      res.status,
      err?.details,
    );
  }

  return payload as T;
}

/** Builds a query string, dropping empty values so URLs stay readable in the audit log. */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : '';
}

/**
 * Triggers a file download through a short-lived signed URL where one exists.
 *
 * Exports are fetched with the access token rather than a plain link, so a URL copied
 * out of the browser cannot be replayed without a session.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    credentials: 'same-origin',
  });
  if (!res.ok) throw new ApiError('EXPORT_FAILED', 'The export could not be generated.', res.status);

  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
