#!/usr/bin/env node
/**
 * Prisma CLI wrapper.
 *
 * Prisma resolves `.env` relative to the schema file's directory, so running from
 * `packages/database` cannot see the repo-root `.env` where the rest of the toolchain
 * expects it. This wrapper loads the nearest `.env` into `process.env` and hands off to
 * the real CLI, so `db:migrate` and `db:generate` behave identically regardless of which
 * workspace npm invoked them from.
 *
 * Variables already present in the environment always win, so CI and container overrides
 * still take precedence over the file.
 *
 * The `.env` parsing is inlined rather than imported on purpose: this script runs before
 * any TypeScript loader is available, so it must not depend on the workspace sources.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseEnvFile(contents) {
  const out = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n');
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFile(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      const parsed = parseEnvFile(readFileSync(candidate, 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const envFile = loadEnvFile(repoRoot);
const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write('Usage: prisma <command> [args...]\n');
  process.exit(2);
}
if (envFile && process.env.DEBUG_PRISMA_WRAPPER === '1') {
  process.stderr.write(`[prisma] loaded ${envFile}\n`);
}

let cliPath;
try {
  cliPath = require.resolve('prisma/build/index.js');
} catch {
  process.stderr.write('Could not resolve the Prisma CLI. Run `npm install` first.\n');
  process.exit(1);
}

const child = spawn(process.execPath, [cliPath, ...args], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
