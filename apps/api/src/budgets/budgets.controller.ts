import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import type { BudgetMonthDto } from '@stabilitea/shared';
import { ParseMonthPipe } from '../common/pipes.js';
import { UpdateBudgetLineDto, UpdateBudgetMonthDto } from './budgets.dto.js';
import { BudgetsService } from './budgets.service.js';

@Controller('budgets/:month')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  get(@Param('month', ParseMonthPipe) month: string): Promise<BudgetMonthDto> {
    return this.budgets.get(month);
  }

  @Patch()
  update(@Param('month', ParseMonthPipe) month: string, @Body() body: UpdateBudgetMonthDto): Promise<BudgetMonthDto> {
    return this.budgets.updatePlannedIncome(month, body.plannedIncomeCents);
  }

  @Patch('lines/:lineId')
  updateLine(
    @Param('month', ParseMonthPipe) month: string,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Body() body: UpdateBudgetLineDto,
  ): Promise<BudgetMonthDto> {
    return this.budgets.updateLineLimit(month, lineId, body.limitCents);
  }

  /** Cover a rollover line's deficit from savings (as much as the balance allows). */
  @Post('lines/:lineId/pay-deficit')
  @HttpCode(200)
  payDeficit(
    @Param('month', ParseMonthPipe) month: string,
    @Param('lineId', ParseIntPipe) lineId: number,
  ): Promise<BudgetMonthDto> {
    return this.budgets.payDeficit(month, lineId);
  }

  @Delete('deficit-payments/:entryId')
  undoDeficitPayment(
    @Param('month', ParseMonthPipe) month: string,
    @Param('entryId', ParseIntPipe) entryId: number,
  ): Promise<BudgetMonthDto> {
    return this.budgets.undoDeficitPayment(month, entryId);
  }

  @Post('close')
  @HttpCode(200)
  close(@Param('month', ParseMonthPipe) month: string): Promise<BudgetMonthDto> {
    return this.budgets.close(month);
  }

  @Post('reopen')
  @HttpCode(200)
  reopen(@Param('month', ParseMonthPipe) month: string): Promise<BudgetMonthDto> {
    return this.budgets.reopen(month);
  }
}
