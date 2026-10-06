import { Controller, Get } from '@nestjs/common';
import type { SavingsDto, SavingsEntryKind } from '@stabilitea/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('savings')
export class SavingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(): Promise<SavingsDto> {
    const entries = await this.prisma.savingsEntry.findMany({
      orderBy: [{ month: 'desc' }, { id: 'asc' }],
      include: { subcategory: { include: { category: true } } },
    });
    return {
      balanceCents: entries.reduce((sum, entry) => sum + entry.amountCents, 0),
      entries: entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind as SavingsEntryKind,
        month: entry.month,
        subcategoryId: entry.subcategoryId,
        subcategoryName: entry.subcategory?.name ?? null,
        categoryName: entry.subcategory?.category.name ?? null,
        amountCents: entry.amountCents,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }
}
