import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDbFile = path.resolve(here, '../../data/stabilitea.db');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env['DATABASE_URL'] ?? `file:${defaultDbFile}`,
  },
});
