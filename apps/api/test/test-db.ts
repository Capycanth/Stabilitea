import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

export interface TestDatabase {
  url: string;
  cleanup(): void;
}

/** Creates a temporary SQLite file with every Prisma migration applied, in order. */
export function createTestDatabase(): TestDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stabilitea-test-'));
  const file = path.join(dir, 'test.db');
  const db = new Database(file);
  const migrations = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of migrations) {
    db.exec(fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8'));
  }
  db.close();
  return {
    url: `file:${file}`,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
