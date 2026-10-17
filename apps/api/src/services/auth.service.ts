import type { PrismaClient } from '@proctor/database';
import type { Env } from '@proctor/config';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from '@proctor/types';
import { AppError } from '../lib/errors.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { createTotpSecret, verifyTotpCode, isValidTotpSecret } from './totp.js';

/**
 * Authentication and authorisation.
 *
 * Token strategy
 * --------------
 *  * Short-lived (15 min) access token: a signed JWT held in memory by the admin
 *    SPA. Never written to localStorage, so an XSS payload cannot exfiltrate a
 *    durable credential.
 *  * Long-lived refresh token: an opaque random value in a `HttpOnly`, `SameSite=Lax`,
 *    `Secure`-in-production cookie, stored server-side as a SHA-256 digest and
 *    **rotated on every use** with reuse detection.
 *
 * RBAC: roles map to permission strings. `AdminRole.permissions` is editable, but the
 * effective set is always intersected with the built-in ceiling for that role, so an
 * administrator cannot accidentally grant themselves something outside their remit.
 */

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  permissions: Permission[];
  totpEnabled: boolean;
}

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface JwtClaims {
  sub: string;
  email: string;
  name: string;
  roles: Role[];
  perms: string[];
  typ: 'access';
  iat: number;
  exp: number;
  jti: string;
}

