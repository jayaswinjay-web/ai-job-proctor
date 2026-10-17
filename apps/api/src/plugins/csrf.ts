import { createHmac, timingSafeEqual } from 'node:crypto';
// Registers the `req.cookies` / `reply.setCookie` type augmentation.
import type {} from '@fastify/cookie';
import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '@proctor/config';
import { AppError } from '../lib/errors.js';

/**
 * CSRF protection for cookie-authenticated mutations.
 *
 * SameSite-only defence is deliberately not relied upon: kiosk and admin origins
 * legitimately differ in development, and the admin SPA also authenticates with a
 * Bearer access token that is not ambiently attached by the browser.
 *
 * The scheme here is a signed double-submit token:
 *   * The token is an HMAC of the session's refresh cookie, computed with the server
 *     secret, so it cannot be forged offline.
 *   * Because the refresh token rotates on every use, a token captured from an
 *     earlier session cannot validate a later one.
 *   * Requests authenticated purely by a Bearer access token are exempt, because the
 *     browser never attaches that credential on its own.
 *   * Requests carrying neither a cookie nor a form content type are exempt, since
 *     they cannot be forged cross-origin with ambient credentials.
 *   * Kiosk routes are exempt outright: they authenticate with a per-session secret,
 *     never the refresh cookie, so a cookie arriving there is incidental rather than
 *     the credential under protection.
 */
export interface CsrfOptions {
  env: Env;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Present when the request is cookie-authenticated. */
    csrfToken?: string;
    /** True when a refresh cookie was presented, regardless of token validity. */
    hasSessionCookie?: boolean;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export default fp<CsrfOptions>(async (app: FastifyInstance, options: CsrfOptions) => {
  const { env } = options;

  app.decorateRequest('csrfToken', undefined);
  app.decorateRequest('hasSessionCookie', false);

  app.addHook('onRequest', async (req: FastifyRequest) => {
    /**
     * Kiosk routes are never cookie-authenticated: a kiosk has no account and identifies
     * itself with a per-session secret. They would only ever "present" a cookie by
     * accident — cookies are matched without regard to port, so a session signed into the
     * admin console on the same host makes the kiosk look cookie-authenticated and turns
     * every kiosk write into a rejected CSRF attempt. Skipping them here keeps the kiosk
     * independent of any admin session instead of depending on how narrowly the cookie is
     * scoped.
     */
    if (isKioskPath(req.url, env.API_BASE_PATH)) return;

    const refreshCookie = req.cookies?.[env.AUTH_COOKIE_NAME];
    const hasSessionCookie = typeof refreshCookie === 'string' && refreshCookie.length > 0;
    req.hasSessionCookie = hasSessionCookie;

    if (!hasSessionCookie) return;
    const token = deriveCsrfToken(refreshCookie, env.AUTH_SECRET);
    req.csrfToken = token;

    if (SAFE_METHODS.has(req.method)) return;

    // A cross-origin form post can carry the cookie but not a custom header, so it
    // is rejected on content type alone before any token comparison.
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    const isFormLike = contentType === 'application/x-www-form-urlencoded' || contentType === 'multipart/form-data';
    if (isFormLike) {
      throw AppError.forbidden('Form submissions are not accepted on this endpoint.');
    }

    // Cookie present *and* a custom header is the only shape a browser cannot forge
    // cross-origin, so this is the case that needs a token comparison.
    const provided = req.headers['x-csrf-token'];
    if (typeof provided !== 'string' || provided.length === 0 || !safeEqual(provided, token)) {
      throw AppError.forbidden('Invalid or missing CSRF token.');
    }
  });

  // Keep the cookie and the readable token in sync for the SPA.
  app.addHook('onSend', async (req: FastifyRequest, reply: FastifyReply, payload) => {
    const token = req.csrfToken;
    if (token && req.cookies?.['proctor_csrf'] !== token) {
      reply.setCookie('proctor_csrf', token, {
        httpOnly: false,
        sameSite: 'lax',
        secure: env.AUTH_COOKIE_SECURE,
        path: '/',
        maxAge: env.AUTH_REFRESH_TOKEN_TTL_HOURS * 3600,
      });
    }
    return payload;
  });
});

export function deriveCsrfToken(refreshCookie: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:${refreshCookie}`).digest('base64url');
}

/** True when the request targets a kiosk route, which is never cookie-authenticated. */
function isKioskPath(url: string, apiBasePath: string): boolean {
  const path = url.split('?')[0] ?? url;
  return path.startsWith(`${apiBasePath}/kiosk`);
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}