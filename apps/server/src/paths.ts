import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * This file must stay directly inside src/ — in development it runs from src/,
 * in production from the bundled dist/; both are one level below apps/server.
 */
const here = dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = resolve(here, '..');
export const REPO_ROOT = resolve(SERVER_ROOT, '..', '..');
export const MIGRATIONS_DIR = resolve(SERVER_ROOT, 'drizzle');
export const WEB_DIST_DIR = resolve(SERVER_ROOT, '..', 'web', 'dist');
