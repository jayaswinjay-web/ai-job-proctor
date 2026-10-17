import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Logger } from '@proctor/database';
import type { Env } from '@proctor/config';
import { AppError } from '../lib/errors.js';

/**
 * Object storage abstraction.
 *
 * Recordings and proctoring snapshots are private objects. The contract requires
 * short-lived *signed* access, never public URLs, so an unauthenticated request can
 * never fetch candidate audio.
 */
export interface PresignedUpload {
  uploadUrl: string;
  objectKey: string;
  expiresAt: Date;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface StoredObjectMeta {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date;
}

export interface StorageDriver {
  readonly driver: 's3' | 'local';
  /** Server-side upload (used by the API fallback path and by tests). */
  put(key: string, body: Buffer, contentType: string): Promise<{ size: number }>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<StoredObjectMeta | null>;
  delete(key: string): Promise<void>;
  presignUpload(key: string, contentType: string, ttlSeconds: number, contentLength?: number): Promise<PresignedUpload>;
  presignDownload(key: string, ttlSeconds: number, downloadName?: string): Promise<{ url: string; expiresAt: Date }>;
  createReadStream(key: string): Promise<NodeJS.ReadableStream>;
  /** Idempotency guard so a retried upload cannot overwrite a different object. */
  exists(key: string): Promise<boolean>;
  dispose?(): Promise<void>;
}

/**
 * Builds an object key.
 *
 * Keys are namespaced by session and answer so a leaked key still reveals nothing
 * useful without the database, and so a whole session can be purged by prefix.
 */
export function buildObjectKey(input: {
  sessionPublicId: string;
  kind: 'audio' | 'snapshot';
  extension: string;
  clientId?: string;
}): string {
  const safe = input.sessionPublicId.replace(/[^A-Za-z0-9_-]/g, '');
  const suffix = input.clientId ? `-${input.clientId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)}` : '';
  return `${input.kind}/${safe}/${Date.now()}${suffix}.${input.extension}`;
}

export function extensionFor(contentType: string, fallback = 'bin'): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'application/json': 'json',
  };
  const base = contentType.split(';')[0]!.trim().toLowerCase();
  return map[base] ?? fallback;
}

/* -------------------------------------------------------------------------- */
/* Local filesystem driver                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Default driver. Writes outside the web root under `.storage`, which keeps the
 * product usable with zero infrastructure while preserving the same signed-URL
 * semantics (the "signed URL" becomes a short-lived HMAC token on our own API).
 */
export class LocalStorageDriver implements StorageDriver {
  readonly driver = 'local' as const;
  private readonly root: string;
  private readonly secret: string;
  private readonly apiBase: string;

  constructor(basePath: string, secret: string, apiBase: string) {
    this.root = resolve(process.cwd(), basePath);
    this.secret = secret;
    this.apiBase = apiBase;
  }

