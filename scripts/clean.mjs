import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Removes build output from every workspace.
 *
 * Written as a script rather than a chained `rm` so it works identically on Windows and
 * in CI, and so a missing directory is not treated as an error.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  'apps/api/dist',
  'apps/kiosk/dist',
  'apps/admin/dist',
  'packages/types/dist',
  'packages/config/dist',
  'packages/database/dist',
  'packages/ai/dist',
  'packages/speech/dist',
  'packages/ui/dist',
];

for (const target of TARGETS) {
  const path = join(root, target);
  await rm(path, { recursive: true, force: true });
  console.log(`removed ${target}`);
}

console.log(`cleaned ${TARGETS.length} directories`);
