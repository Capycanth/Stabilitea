import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface TestDatabase {
  url: string;
  cleanup(): void;
}

let schemaSql: string | undefined;

/** DDL for the whole Prisma schema, generated once per test process. */
function getSchemaSql(): string {
  schemaSql ??= execSync('npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script', {
    cwd: apiDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return schemaSql;
}

/** Creates a temporary SQLite file with the current Prisma schema applied. */
export function createTestDatabase(): TestDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stabilitea-test-'));
  const file = path.join(dir, 'test.db');
  const db = new Database(file);
  db.exec(getSchemaSql());
  db.close();
  return {
    url: `file:${file}`,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
