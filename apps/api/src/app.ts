import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import type { z } from 'zod';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { corsOrigins } from '@proctor/config';
import type { Container } from './container.js';
import { AuditService } from './lib/audit.js';
import { AppError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import csrfPlugin from './plugins/csrf.js';
import errorPlugin from './plugins/error.js';
import securityPlugin from './plugins/security.js';
import { registerServices } from './services/registry.js';
import registerRoutes from './routes/index.js';
import registerRealtime from './realtime/ws.js';
import { zodBody, zodQuery, zodParams } from './lib/validation.js';

/**
 * Application factory.
 *
 * `createApp` builds a fully wired instance without listening on a port, which is what
 * the integration tests use. `server.ts` calls it and then listens.
 */
export interface BuildOptions {
  container: Container;
  /** Serve the built kiosk/admin bundles from the same origin (single-port deploy). */
  serveStatic?: boolean;
  staticRoot?: string;
  logger?: boolean;
}

export async function createApp(options: BuildOptions): Promise<FastifyInstance> {
  const { container } = options;
  const { env, logger } = container;
  const isProduction = env.NODE_ENV === 'production';

  const app = Fastify({
    logger: options.logger === false ? false : { level: env.LOG_LEVEL },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: env.BODY_LIMIT_BYTES,
    ajv: { customOptions: { removeAdditional: 'all', coerceTypes: true, useDefaults: true } },
    genReqId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  });

  await app.register(cookie, { secret: env.AUTH_SECRET, parseOptions: { path: '/' } });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin deployments and non-browser clients send no Origin header.
      if (!origin) return cb(null, true);
      const allowed = corsOrigins(env);
      if (allowed.includes(origin)) return cb(null, true);
      cb(new Error('Origin not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-csrf-token', 'x-proctor-signature', 'x-requested-with'],
    exposedHeaders: ['x-request-id', 'x-error-id'],
    maxAge: 600,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // Set via the security plugin where kiosk needs media-src blob:
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(errorPlugin, { logger, isProduction, apiBasePath: env.API_BASE_PATH });
  await app.register(securityPlugin, { env });

  // Global rate limit. Admin endpoints get a tighter limit via route config.
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (req) => `${req.ip}:${req.headers['x-kiosk-id'] ?? 'anon'}`,
    // Health checks must never be throttled or a load balancer will mark us unhealthy.
    allowList: (req) => req.url === env.HEALTHCHECK_PATH || req.url.endsWith('/healthz'),
    // Return a real AppError so the shared error handler produces the standard
    // envelope with a 429. Returning a bare object here would be wrapped as a 500,
    // which both misreports the cause and defeats client-side backoff logic.
    errorResponseBuilder: () => AppError.rateLimited(),
  });

  await app.register(csrfPlugin, { env });

  const ipSalt = env.IP_HASH_SALT || env.AUTH_SECRET;
  const audit = new AuditService(container.prisma, logger, ipSalt);
  await app.register(authPlugin, { authService: (await registerServices(container, audit)).auth, audit, ipSalt });

  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

  /**
   * Raw body support for audio uploads.
   *
   * The kiosk posts a recorded utterance to the server transcription fallback and PUTs
   * recordings as an `audio/*` body. Fastify only parses JSON and plain text by default
   * and answers 415 for anything else, so without this the fallback could never work —
   * the one path a browser that refuses Web Speech (Brave) relies on. The buffer is used
   * as-is; the routes read it directly. Each type is listed explicitly because a wildcard
   * is not matched by this Fastify version.
   */
  const audioContentTypes = [
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/L16',
    'application/octet-stream',
  ];
  for (const contentType of audioContentTypes) {
    app.addContentTypeParser(contentType, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  }

  // Registered before routes so the interview socket is available on the same origin.
  await app.register(websocket, {
    options: {
      // Generous, because a kiosk can sit idle between candidates while nobody speaks.
      maxPayload: 256 * 1024,
    },
  });

  /* ---- schema helpers --------------------------------------------------- */
  app.decorate('validateBody', <S extends z.ZodTypeAny>(schema: S) => zodBody(schema));
  app.decorate('validateQuery', <S extends z.ZodTypeAny>(schema: S) => zodQuery(schema));
  app.decorate('validateParams', <S extends z.ZodTypeAny>(schema: S) => zodParams(schema));

  /* ---- routes ----------------------------------------------------------- */
  await app.register(registerRoutes, { container, services: await registerServices(container, audit) });
  await app.register(registerRealtime, { container, services: await registerServices(container, audit) });

  /* ---- optional static hosting ----------------------------------------- */
  if (options.serveStatic) {
    const root = resolve(options.staticRoot ?? 'public');
    await app.register(fastifyStatic, {
      root,
      prefix: '/',
      index: false,
      // Candidate audio must never be served statically.
      serve: false,
    });
  }

  app.get(env.HEALTHCHECK_PATH, async () => ({ status: 'ok', version: container.version, demoMode: env.DEMO_MODE }));

  /**
   * Root landing response.
   *
   * Someone who opens the API origin in a browser almost always wants the kiosk or the
   * admin console, not a bare 404 envelope. Naming the real entry points turns a dead end
   * into the next step, and in a single-port deployment it is also what serves the app.
   */
  app.get('/', async (req) => {
    const url = new URL(req.url, 'http://localhost');
    const served = options.serveStatic === true;
    return {
      service: 'Voice Screening Kiosk API',
      version: container.version,
      demoMode: env.DEMO_MODE,
      api: env.API_BASE_PATH,
      health: env.HEALTHCHECK_PATH,
      kiosk: served ? '/' : 'http://localhost:5173',
      admin: served ? '/admin' : 'http://localhost:5174',
      docs: 'See README.md for the API reference.',
      path: url.pathname,
    };
  });

  void AppError;
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    validateBody: <S extends z.ZodTypeAny>(schema: S) => (req: unknown) => Promise<unknown>;
    validateQuery: <S extends z.ZodTypeAny>(schema: S) => (req: unknown) => Promise<unknown>;
    validateParams: <S extends z.ZodTypeAny>(schema: S) => (req: unknown) => Promise<unknown>;
  }
}