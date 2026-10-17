import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/**
 * Cryptographic helpers.
 *
 * Passwords use Argon2id (memory-hard, the OWASP recommendation). Tokens are
 * random 32-byte values stored only as SHA-256 digests, so a database leak does not
 * hand out live sessions. IP addresses are HMAC-hashed with a server-side salt so
 * audit logs can correlate events without storing a raw address.
 */

const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password, ARGON_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Password policy. Deliberately length-first rather than composition-based,
 * because composition rules push users toward predictable substitutions.
 */
export function assertPasswordStrength(password: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters long.';
  if (password.length > 200) return 'Password must be at most 200 characters long.';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 2) return 'Password must mix at least two of: lowercase, uppercase, digits, symbols.';
  const common = ['password', 'qwerty', '12345678', 'letmein', 'welcome', 'admin123', 'iloveyou'];
  const lower = password.toLowerCase();
  if (common.some((c) => lower.includes(c))) return 'Password contains a very common word. Please choose something else.';
  return null;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Pseudonymous, stable identifier for an IP address. */
export function hashIp(ip: string | undefined, salt: string): string | null {
  if (!ip) return null;
  return hmac(ip, salt).slice(0, 32);
}

export function normaliseIp(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (v.startsWith('::ffff:')) return v.slice(7);
  return v;
}

/** URL-safe public identifier for a session; never exposes the database UUID. */
export function publicId(prefix = 'sess'): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

/** Non-secret session-scoped key used by the kiosk for local persistence. */
export function deriveKioskKey(publicIdValue: string, secret: string): string {
  return hmac(`kiosk:${publicIdValue}`, secret).slice(0, 32);
}

export function redactUserAgent(ua: string | undefined): string | undefined {
  if (!ua) return undefined;
  return ua.slice(0, 200);
}

/**
 * Field-level redaction for audit logs: keeps the shape of a record for comparison
 * while guaranteeing secrets and candidate content never land in the audit trail.
 */
const AUDIT_SENSITIVE = new Set([
  'passwordhash',
  'password',
  'totpsecret',
  'tokenhash',
  'transcript',
  'interpretation',
  'normalizedtext',
  'content',
  'objectkey',
  'snapshotkey',
  'uploadurl',
  'email',
  'phone',
  'name',
  'secret',
]);

export function redactForAudit(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactForAudit(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (AUDIT_SENSITIVE.has(k.toLowerCase())) {
        out[k] = typeof v === 'string' && v.length > 0 ? '[redacted]' : v;
        continue;
      }
      out[k] = redactForAudit(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  return value;
}