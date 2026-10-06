import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { databaseUrl } from '../config.js';
import { PrismaClient } from '../generated/prisma/client.js';

export type { Prisma } from '../generated/prisma/client.js';

/** Transaction-capable client type, usable inside `$transaction(async tx => ...)`. */
export type Db = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaBetterSqlite3({ url: databaseUrl() }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // SQLite enforces foreign keys only when asked.
    await this.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
