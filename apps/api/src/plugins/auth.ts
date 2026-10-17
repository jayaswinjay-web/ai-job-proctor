import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';
import { hasPermission, type AuthenticatedUser, type AuthService } from '../services/auth.service.js';
import { PERMISSIONS, type Permission } from '@proctor/types';
import type { AuditActor, AuditService } from '../lib/audit.js';
import { hashIp, normaliseIp } from '../lib/crypto.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Authenticates the request. Throws 401 when absent/invalid. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Authenticates and asserts every listed permission. */
    requirePermission: (
      permissions: Permission | Permission[],
      options?: { all?: boolean },
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    audit: AuditService;
    authService: AuthService;
    /** Builds the audit actor from the current request. */
    auditActor: (req: FastifyRequest) => AuditActor;
  }
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

export interface AuthPluginOptions {
  authService: AuthService;
  audit: AuditService;
  ipSalt: string;
}

export default fp<AuthPluginOptions>(async (app: FastifyInstance, options: AuthPluginOptions) => {
  app.decorate('authService', options.authService);
  app.decorate('audit', options.audit);

  app.decorateRequest('user', undefined);

  app.decorate('auditActor', (req: FastifyRequest): AuditActor => {
    const ip = normaliseIp(req.ip);
    return {
      id: req.user?.id ?? null,
      email: req.user?.email ?? null,
      ip,
      userAgent: req.headers['user-agent'],
    };
  });

  app.decorate('authenticate', async (req: FastifyRequest): Promise<void> => {
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw AppError.unauthenticated('Sign in to continue.');
    }
    const token = header.slice(7).trim();
    req.user = await options.authService.verifyAccessToken(token);
  });

  app.decorate(
    'requirePermission',
    (permissions: Permission | Permission[], permOptions: { all?: boolean } = {}) => {
      const list = Array.isArray(permissions) ? permissions : [permissions];
      return async (req: FastifyRequest): Promise<void> => {
        if (!req.user) await app.authenticate(req, {} as FastifyReply);
        const user = req.user;
        if (!user) throw AppError.unauthenticated('Sign in to continue.');

        const granted = list.filter((p) => hasPermission(user, p));
        const ok = permOptions.all === false ? granted.length > 0 : granted.length === list.length;
        if (!ok) {
          await options.audit.record({
            action: 'auth.login_failed',
            entityType: 'permission',
            entityId: null,
            next: { required: list, missing: list.filter((p) => !granted.includes(p)) },
            actor: app.auditActor(req),
          });
          throw AppError.forbidden(
            `Your role does not include: ${list.filter((p) => !granted.includes(p)).join(', ')}.`,
          );
        }
      };
    },
  );

  // Attach the audit actor helper to the request for handlers that want the raw IP.
  app.addHook('onRequest', async (req) => {
    (req as FastifyRequest & { auditIpHash?: string | null }).auditIpHash = hashIp(
      normaliseIp(req.ip),
      options.ipSalt,
    );
  });
});

export const ALL_PERMISSIONS = PERMISSIONS;