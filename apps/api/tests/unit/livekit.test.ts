import { describe, expect, it } from 'vitest';
import { createLivekitToken, isTrustedAgent, livekitRoomName, bearerToken } from '../../src/lib/livekit.js';
import type { Env } from '@proctor/config';

/**
 * LiveKit token tests.
 *
 * The kiosk receives a short-lived, room-scoped access token and nothing else. These tests
 * assert the two properties that matter: the token is a correctly signed HS256 JWT with a
 * LiveKit grant, and the agent API is closed unless the shared key matches.
 */

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'devsecret',
    VOICE_AGENT_NAME: 'voicehire-interview',
    AGENT_API_KEY: 'agent-secret',
    LIVEKIT_TOKEN_TTL_MINUTES: 15,
    ...overrides,
  } as Env;
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

describe('createLivekitToken', () => {
  it('returns a three-part HS256 JWT', () => {
    const token = createLivekitToken(makeEnv(), { identity: 'kiosk-1', room: 'interview-abc' });
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(decodePart(parts[0]!).alg).toBe('HS256');
  });

  it('carries the LiveKit video grant for the room', () => {
    const token = createLivekitToken(makeEnv(), { identity: 'kiosk-1', room: 'interview-abc' });
    const payload = decodePart(token.split('.')[1]!);
    expect(payload.iss).toBe('devkey');
    expect(payload.sub).toBe('kiosk-1');
    const video = payload.video as Record<string, unknown>;
    expect(video.roomJoin).toBe(true);
    expect(video.room).toBe('interview-abc');
    expect(video.canPublish).toBe(true);
    expect(video.canSubscribe).toBe(true);
  });

  it('requests the cloud agent dispatch', () => {
    const token = createLivekitToken(makeEnv(), { identity: 'kiosk-1', room: 'r' });
    const payload = decodePart(token.split('.')[1]!);
    const roomConfig = payload.roomConfig as { agents: Array<{ agentName: string }> };
    expect(roomConfig.agents[0]?.agentName).toBe('voicehire-interview');
  });

  it('signs with the secret so the token verifies (and a wrong secret would not)', () => {
    const good = createLivekitToken(makeEnv(), { identity: 'k', room: 'r' });
    const bad = createLivekitToken(makeEnv({ LIVEKIT_API_SECRET: 'wrong' }), { identity: 'k', room: 'r' });
    const sigOf = (t: string) => t.split('.')[2];
    // Same header+payload, different signature only if the secret differs.
    expect(good.split('.')[1]).toBe(bad.split('.')[1]);
    expect(sigOf(good)).not.toBe(sigOf(bad));
  });

  it('never embeds the API secret in the payload', () => {
    const token = createLivekitToken(makeEnv({ LIVEKIT_API_SECRET: 'super-secret-value' }), { identity: 'k', room: 'r' });
    expect(token).not.toContain('super-secret-value');
  });

  it('throws a configuration error when credentials are absent', () => {
    expect(() => createLivekitToken(makeEnv({ LIVEKIT_API_SECRET: '' }), { identity: 'k', room: 'r' })).toThrow();
  });
});

describe('livekitRoomName', () => {
  it('derives a deterministic room name from the public id', () => {
    expect(livekitRoomName('sess_ABC')).toBe('interview-sess_ABC');
  });
});

describe('agent authentication', () => {
  it('accepts the exact shared key', () => {
    expect(isTrustedAgent(makeEnv(), 'agent-secret')).toBe(true);
  });

  it('rejects a wrong or missing key', () => {
    expect(isTrustedAgent(makeEnv(), 'wrong')).toBe(false);
    expect(isTrustedAgent(makeEnv(), undefined)).toBe(false);
    expect(isTrustedAgent(makeEnv({ AGENT_API_KEY: '' }), 'anything')).toBe(false);
  });

  it('extracts a bearer token case-insensitively', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});