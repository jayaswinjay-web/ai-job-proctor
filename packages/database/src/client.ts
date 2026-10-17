import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaNeon, PrismaNeonHTTP } from '@prisma/adapter-neon';
import type { SqlDriverAdapterFactory } from '@prisma/client/runtime/library';
import type { Logger } from './logger.js';

export * from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** True when running in a Cloudflare Worker rather than Node. */
function isWorkerRuntime(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
}

/**
 * Neon serverless driver, created once per isolate and reused for every request.
 *
 * Web Workers have no TCP sockets, so the runtime decides which driver applies: the
 * WebSocket pool under Node (local development against Neon) and the HTTP driver under
 * Cloudflare Workers (deployed). Local Docker Postgres is not Neon, so it keeps the
 * standard driver and needs no adapter at all.
 */
function createAdapter(logger: Logger): SqlDriverAdapterFactory | undefined {
  const url = logger.databaseUrl ?? '';
  if (!url.includes('neon.tech') || !url) return undefined;
  // PrismaNeonHTTP requires the query options as a second argument; an empty object
  // keeps Neon's defaults.
  return isWorkerRuntime()
    ? new PrismaNeonHTTP(url, {})
    : new PrismaNeon({ connectionString: url });
}

function createClient(logger: Logger): PrismaClient {
  const log: Prisma.LogLevel[] = ['warn', 'error'];
  const adapter = createAdapter(logger);
  const options: Prisma.PrismaClientOptions = adapter
    ? { adapter, log }
    : { log, datasources: { db: { url: logger.databaseUrl } } };
  return new PrismaClient(options);
}

/**
 * Single shared Prisma client. Kept on globalThis so hot reloads in development and
 * repeated requests in a Worker isolate do not exhaust the connection pool.
 */
export function getPrisma(logger: Logger): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient(logger);
  }
  return globalForPrisma.prisma;
}

export type Tx = Prisma.TransactionClient;
export { Prisma };
