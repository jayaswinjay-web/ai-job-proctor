import { createLogger, getPrisma, newErrorId, type Logger } from '@proctor/database';
import { corsOrigins, loadDotEnv, loadEnv, type Env } from '@proctor/config';
import { buildAiStack, type AiStack } from '@proctor/ai';
import type { PrismaClient } from '@prisma/client';
import { createStorage, type StorageDriver } from './storage/index.js';
import { SettingsStore } from './services/settings.store.js';

/**
 * Application container.
 *
 * Constructed once at boot and passed explicitly everywhere. No module-level
 * singletons: this is what makes the interview engine testable in isolation and
 * lets an integration test spin up two independent stacks against one database.
 */
export interface Container {
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
  ai: AiStack;
  storage: StorageDriver;
  settings: SettingsStore;
  startedAt: Date;
  version: string;
}

export function createContainer(overrides: Partial<Env> = {}): Container {
  // Load the repo-root .env before validating, so the process is configured the same
  // way whether it is started from the repo root, from apps/api, or by a service manager.
  const dotEnv = loadDotEnv();
  if (dotEnv.file) {
    process.stderr.write(`[config] loaded ${dotEnv.file} (${dotEnv.applied.length} variables)\n`);
  }

  const loaded = loadEnv();
  const env: Env = { ...loaded.env, ...overrides };

  for (const warning of loaded.warnings) {
    process.stderr.write(`[config] ${warning}\n`);
  }

  const logger = createLogger({
    level: env.LOG_LEVEL,
    isProduction: env.NODE_ENV === 'production',
    databaseUrl: env.DATABASE_URL,
    service: 'api',
    bindings: { env: env.NODE_ENV, demo: env.DEMO_MODE, llm: env.LLM_PROVIDER },
  });

  const prisma = getPrisma(logger);
  const ai = buildAiStack(env);
  const storage = createStorage(env, logger.child({ component: 'storage' }));

  for (const warning of ai.warnings) logger.warn('ai_stack_warning', { detail: warning });

  return {
    env,
    logger,
    prisma,
    ai,
    storage,
    settings: new SettingsStore(prisma, env, logger.child({ component: 'settings' })),
    startedAt: new Date(),
    version: process.env.npm_package_version ?? '1.0.0',
  };
}

export type { Logger, AiStack, Env, StorageDriver };
export { newErrorId, corsOrigins };

/** Terminates cleanly so in-flight interviews can be finalised. */
export async function shutdown(container: Container, signal: string): Promise<void> {
  container.logger.info('shutdown_started', { signal });
  try {
    await container.storage.dispose?.();
  } catch (err) {
    container.logger.warn('storage_dispose_failed', { err });
  }
  try {
    await container.prisma.$disconnect();
  } catch (err) {
    container.logger.warn('prisma_disconnect_failed', { err });
  }
}