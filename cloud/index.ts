import { DurableObject } from 'cloudflare:workers';

/**
 * Cloudflare Containers front-end for the VoiceHire API.
 *
 * The API is an ordinary Node/Fastify server and runs unchanged inside a Cloudflare
 * Container; this Worker only proxies requests to it. Static kiosk/admin assets are
 * served by Workers Static Assets, and any path that is not an asset is forwarded to
 * the container, so the whole product keeps its single-origin deployment shape.
 *
 * Secrets never enter the image: they are stored as Worker secrets and forwarded to the
 * container on start-up.
 */

/** Port the API listens on inside the container (set by Dockerfile.api). */
const CONTAINER_PORT = 8080;
/** Health path the API answers (must match HEALTHCHECK_PATH). */
const HEALTH_PATH = '/healthz';
/**
 * Keep a container warm between candidates. A kiosk can sit idle for a long while, and
 * restarting Node plus the Prisma engine on the next candidate would add a cold-start
 * delay right before the interview starts.
 */
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;
/** How long to wait for the container to answer /healthz before giving up. */
const READY_ATTEMPTS = 150;
const READY_RETRY_MS = 200;

/** Configuration that must be forwarded from Worker secrets into the container. */
const FORWARDED_ENV_KEYS = [
  'DATABASE_URL',
  'AUTH_SECRET',
  'AGENT_API_KEY',
  'IP_HASH_SALT',
  'LLM_PROVIDER',
  'LLM_MODEL',
  'EVALUATION_MODEL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'STORAGE_DRIVER',
  'CORS_ORIGINS',
  'DEMO_MODE',
  'LOG_LEVEL',
] as const;

interface Env {
  BACKEND: DurableObjectNamespace<ApiContainer>;
  ASSETS: Fetcher;
  [key: string]: unknown;
}

export class ApiContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
    }
  }

  async fetch(request: Request): Promise<Response> {
    // Serialise start-up so a burst of simultaneous requests shares one health check.
    this.starting ??= this.startAndWaitForHealth().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const url = new URL(request.url);
    url.protocol = 'http:';
    url.host = 'container';
    const forwarded = new Request(url, request);
    forwarded.headers.delete('host');
    return this.ctx.container!.getTcpPort(CONTAINER_PORT).fetch(forwarded);
  }

  private async startAndWaitForHealth(): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error('No container is configured for this Durable Object');

    if (!container.running) {
      const env: Record<string, string> = {};
      for (const key of FORWARDED_ENV_KEYS) {
        const value = this.env[key];
        if (typeof value === 'string') env[key] = value;
      }
      container.start({
        image: container.images.base,
        instance: 'standard-1',
        // The API reaches Neon and the LiveKit inference gateway over the public
        // internet, so outbound access is required.
        enableInternet: true,
        env,
      });
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(CONTAINER_PORT);
    let lastError: unknown;
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
      try {
        const response = await port.fetch(`http://container${HEALTH_PATH}`, {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (!response.ok) {
          throw new Error(`Health check returned HTTP ${response.status}`);
        }
        return;
      } catch (error) {
        lastError = error;
        await scheduler.wait(READY_RETRY_MS);
      }
    }
    throw new Error('Container did not become ready on port 8080', { cause: lastError });
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/') || pathname === HEALTH_PATH) {
      // One named instance: the API keeps rate-limit and DB-pool state in memory, so it
      // must be a single always-warm server rather than a pool.
      return env.BACKEND.getByName('voicehire-api').fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
