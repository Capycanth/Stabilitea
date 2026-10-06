import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root. Same depth from src/ and dist/. */
export const REPO_ROOT = path.resolve(here, '../../..');

/** Built Angular app served in production mode. */
export const WEB_DIST = path.join(REPO_ROOT, 'apps/web/dist/web/browser');

/** Local-only: never bind to 0.0.0.0. */
export const HOST = '127.0.0.1';

export function port(): number {
  const value = Number(process.env['PORT'] ?? 3000);
  return Number.isInteger(value) && value > 0 ? value : 3000;
}

/** Absolute `file:` URL for the SQLite database. Honors DATABASE_URL. */
export function databaseUrl(): string {
  const configured = process.env['DATABASE_URL'];
  if (configured) {
    const file = configured.replace(/^file:/, '');
    return `file:${path.isAbsolute(file) ? file : path.resolve(REPO_ROOT, 'apps/api', file)}`;
  }
  const file = path.join(REPO_ROOT, 'data', 'stabilitea.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return `file:${file}`;
}
