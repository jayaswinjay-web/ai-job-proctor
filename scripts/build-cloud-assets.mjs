#!/usr/bin/env node
/**
 * Assembles the Cloudflare static asset directory.
 *
 * The kiosk is served from the site root and the admin console from /admin/, all on the
 * same origin as the API (which lets the admin keep its cookies and the kiosk keep its
 * WebSocket on one host). Workers Static Assets requires a single directory, so the two
 * Vite outputs are merged here.
 *
 * Run the Vite builds first (`npm run build:kiosk`, `npm run build:admin`).
 */
import { rm, mkdir, cp, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(repoRoot, 'cloud', 'www');
const kioskDist = resolve(repoRoot, 'apps', 'kiosk', 'dist');
const adminDist = resolve(repoRoot, 'apps', 'admin', 'dist');

/** Copies a directory tree without trailing-slash ambiguity. */
async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = resolve(from, entry.name);
    const dest = resolve(to, entry.name);
    if (entry.isDirectory()) {
      await copyTree(src, dest);
    } else {
      await cp(src, dest);
    }
  }
}

async function assertDir(path, label) {
  try {
    const stats = await stat(path);
    if (!stats.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error(`${label} not found at ${path}. Run the Vite build first.`);
  }
}

await assertDir(kioskDist, 'kiosk build');
await assertDir(adminDist, 'admin build');

await rm(outDir, { recursive: true, force: true });

// Kiosk at the root, admin under /admin/.
await copyTree(kioskDist, outDir);
await copyTree(adminDist, resolve(outDir, 'admin'));

// A single entry point for the container-hosted API.
process.stdout.write(`Assets assembled in ${outDir}\n`);
