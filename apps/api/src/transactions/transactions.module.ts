import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module.js';
import { TransactionsController } from './transactions.controller.js';
import { TransactionsService } from './transactions.service.js';

@Module({
  imports: [BudgetsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
