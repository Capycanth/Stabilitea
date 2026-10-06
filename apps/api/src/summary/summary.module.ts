import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module.js';
import { SummaryController } from './summary.controller.js';
import { SummaryService } from './summary.service.js';

@Module({
  imports: [BudgetsModule],
  controllers: [SummaryController],
  providers: [SummaryService],
})
export class SummaryModule {}
