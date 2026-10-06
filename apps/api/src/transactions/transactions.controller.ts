import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import type { TransactionDto } from '@stabilitea/shared';
import { CreateTransactionDto, TransactionQueryDto, UpdateTransactionDto } from './transactions.dto.js';
import { TransactionsService } from './transactions.service.js';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  list(@Query() query: TransactionQueryDto): Promise<TransactionDto[]> {
    return this.transactions.list(query);
  }

  @Post()
  create(@Body() body: CreateTransactionDto): Promise<TransactionDto> {
    return this.transactions.create(body);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateTransactionDto): Promise<TransactionDto> {
    return this.transactions.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.transactions.remove(id);
  }
}
