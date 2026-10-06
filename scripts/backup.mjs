#!/usr/bin/env node
// Copies data/stabilitea.db to data/backups/stabilitea-YYYYMMDD.db.
// Uses SQLite's online backup API, so it is safe to run while the app is running.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'data', 'stabilitea.db');
const backups = path.join(root, 'data', 'backups');

if (!fs.existsSync(source)) {
  console.error(`No database found at ${source}. Run "npm run db:push" first.`);
  process.exit(1);
}

const now = new Date();
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
fs.mkdirSync(backups, { recursive: true });

let target = path.join(backups, `stabilitea-${stamp}.db`);
for (let n = 2; fs.existsSync(target); n++) target = path.join(backups, `stabilitea-${stamp}-${n}.db`);

const require = createRequire(path.join(root, 'apps/api/package.json'));
const Database = require('better-sqlite3');
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(target);
} finally {
  db.close();
}
console.log(`Backed up to ${path.relative(root, target)}`);
