import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Minimal `.env` loader.
 *
 * Deliberately hand-rolled rather than a dependency: this runs before anything else in
 * the process, must never overwrite a variable the operator already exported, and needs
 * to find the repo-root file whether it is started from the repo root, from `apps/api`,
 * or from a service manager with a different working directory.
 *
 * Rules
 *  * Real environment variables always win, so `docker run -e DATABASE_URL=...` and CI
 *    secrets take precedence over the file.
 *  * `NODE_ENV=production .env` is loaded *first*, then a local `.env` is layered over it,
 *    which is the convention most deployment tooling uses.
 *  * Values may be quoted; `#` inside a quoted value is not a comment.
 */
export interface LoadDotEnvOptions {
  /** Explicit file to load. Defaults to the nearest `.env` walking up from `cwd`. */
  file?: string;
  /** Extra directories to search, highest priority first. */
  searchPaths?: string[];
  cwd?: string;
}

function parseFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
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
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    } else {
      // Unquoted: strip an inline comment.
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/** Finds the closest `.env` walking upward from `startDir`. */
export function findDotEnv(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadDotEnv(options: LoadDotEnvOptions = {}): { file: string | null; applied: string[] } {
  const cwd = options.cwd ?? process.cwd();
  const files: string[] = [];

  if (options.file) {
    files.push(resolve(isAbsolute(options.file) ? options.file : join(cwd, options.file)));
  } else {
    for (const searchPath of options.searchPaths ?? []) {
      const found = findDotEnv(resolve(cwd, searchPath));
      if (found && !files.includes(found)) files.push(found);
    }
    const nearest = findDotEnv(cwd);
    if (nearest && !files.includes(nearest)) files.push(nearest);
  }

  const applied: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    let parsed: Record<string, string>;
    try {
      parsed = parseFile(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parsed)) {
      // Existing environment variables always win.
      if (process.env[key] === undefined) {
        process.env[key] = value;
        applied.push(key);
      }
    }
  }

  return { file: files[0] ?? null, applied };
}