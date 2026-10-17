import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP, implemented directly so 2FA has no extra dependency.
 *
 * Uses the standard HMAC-SHA1 / 6-digit / 30-second configuration that every
 * authenticator app supports. A ±1 window tolerance absorbs clock drift between
 * the kiosk server and staff phones.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function createTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
}

export function isValidTotpSecret(secret: string): boolean {
  return /^[A-Z2-7]+=*$/.test(secret) && secret.replace(/=+$/, '').length >= 16;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character in TOTP secret');
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function generateTotpCode(secret: string, atMs = Date.now(), step = 30, digits = 6): string {
  const counter = Math.floor(atMs / 1000 / step);
  return hotp(base32Decode(secret), counter, digits);
}

export function verifyTotpCode(secret: string, code: string, window = 1, atMs = Date.now()): boolean {
  const trimmed = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(trimmed)) return false;
  const counter = Math.floor(atMs / 1000 / 30);
  let match = false;
  // Compare against every candidate in the window so a valid code always verifies
  // but timing does not reveal which step matched.
  for (let drift = -window; drift <= window; drift += 1) {
    const expected = hotp(base32Decode(secret), counter + drift, 6);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(trimmed))) match = true;
  }
  return match;
}

function hotp(key: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    (((digest[offset]! & 0x7f) << 24) |
      ((digest[offset + 1]! & 0xff) << 16) |
      ((digest[offset + 2]! & 0xff) << 8) |
      (digest[offset + 3]! & 0xff)) >>>
    0;
  return String(binary % 10 ** digits).padStart(digits, '0');
}