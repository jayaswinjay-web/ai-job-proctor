import type { FastifyInstance } from 'fastify';
import { changePasswordSchema, createUserSchema, loginSchema, updateUserSchema } from '@proctor/types';
import { AppError } from '../lib/errors.js';
import { assertPasswordStrength } from '../lib/crypto.js';
import { zodBody } from '../lib/validation.js';
import type { Services } from '../services/registry.js';
import type { Container } from '../container.js';

interface RouteDeps {
  container: Container;
  services: Services;
}

/**
 * Cookie scope for the refresh token.
 *
 * Deliberately the auth routes only. Cookies are matched without regard to port, so a
 * whole-origin cookie set by the API is also attached to requests from the kiosk and admin
 * dev servers on the same host. Scoping the credential keeps the kiosk unauthenticated and
 * keeps it out of the CSRF plugin's cookie path.
 */
const AUTH_COOKIE_PATH = '/api/v1/auth';

export default async function authRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { container, services } = deps;
  const { auth, audit } = { auth: services.auth, audit: app.audit };
  const env = container.env;

  /* ------------------------------------------------------------------ */
  /* Public                                                              */
  /* ------------------------------------------------------------------ */

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: 60_000 } }, preHandler: zodBody(loginSchema) },
    async (req, reply) => {
      const body = req.body as { email: string; password: string; totpCode?: string };
      try {
        const result = await auth.login({
          email: body.email,
          password: body.password,
          ...(body.totpCode ? { totpCode: body.totpCode } : {}),
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        });
        reply.setCookie(env.AUTH_COOKIE_NAME, result.tokens.refreshToken, {
          httpOnly: true,
          sameSite: 'lax',
          secure: env.AUTH_COOKIE_SECURE,
          /**
           * Scoped to the auth routes rather than the whole origin.
           *
           * Browsers ignore the port when matching cookies, so a cookie on `path: '/'` set
           * by the API is also sent by the kiosk on `localhost:5173`. The kiosk holds no
           * admin credential, so presenting the refresh cookie made every kiosk write look
           * like a cookie-authenticated mutation and the CSRF plugin rejected them with a
           * 403 — the kiosk became unusable as soon as anyone signed in to the console.
           */
          path: AUTH_COOKIE_PATH,
          maxAge: env.AUTH_REFRESH_TOKEN_TTL_HOURS * 3600,
        });
        await audit.record({
          action: 'auth.login',
          entityType: 'user',
          entityId: result.user.id,
          next: { email: result.user.email, roles: result.user.roles },
          actor: { id: result.user.id, email: result.user.email, ip: req.ip, userAgent: req.headers['user-agent'] },
        });
        return {
          accessToken: result.tokens.accessToken,
          expiresAt: result.tokens.accessTokenExpiresAt.toISOString(),
          user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            roles: result.user.roles,
            permissions: result.user.permissions,
            totpEnabled: result.user.totpEnabled,
          },
        };
      } catch (err) {
        await audit.record({
          action: 'auth.login_failed',
          entityType: 'user',
          entityId: null,
          next: { email: body.email, reason: (err as AppError).code },
          actor: { ip: req.ip, userAgent: req.headers['user-agent'] },
        });
        throw err;
      }
    },
  );

  /** Refreshes the access token and rotates the refresh cookie. */
  app.post('/auth/refresh', async (req, reply) => {
    const token = req.cookies[env.AUTH_COOKIE_NAME];
    if (!token) throw AppError.unauthenticated('No active session.');
    const result = await auth.rotateRefreshToken(token, req.ip, req.headers['user-agent']);
    reply.setCookie(env.AUTH_COOKIE_NAME, result.tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.AUTH_COOKIE_SECURE,
      path: AUTH_COOKIE_PATH,
      maxAge: env.AUTH_REFRESH_TOKEN_TTL_HOURS * 3600,
    });
    return {
      accessToken: result.tokens.accessToken,
      expiresAt: result.tokens.accessTokenExpiresAt.toISOString(),
      user: result.user,
    };
  });

  app.post('/auth/logout', async (req, reply) => {
    await auth.logout(req.cookies[env.AUTH_COOKIE_NAME] ?? null);
    // Both paths are cleared: the current scope, plus the whole-origin scope used before
    // the cookie was narrowed, so an existing session is actually ended.
    reply.clearCookie(env.AUTH_COOKIE_NAME, { path: AUTH_COOKIE_PATH });
    reply.clearCookie(env.AUTH_COOKIE_NAME, { path: '/' });
    const actor = app.auditActor(req as never);
    await audit.record({ action: 'auth.logout', entityType: 'user', entityId: actor.id ?? null, actor });
    return { ok: true };
  });

  /** Cheap reachability probe used by the admin SPA before showing the login screen. */
  app.get('/auth/status', async () => ({
    authenticated: false,
    requiresTwoFactor: env.AUTH_REQUIRE_TOTP,
    demoMode: env.DEMO_MODE,
    siteName: (await container.settings.get()).general.siteName,
  }));

  /* ------------------------------------------------------------------ */
  /* Authenticated                                                       */
  /* ------------------------------------------------------------------ */

  app.get('/auth/me', { preHandler: app.authenticate }, async (req) => {
    const user = req.user!;
    const db = await container.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { roles: { include: { role: true } } },
    });
    return {
      id: db.id,
      email: db.email,
      name: db.name,
      roles: db.roles.map((r) => r.role.role),
      permissions: user.permissions,
      totpEnabled: db.totpEnabled,
      lastLoginAt: db.lastLoginAt?.toISOString() ?? null,
      createdAt: db.createdAt.toISOString(),
    };
  });

  app.post(
    '/auth/change-password',
    { preHandler: [app.authenticate, zodBody(changePasswordSchema)] },
    async (req) => {
      const body = req.body as { currentPassword: string; newPassword: string };
      const weakness = assertPasswordStrength(body.newPassword);
      if (weakness) throw AppError.validation(weakness);
      await auth.changePassword(req.user!.id, body.currentPassword, body.newPassword);
      await audit.record({
        action: 'user.updated',
        entityType: 'user',
        entityId: req.user!.id,
        next: { passwordChanged: true, allSessionsRevoked: true },
        actor: app.auditActor(req),
      });
      return { ok: true };
    },
  );

  app.post('/auth/totp/setup', { preHandler: app.authenticate }, async (req) => {
    const result = await auth.enableTotp(req.user!.id);
    return result;
  });

  app.post('/auth/totp/confirm', { preHandler: app.authenticate }, async (req) => {
    const code = (req.body as { code?: string } | undefined)?.code ?? '';
    const ok = await auth.confirmTotp(req.user!.id, code);
    if (!ok) throw AppError.validation('That code was not accepted. Check the time on your device and try again.');
    await audit.record({ action: 'auth.totp_enabled', entityType: 'user', entityId: req.user!.id, actor: app.auditActor(req) });
    return { ok: true };
  });

  /* ------------------------------------------------------------------ */
  /* User management (Super Admin)                                       */
  /* ------------------------------------------------------------------ */

  app.get(
    '/admin/users',
    { preHandler: app.requirePermission('user:manage') },
    async (req) => {
      const query = req.query as { search?: string };
      const users = await container.prisma.user.findMany({
        where: {
          deletedAt: null,
          ...(query.search ? { OR: [{ email: { contains: query.search, mode: 'insensitive' } }, { name: { contains: query.search, mode: 'insensitive' } }] } : {}),
        },
        include: { roles: { include: { role: { select: { role: true, permissions: true } } } } },
        orderBy: { createdAt: 'desc' },
      });
      return {
        items: users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          roles: u.roles.map((r) => r.role.role),
          permissions: u.roles.flatMap((r) => r.role.permissions),
          isActive: u.status === 'ACTIVE',
          totpEnabled: u.totpEnabled,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/admin/users',
    { preHandler: [app.requirePermission('user:manage'), zodBody(createUserSchema)] },
    async (req) => {
      const body = req.body as { email: string; name: string; password: string; roles: string[]; isActive: boolean };
      const weakness = assertPasswordStrength(body.password);
      if (weakness) throw AppError.validation(weakness);
      const user = await auth.createUser({
        email: body.email,
        name: body.name,
        password: body.password,
        roles: body.roles as never,
        isActive: body.isActive,
      });
      await audit.record({
        action: 'user.created',
        entityType: 'user',
        entityId: user.id,
        next: { email: user.email, roles: user.roles },
        actor: app.auditActor(req),
      });
      return user;
    },
  );

  app.patch(
    '/admin/users/:id',
    { preHandler: [app.requirePermission('user:manage'), zodBody(updateUserSchema)] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = req.body as { name?: string; roles?: string[]; isActive?: boolean };
      const existing = await container.prisma.user.findUnique({
        where: { id },
        include: { roles: true },
      });
      if (!existing) throw AppError.notFound('That account could not be found.');

      await container.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id },
          data: {
            ...(body.name ? { name: body.name } : {}),
            ...(body.isActive !== undefined ? { status: body.isActive ? 'ACTIVE' : 'DISABLED' } : {}),
          },
        });
        if (body.roles) {
          await tx.userRole.deleteMany({ where: { userId: id } });
          await tx.userRole.createMany({
            data: body.roles.map((role) => ({ userId: id, roleId: role })),
            skipDuplicates: true,
          });
        }
      });

      if (body.isActive === false) await auth.logoutAll(id);

      await audit.record({
        action: 'user.roles_changed',
        entityType: 'user',
        entityId: id,
        previous: { roles: existing.roles.map((r) => r.roleId), status: existing.status, name: existing.name },
        next: { roles: body.roles ?? existing.roles.map((r) => r.roleId), status: body.isActive, name: body.name },
        actor: app.auditActor(req),
      });
      const updated = await auth.toAuthenticatedUser(
        (await container.prisma.user.findUniqueOrThrow({ where: { id }, include: { roles: { include: { role: true } } } }))!,
      );
      return updated;
    },
  );
}