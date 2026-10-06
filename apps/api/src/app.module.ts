import fs from 'node:fs';
import path from 'node:path';
import { type DynamicModule, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { BudgetsModule } from './budgets/budgets.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { WEB_DIST } from './config.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SavingsModule } from './savings/savings.module.js';
import { SummaryModule } from './summary/summary.module.js';
import { TransactionsModule } from './transactions/transactions.module.js';

/** In production mode the API also serves the built Angular app (same origin, no CORS). */
function webApp(): DynamicModule[] {
  if (process.env['NODE_ENV'] === 'test' || !fs.existsSync(path.join(WEB_DIST, 'index.html'))) return [];
  return [ServeStaticModule.forRoot({ rootPath: WEB_DIST, exclude: ['/api/{*path}'] })];
}

@Module({
  imports: [
    PrismaModule,
    BudgetsModule,
    CategoriesModule,
    TransactionsModule,
    SummaryModule,
    SavingsModule,
    ReportsModule,
    ...webApp(),
  ],
})
export class AppModule {}
