import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Unit tests only.
 *
 * The API-level behaviour is covered by `scripts/acceptance.mjs`, which runs against a
 * real database over HTTP. Keeping the two suites separate means a unit test failure
 * points at logic, while an acceptance failure points at wiring.
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Not every file is unit-testable: services need a database. The threshold is set
      // where it is meaningful rather than at a number that hides the gap.
      thresholds: { lines: 40, functions: 40, branches: 30, statements: 40 },
    },
  },
  resolve: {
    // A single catch-all per package: subpath imports such as `@proctor/ai/guardrails`
    // must resolve too, which a plain string alias does not do.
    alias: [
      { find: /^@proctor\/types$/, replacement: resolve('../../packages/types/src/index.ts') },
      { find: /^@proctor\/types\/(.*)$/, replacement: resolve('../../packages/types/src/$1') },
      { find: /^@proctor\/config$/, replacement: resolve('../../packages/config/src/index.ts') },
      { find: /^@proctor\/database$/, replacement: resolve('../../packages/database/src/index.ts') },
      { find: /^@proctor\/database\/(.*)$/, replacement: resolve('../../packages/database/src/$1') },
      { find: /^@proctor\/ai$/, replacement: resolve('../../packages/ai/src/index.ts') },
      { find: /^@proctor\/ai\/(.*)$/, replacement: resolve('../../packages/ai/src/$1') },
      { find: /^@proctor\/speech$/, replacement: resolve('../../packages/speech/src/index.ts') },
      { find: /^@proctor\/speech\/(.*)$/, replacement: resolve('../../packages/speech/src/$1') },
    ],
  },
});
