import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { databaseUrl } from '../config.js';
import { PrismaClient } from '../generated/prisma/client.js';

export function createPrismaClient(url: string = databaseUrl()): PrismaClient {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}
