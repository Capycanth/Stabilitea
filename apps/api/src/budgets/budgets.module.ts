import { Module } from '@nestjs/common';
import { BudgetLifecycleService } from './budget-lifecycle.service.js';
import { BudgetsController } from './budgets.controller.js';
import { BudgetsService } from './budgets.service.js';

@Module({
  controllers: [BudgetsController],
  providers: [BudgetsService, BudgetLifecycleService],
  exports: [BudgetLifecycleService],
})
export class BudgetsModule {}
