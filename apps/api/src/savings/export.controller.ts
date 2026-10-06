import { Controller, Get, Header } from '@nestjs/common';
import type { ExportDto } from '@stabilitea/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('export')
export class ExportController {
  constructor(private readonly prisma: PrismaService) {}

  /** Full JSON export for backup. */
  @Get()
  @Header('Content-Disposition', 'attachment; filename="stabilitea-export.json"')
  async export(): Promise<ExportDto> {
    const [categories, subcategories, budgetMonths, budgetLines, transactions, savingsEntries] = await Promise.all([
      this.prisma.category.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.subcategory.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.budgetMonth.findMany({ orderBy: { month: 'asc' } }),
      this.prisma.budgetLine.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.transaction.findMany({ orderBy: { id: 'asc' } }),
      this.prisma.savingsEntry.findMany({ orderBy: { id: 'asc' } }),
    ]);
    return {
      app: 'stabilitea',
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      categories,
      subcategories,
      budgetMonths,
      budgetLines,
      transactions,
      savingsEntries,
    };
  }
}