export class AuthService {
  /** HS256 signing key derived from AUTH_SECRET. */
  private readonly key: Uint8Array;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env,
  ) {
    this.key = new TextEncoder().encode(env.AUTH_SECRET);
  }

  /* ------------------------------ credentials ------------------------------ */

  async login(input: {
    email: string;
    password: string;
    totpCode?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<{ user: AuthenticatedUser; tokens: TokenPair }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      include: { roles: { include: { role: true } } },
    });

    // Uniform failure: no hint whether the address exists or the password was wrong.
    const genericFailure = AppError.unauthenticated('Email or password is incorrect.');
    if (!user || user.deletedAt) {
      // Spend comparable time so response timing does not reveal account existence.
      await verifyPassword(DUMMY_HASH, input.password).catch(() => false);
      throw genericFailure;
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw AppError.unauthenticated('This account is temporarily locked. Try again later.');
    }

    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) {
      await this.registerFailedLogin(user.id, user.failedLoginCount + 1);
      throw genericFailure;
    }

    if (this.env.AUTH_REQUIRE_TOTP || user.totpEnabled) {
      if (!input.totpCode) {
        throw new AppError('TOTP_REQUIRED', 401, 'A verification code is required.', { errorId: undefined });
      }
      if (!user.totpSecret || !verifyTotpCode(user.totpSecret, input.totpCode)) {
        await this.registerFailedLogin(user.id, user.failedLoginCount + 1);
        throw AppError.unauthenticated('The verification code is incorrect.');
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const authUser = await this.toAuthenticatedUser(user);
    // The IP is attached to the refresh token for audit correlation only.
    const tokens = await this.issueTokens(user.id, input.ip, input.userAgent);
    return { user: authUser, tokens };
  }

  private async registerFailedLogin(userId: string, count: number): Promise<void> {
    const shouldLock = count >= this.env.AUTH_MAX_FAILED_LOGINS;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: count,
        ...(shouldLock
          ? { lockedUntil: new Date(Date.now() + this.env.AUTH_LOCKOUT_MINUTES * 60_000) }
          : {}),
      },
    });
  }

  /* -------------------------------- tokens -------------------------------- */

  async issueTokens(userId: string, _ip?: string, userAgent?: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    const authUser = await this.toAuthenticatedUser(user);

    const now = Math.floor(Date.now() / 1000);
    const accessExp = now + this.env.AUTH_ACCESS_TOKEN_TTL_MINUTES * 60;
    const claims: JwtClaims = {
      sub: user.id,
      email: user.email,
      name: user.name,
      roles: authUser.roles,
      perms: authUser.permissions,
      typ: 'access',
      iat: now,
      exp: accessExp,
      jti: randomToken(8),
    };
    const accessToken = await this.signJwt(claims);

    const refreshToken = randomToken(32);
    const refreshExpiresAt = new Date(Date.now() + this.env.AUTH_REFRESH_TOKEN_TTL_HOURS * 3_600_000);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        userAgent: userAgent?.slice(0, 200) ?? null,
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      accessToken,
      accessTokenExpiresAt: new Date(accessExp * 1000),
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt,
    };
  }

  /**
   * Exchanges a refresh token for a new pair. The presented token is revoked; if it
   * had already been used, the whole family is revoked as a precaution against theft.
   */
  async rotateRefreshToken(presented: string, ip?: string, userAgent?: string): Promise<{ user: AuthenticatedUser; tokens: TokenPair }> {
    const hash = sha256(presented);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });

    if (!record) throw AppError.unauthenticated('Session expired. Please sign in again.');

    if (record.revokedAt) {
      // Reuse of a rotated token: assume theft, invalidate everything for this user.
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw AppError.unauthenticated('Session was already used. Please sign in again.');
    }
    if (record.expiresAt < new Date()) {
      throw AppError.unauthenticated('Session expired. Please sign in again.');
    }
    if (!record.user || record.user.deletedAt || record.user.status !== 'ACTIVE') {
      throw AppError.unauthenticated('Account is not active.');
    }

    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    const tokens = await this.issueTokens(record.userId, ip, userAgent);
    const authUser = await this.toAuthenticatedUser(record.user);
    return { user: authUser, tokens };
  }

  async logout(presentedRefreshToken: string | null): Promise<void> {
    if (!presentedRefreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(presentedRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    const claims = await this.verifyJwt(token);
    if (claims.typ !== 'access') throw AppError.unauthenticated('Invalid token type.');
    return {
      id: claims.sub,
      email: claims.email,
      name: claims.name,
      roles: claims.roles,
      permissions: claims.perms.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p)),
      totpEnabled: false,
    };
  }

  private async signJwt(claims: JwtClaims): Promise<string> {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
    const payload = btoa(JSON.stringify(claims)).replace(/=/g, '');
    const signature = await this.hmac(`${header}.${payload}`);
    return `${header}.${payload}.${signature}`;
  }

  private async verifyJwt(token: string): Promise<JwtClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw AppError.unauthenticated('Malformed token.');
    const [header, payload, signature] = parts as [string, string, string];
    const expected = await this.hmac(`${header}.${payload}`);
    if (signature.length !== expected.length || !constantTime(signature, expected)) {
      throw AppError.unauthenticated('Token signature is invalid.');
    }
    let claims: JwtClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as JwtClaims;
    } catch {
      throw AppError.unauthenticated('Malformed token.');
    }
    if (claims.exp * 1000 < Date.now()) throw AppError.unauthenticated('Token has expired.');
    return claims;
  }

  private async hmac(data: string): Promise<string> {
    const { createHmac } = await import('node:crypto');
    return createHmac('sha256', this.key).update(data).digest('base64url');
  }

  /* --------------------------------- users -------------------------------- */

  async toAuthenticatedUser(user: {
    id: string;
    email: string;
    name: string;
    totpEnabled: boolean;
    roles: Array<{ role: { role: Role; permissions: string[] } }>;
  }): Promise<AuthenticatedUser> {
    const roles = user.roles.map((r) => r.role.role);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles,
      permissions: effectivePermissions(user.roles),
      totpEnabled: user.totpEnabled,
    };
  }

  async createUser(input: {
    email: string;
    name: string;
    password: string;
    roles: Role[];
    isActive: boolean;
  }): Promise<AuthenticatedUser> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw AppError.conflict('An account with that email already exists.');

    const user = await this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: await hashPassword(input.password),
        status: input.isActive ? 'ACTIVE' : 'DISABLED',
        roles: {
          create: input.roles.map((role) => ({ role: { connect: { role } } })),
        },
      },
      include: { roles: { include: { role: true } } },
    });
    return this.toAuthenticatedUser(user);
  }

  async enableTotp(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = createTotpSecret();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const label = encodeURIComponent(`${user.email}`);
    const issuer = encodeURIComponent('AI Job Screening Kiosk');
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: secret } });
    return {
      secret,
      otpauthUrl: `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
    };
  }

  async confirmTotp(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpSecret || !isValidTotpSecret(user.totpSecret)) return false;
    if (!verifyTotpCode(user.totpSecret, code)) return false;
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    return true;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw AppError.unauthenticated('Current password is incorrect.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    // Force every other device to re-authenticate.
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

/* -------------------------------------------------------------------------- */

export function effectivePermissions(
  roles: Array<{ role: { role: Role; permissions: string[] } }>,
): Permission[] {
  const out = new Set<Permission>();
  for (const { role } of roles) {
    const ceiling = new Set<Permission>(ROLE_PERMISSIONS[role.role] ?? []);
    const configured = new Set(role.permissions ?? []);
    // Effective set = configured ∩ ceiling. A misconfigured row can only ever
    // remove permissions, never grant one the role was never meant to have.
    if (configured.size === 0) {
      for (const p of ceiling) out.add(p);
      continue;
    }
    for (const p of configured) {
      if (ceiling.has(p as Permission)) out.add(p as Permission);
    }
  }
  return [...out].sort();
}

export function hasPermission(user: AuthenticatedUser, permission: Permission): boolean {
  return user.permissions.includes(permission);
}

function constantTime(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i += 1) diff |= ba[i]! ^ bb[i]!;
  return diff === 0;
}

/**
 * A syntactically valid Argon2 hash of a random value, used to equalise login timing
 * for unknown accounts. Never matches any real password.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0Uq8vB5k0lZ8xJ8Xj5Vv5Q8n8p5sS3e2W9y7Hq0eR3s';