  /** Resolves a key to an absolute path, refusing anything that escapes the root. */
  private pathFor(key: string): string {
    const clean = key.replace(/\\/g, '/');
    if (clean.includes('..') || clean.startsWith('/')) throw AppError.storage('Invalid storage key');
    const full = resolve(this.root, clean);
    if (full !== this.root && !full.startsWith(this.root + sep)) throw AppError.storage('Invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<{ size: number }> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body, { mode: 0o600 });
    return { size: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      throw AppError.notFound('Stored object not found');
    }
  }

  async head(key: string): Promise<StoredObjectMeta | null> {
    try {
      const info = await stat(this.pathFor(key));
      return { key, size: info.size, contentType: 'application/octet-stream', lastModified: info.mtime };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async presignUpload(
    key: string,
    contentType: string,
    ttlSeconds: number,
    contentLength?: number,
  ): Promise<PresignedUpload> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const token = this.sign(`PUT:${key}:${contentType}:${contentLength ?? ''}:${expiresAt.toISOString()}`);
    return {
      uploadUrl: `${this.apiBase}/kiosk/media/upload?key=${encodeURIComponent(key)}&token=${token}`,
      objectKey: key,
      expiresAt,
      method: 'PUT',
      headers: { 'content-type': contentType, 'x-proctor-signature': token },
    };
  }

  async presignDownload(key: string, ttlSeconds: number, downloadName?: string): Promise<{ url: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const token = this.sign(`GET:${key}:${expiresAt.toISOString()}`);
    const name = downloadName ? `&name=${encodeURIComponent(downloadName)}` : '';
    return {
      url: `${this.apiBase}/kiosk/media/download?key=${encodeURIComponent(key)}&token=${token}&expires=${expiresAt.toISOString()}${name}`,
      expiresAt,
    };
  }

  async createReadStream(key: string): Promise<NodeJS.ReadableStream> {
    const target = this.pathFor(key);
    if (!(await exists(target))) throw AppError.notFound('Stored object not found');
    return createReadStream(target);
  }

  async exists(key: string): Promise<boolean> {
    return exists(this.pathFor(key));
  }

  /** Verifies a signature produced by presign*. */
  verifySignature(purpose: string, key: string, expiresAtIso: string, token: string, extra = ''): boolean {
    const expires = Date.parse(expiresAtIso);
    if (!Number.isFinite(expires) || expires < Date.now()) return false;
    const expected = this.sign(`${purpose}:${key}:${expiresAtIso}${extra ? `:${extra}` : ''}`);
    return timingSafeEqualString(expected, token);
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* S3-compatible driver                                                       */
/* -------------------------------------------------------------------------- */

/**
 * S3 / MinIO / Cloudflare R2 / DigitalOcean Spaces.
 *
 * Implemented against the REST API with SigV4 signing rather than the AWS SDK, so
 * the deployment has one fewer large dependency and works against any
 * S3-compatible endpoint including self-hosted MinIO.
 */
export class S3StorageDriver implements StorageDriver {
  readonly driver = 's3' as const;

  constructor(
    private readonly config: {
      endpoint: string;
      bucket: string;
      accessKey: string;
      secretKey: string;
      region: string;
      forcePathStyle: boolean;
      /** Public base URL of this API, used to build nothing — kept for parity. */
      ttlSeconds: number;
      logger: Logger;
    },
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<{ size: number }> {
    await this.send('PUT', `/${key}`, body, { 'content-type': contentType });
    return { size: body.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.send('GET', `/${key}`, undefined, {});
    return Buffer.from(await res.arrayBuffer());
  }

  async head(key: string): Promise<StoredObjectMeta | null> {
    try {
      const res = await this.send('HEAD', `/${key}`, undefined, {});
      return {
        key,
        size: Number(res.headers.get('content-length') ?? 0),
        contentType: res.headers.get('content-type') ?? 'application/octet-stream',
        lastModified: new Date(res.headers.get('last-modified') ?? Date.now()),
      };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.send('DELETE', `/${key}`, undefined, {});
  }

  async presignUpload(key: string, contentType: string, ttlSeconds: number, _contentLength?: number): Promise<PresignedUpload> {
    const expiresIn = Math.min(900, Math.max(30, ttlSeconds));
    const url = await this.presign('PUT', key, expiresIn);
    return {
      uploadUrl: url,
      objectKey: key,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      method: 'PUT',
      headers: { 'content-type': contentType },
    };
  }

  async presignDownload(key: string, ttlSeconds: number, downloadName?: string): Promise<{ url: string; expiresAt: Date }> {
    const expiresIn = Math.min(900, Math.max(30, ttlSeconds));
    const url = await this.presign('GET', key, expiresIn, downloadName);
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  async createReadStream(key: string): Promise<NodeJS.ReadableStream> {
    const body = await this.get(key);
    return Readable.from(body);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  private async presign(
    method: 'GET' | 'PUT',
    key: string,
    expiresIn: number,
    responseContentDisposition?: string,
  ): Promise<string> {
    const url = new URL(`${this.config.endpoint.replace(/\/$/, '')}${this.config.forcePathStyle ? `/${this.config.bucket}` : ''}`);
    const path = `${url.pathname.replace(/\/$/, '')}/${key}`;
    const now = Math.floor(Date.now() / 1000);
    const amzDate = new Date(now * 1000).toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;

    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.config.accessKey}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresIn),
      'X-Amz-SignedHeaders': 'host',
    };
    if (responseContentDisposition) query['response-content-disposition'] = responseContentDisposition;

    const canonicalQuery = Object.keys(query)
      .sort()
      .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k]!)}`)
      .join('&');
    const canonicalRequest = [method, path, canonicalQuery, `host:${url.host}\n`, 'host', UNSIGNED_PAYLOAD].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

    const signingKey = hmacBytes(
      hmacBytes(hmacBytes(hmacBytes(`AWS4${this.config.secretKey}`, dateStamp), this.config.region), 's3'),
      'aws4_request',
    );
    const signature = Buffer.from(hmacBytes(signingKey, stringToSign)).toString('hex');
    return `${url.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  private async send(method: string, path: string, body: Buffer | undefined, headers: Record<string, string>): Promise<Response> {
    const url = `${this.config.endpoint.replace(/\/$/, '')}${this.config.forcePathStyle ? `/${this.config.bucket}` : ''}${path}`;
    const now = Math.floor(Date.now() / 1000);
    const amzDate = new Date(now * 1000).toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
    const host = new URL(this.config.endpoint).host;
    void host;

    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

    const signingKey = hmacBytes(
      hmacBytes(hmacBytes(hmacBytes(`AWS4${this.config.secretKey}`, dateStamp), this.config.region), 's3'),
      'aws4_request',
    );
    const signature = Buffer.from(hmacBytes(signingKey, stringToSign)).toString('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(`${url}${path}`, {
      method,
      headers: { ...headers, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash, authorization },
      ...(body === undefined ? {} : { body: body as unknown as BodyInit }),
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      this.config.logger.error('s3_request_failed', { method, path, status: res.status, detail: text.slice(0, 200) });
      throw AppError.storage('Object storage request failed');
    }
    return res;
  }
}

const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmacBytes(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/* -------------------------------------------------------------------------- */

export function createStorage(env: Env, logger: Logger): StorageDriver {
  if (env.STORAGE_DRIVER === 's3') {
    const missing = (['OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_ACCESS_KEY', 'OBJECT_STORAGE_SECRET_KEY'] as const).filter(
      (k) => !env[k],
    );
    if (missing.length > 0) {
      logger.error('storage_driver_misconfigured', { missing });
      throw new Error(`STORAGE_DRIVER=s3 requires: ${missing.join(', ')}`);
    }
    return new S3StorageDriver({
      endpoint: env.OBJECT_STORAGE_ENDPOINT,
      bucket: env.OBJECT_STORAGE_BUCKET,
      accessKey: env.OBJECT_STORAGE_ACCESS_KEY,
      secretKey: env.OBJECT_STORAGE_SECRET_KEY,
      region: env.OBJECT_STORAGE_REGION,
      forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
      ttlSeconds: env.SIGNED_URL_TTL_SECONDS,
      logger,
    });
  }
  return new LocalStorageDriver(env.LOCAL_STORAGE_PATH, env.AUTH_SECRET, env.API_BASE_PATH);
}

export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await pipeline(stream as NodeJS.ReadableStream & AsyncIterable<Buffer>, async function* (source) {
    for await (const chunk of source) chunks.push(Buffer.from(chunk as Buffer));
  });
  return Buffer.concat(chunks);
}

