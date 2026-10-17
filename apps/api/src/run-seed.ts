import { createContainer, shutdown } from './container.js';
import { seed, LANGUAGES } from './seed.js';

/**
 * Seed runner.
 *
 *   npm run db:seed -w @proctor/api
 *
 * Idempotent — safe to run on every deploy.
 *
 *   npm run db:seed
 *   npm run db:seed -- --reset-admin-password
 *
 * BOOTSTRAP_ADMIN_PASSWORD in `.env` sets the password on first creation. To force a
 * reset on an existing account, pass --reset-admin-password. Leaving the variable blank
 * generates a password, prints it once, and it is not recoverable.
 */
async function main(): Promise<void> {
  const container = createContainer();
  const { env, prisma, logger } = container;

  const generated = env.BOOTSTRAP_ADMIN_PASSWORD
    ? null
    : `${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 10)}-Kiosk2026!`;

  // npm forwards extra arguments inconsistently across workspaces, so scan the whole
  // argv rather than relying on exact element matching.
  const resetAdminPassword = process.argv.join(' ').includes('--reset-admin-password');

  const result = await seed(prisma, logger, {
    adminEmail: env.BOOTSTRAP_ADMIN_EMAIL,
    adminPassword: env.BOOTSTRAP_ADMIN_PASSWORD || generated,
    resetAdminPassword,
  });

  const lines = [
    '',
    '──────────────────────────────────────────────────────────────',
    '  Seed complete',
    '──────────────────────────────────────────────────────────────',
    `  Roles              4`,
    `  Languages          ${LANGUAGES.length} (${LANGUAGES.map((l) => l.code).join(', ')})`,
    `  Jobs               ${result.jobs.length} (${result.jobs.length ? 'active' : 'none'})`,
    `  New questions      ${result.questions}`,
    `  Example session    ${result.exampleSessionId ?? 'skipped'}`,
    '',
    `  Admin email        ${result.adminEmail}`,
    `  Admin password     ${result.adminPassword ?? '(unchanged — set a new one after signing in)'}`,
    '  Reviewer account   reviewer@example.org / ReviewMe!Review2026#',
    '──────────────────────────────────────────────────────────────',
    '',
    '  Sign in at the admin dashboard, then create your own jobs and questions.',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);

  await shutdown(container, 'seed_complete');
}

main().catch((err: unknown) => {
  process.stderr.write(`[seed] failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});