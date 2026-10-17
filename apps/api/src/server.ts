import { createApp } from './app.js';
import { createContainer, shutdown } from './container.js';

/**
 * Server entry point.
 *
 * Boot order matters: the container validates configuration, opens the database pool
 * and builds the AI provider stack *before* the HTTP listener opens, so the kiosk can
 * never receive a request against a half-configured server.
 */
async function main(): Promise<void> {
  const container = createContainer();

  container.logger.info('boot_starting', {
    nodeEnv: container.env.NODE_ENV,
    demoMode: container.env.DEMO_MODE,
    llm: container.ai.llm.name,
    stt: container.ai.stt.name,
    tts: container.ai.tts.name,
    evaluation: container.ai.evaluation.name,
    storage: container.storage.driver,
  });

  // Fail fast rather than accepting traffic we cannot serve.
  try {
    await container.prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    container.logger.error('boot_database_unreachable', { err });
    container.logger.error('boot_hint', {
      detail: 'Start PostgreSQL with `npm run db:up`, then apply migrations with `npm run db:migrate`.',
    });
    await shutdown(container, 'boot_failure');
    process.exit(1);
  }

  const app = await createApp({
    container,
    logger: false, // structured logging is handled by the container's logger
  });

  const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  let shuttingDown = false;

  const stop = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    container.logger.info('shutdown_signal_received', { signal });
    try {
      // Give in-flight interviews a chance to finish writing.
      await app.close();
    } catch (err) {
      container.logger.warn('http_close_failed', { err });
    }
    await shutdown(container, signal);
    process.exit(0);
  };

  for (const signal of shutdownSignals) {
    process.on(signal, () => {
      void stop(signal);
    });
  }
  process.on('unhandledRejection', (reason) => {
    container.logger.error('unhandled_rejection', { err: reason });
  });
  process.on('uncaughtException', (err) => {
    container.logger.error('uncaught_exception', { err });
    void stop('uncaughtException');
  });

  await app.listen({ host: container.env.API_HOST, port: container.env.API_PORT });
  container.logger.info('listening', {
    host: container.env.API_HOST,
    port: container.env.API_PORT,
    basePath: container.env.API_BASE_PATH,
    health: container.env.HEALTHCHECK_PATH,
  });
}

main().catch((err: unknown) => {
  // The logger may not exist yet if the container failed to build.
  process.stderr.write(
    `[fatal] Server failed to start: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  if (err instanceof Error && err.stack) process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});