import { Controller, Get, Param } from '@nestjs/common';
import type { MonthSummary } from '@stabilitea/shared';
import { ParseMonthPipe } from '../common/pipes.js';
import { SummaryService } from './summary.service.js';

@Controller('summary')
export class SummaryController {
  constructor(private readonly summary: SummaryService) {}

  @Get(':month')
  get(@Param('month', ParseMonthPipe) month: string): Promise<MonthSummary> {
    return this.summary.get(month);
  }
}
