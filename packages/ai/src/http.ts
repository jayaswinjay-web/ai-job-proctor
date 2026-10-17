/** Minimal retrying fetch used by every server-side AI provider. */

export interface HttpOptions {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  /** Treat these HTTP statuses as retryable. */
  retryStatuses?: number[];
  onRetry?: (attempt: number, status?: number, error?: Error) => void;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly bodySnippet: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function httpRequest<T>(options: HttpOptions): Promise<T> {
  const {
    url,
    method = 'POST',
    headers = {},
    body,
    timeoutMs = 30_000,
    maxRetries = 2,
    signal,
    retryStatuses = [408, 409, 425, 429, 500, 502, 503, 504],
    onRetry,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new HttpError(`HTTP ${res.status} from provider`, res.status, text.slice(0, 500));
        if (retryStatuses.includes(res.status) && attempt < maxRetries) {
          onRetry?.(attempt + 1, res.status);
          await sleep(250 * 2 ** attempt);
          continue;
        }
        throw err;
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (err instanceof HttpError && !retryStatuses.includes(err.status)) throw err;
      if (attempt < maxRetries) {
        onRetry?.(attempt + 1, undefined, err as Error);
        await sleep(250 * 2 ** attempt);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Provider request failed');
}