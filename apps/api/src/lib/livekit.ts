import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '@proctor/config';
import { AppError } from './errors.js';

/**
 * LiveKit Cloud access tokens.
 *
 * Signed here, on the server, with the LiveKit API secret. The secret never reaches the
 * browser: the kiosk receives only a short-lived, room-scoped token. This is the single
 * place the VoiceHire backend knows anything about LiveKit credentials.
 *
 * The token is a plain HS256 JWT; it is built by hand rather than pulling in a signing
 * library, so the backend keeps zero new runtime dependencies for the security-critical
 * path and the exact claims are visible in one file.
 */

export interface LivekitGrant {
  /** Stable participant identity, e.g. `kiosk-<sessionPublicId>`. */
  identity: string;
  /** Display name shown in the LiveKit room. */
  name?: string;
  /** Room to join. */
  room: string;
  /** How long the token is valid, in seconds. */
  ttlSeconds?: number;
  /** Arbitrary JSON string attached to the participant (e.g. session id). */
  metadata?: string;
  /** Cloud agent dispatch name; when set the agent is pulled into the room. */
  agentName?: string;
}

const DEFAULT_TTL_SECONDS = 15 * 60;

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

/**
 * Builds a LiveKit access token.
 *
 * Claims follow the LiveKit grant model: `video.roomJoin` plus the room name, with an
 * optional `roomConfig.agents` entry so the cloud agent is dispatched automatically when
 * the kiosk joins, rather than relying on an out-of-band dispatch call.
 */
export function createLivekitToken(env: Env, grant: LivekitGrant): string {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    throw AppError.voiceAiNotConfigured('LiveKit credentials are not configured.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };

  const payload: Record<string, unknown> = {
    iss: env.LIVEKIT_API_KEY,
    sub: grant.identity,
    nbf: now,
    exp: now + (grant.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    jti: `${grant.identity}-${now}`,
    video: {
      roomJoin: true,
      room: grant.room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };
  if (grant.name) payload.name = grant.name;
  if (grant.metadata) payload.metadata = grant.metadata;

  const agentName = grant.agentName ?? env.VOICE_AGENT_NAME;
  if (agentName) {
    // Explicit agent dispatch: joining the room pulls the named cloud agent in.
    payload.roomConfig = { agents: [{ agentName }] };
  }

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', env.LIVEKIT_API_SECRET).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

/** Room name for an interview session. Deterministic so it survives a page reload. */
export function livekitRoomName(publicId: string): string {
  return `interview-${publicId}`;
}

/**
 * Whether an inbound request is the trusted cloud agent.
 *
 * Constant-time comparison so a timing side channel cannot be used to recover the key.
 * When no agent key is configured, every request is rejected — the agent API is closed
 * by default.
 */
export function isTrustedAgent(env: Env, provided: string | undefined): boolean {
  if (!env.AGENT_API_KEY || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(env.AGENT_API_KEY);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extracts the bearer token from an Authorization header. */
export function bearerToken(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.toLowerCase().startsWith('bearer ')) return undefined;
  return value.slice(7).trim();
}
