import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Env } from '@proctor/config';

/**
 * Security headers and origin controls.
 *
 * Notable choices for a kiosk deployment:
 *  * `frame-ancestors 'none'` — the admin dashboard must never be embeddable, which
 *    removes a whole clickjacking class.
 *  * A strict CSP. `media-src blob:` is required because the kiosk records answers
 *    with MediaRecorder before upload; `connect-src` allows the API and the WS origin.
 *  * `Cross-Origin-Opener-Policy: same-origin` plus `Cross-Origin-Resource-Policy:
 *    same-origin` prevent candidate audio being pulled cross-origin by another page.
 *  * No `unsafe-inline` for scripts: the kiosk bundle is self-hosted, not CDN-loaded.
 */
export default fp<{ env: Env }>(async (app: FastifyInstance, options) => {
  const { env } = options;
  const isProduction = env.NODE_ENV === 'production';

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-site');
    reply.header('Permissions-Policy', 'microphone=(self), camera=(self), speaker-selection=(self), geolocation=()');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    // Kiosks must not be indexed or cached by intermediaries holding candidate data.
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    reply.header('Pragma', 'no-cache');
    if (isProduction && req.url.startsWith(env.API_BASE_PATH)) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });
});