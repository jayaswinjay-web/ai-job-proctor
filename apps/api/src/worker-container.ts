import { createLogger, getPrisma } from '@proctor/database';
import { loadEnv, type Env } from '@proctor/config';
import { buildAiStack, type AiStack } from '@proctor/ai';
import type { PrismaClient } from '@prisma/client';
import { AppError } from './lib/errors.js';
import type { StorageDriver } from './storage/index.js';
import { SettingsStore } from './services/settings.store.js';

/**
 * In-memory storage for the Cloudflare Worker.
 *
 * A Worker has no filesystem, so the local driver cannot run there. Interview audio is
 * produced by the LiveKit agent on the kiosk side, which owns its own media, so this
 * deployment never needs to persist blobs — it only needs the driver contract to exist
 * so the service graph can be built unchanged.
 */
class MemoryStorageDriver implements StorageDriver {
  readonly driver = 'local' as const;
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<{ size: number }> {
    this.objects.set(key, Buffer.from(body));
    return { size: body.length };
  }

  async get(key: string): Promise<Buffer> {
    const found = this.objects.get(key);
    if (!found) throw AppError.notFound('Stored object not found.');
    return found;
  }

  async head(key: string) {
    const found = this.objects.get(key);
    return found ? { size: found.length, contentType: 'application/octet-stream', createdAt: new Date() } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  /** Not supported: no object store is attached to this deployment. */
  async presignUpload(): Promise<never> {
    throw AppError.storage('Direct uploads are not available on this deployment.');
  }

  async presignDownload(): Promise<{ url: string; expiresAt: Date }> {
    throw AppError.storage('Direct downloads are not available on this deployment.');
  }

  async createReadStream(): Promise<never> {
    throw AppError.storage('Streaming downloads are not available on this deployment.');
  }

  async dispose(): Promise<void> {
    this.objects.clear();
  }
}

export interface WorkerContainer {
  env: Env;
  logger: ReturnType<typeof createLogger>;
  prisma: PrismaClient;
  ai: AiStack;
  storage: StorageDriver;
  settings: SettingsStore;
  version: string;
}

/**
 * Builds the API container from Cloudflare Worker bindings.
 *
 * The Node entrypoint reads `.env` from disk; a Worker cannot, so configuration arrives
 * as bindings. Those are passed through the same `loadEnv` validation, which keeps the
 * two runtimes honest about the same required variables.
 */
export function createWorkerContainer(bindings: Record<string, unknown>): WorkerContainer {
  const asString: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(bindings)) {
    if (typeof value === 'string') asString[key] = value;
  }

  const loaded = loadEnv(asString);
  const env: Env = loaded.env;

  // Workers stream logs through console.*; process.stdout is not available.
  const logger = createLogger({
    level: env.LOG_LEVEL,
    isProduction: true,
    databaseUrl: env.DATABASE_URL,
    service: 'api',
    bindings: { env: env.NODE_ENV, demo: env.DEMO_MODE, llm: env.LLM_PROVIDER },
    sink: (line: string) => console.log(line),
  });

  for (const warning of loaded.warnings) {
    console.log(`[config] ${warning}`);
  }

  const prisma = getPrisma(logger);
  const ai = buildAiStack(env);
  const storage = new MemoryStorageDriver();

  for (const warning of ai.warnings) logger.warn('ai_stack_warning', { detail: warning });

  return {
    env,
    logger,
    prisma,
    ai,
    storage,
    settings: new SettingsStore(prisma, env, logger.child({ component: 'settings' })),
    version: '1.0.0',
  };
}
