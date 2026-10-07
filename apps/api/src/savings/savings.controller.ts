import { Controller, Get } from '@nestjs/common';
import { addMonths, type FundBalanceDto, type SavingsDto, type SavingsEntryKind, type SavingsMonthDto } from '@stabilitea/shared';
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

    const byMonth = new Map<string, SavingsMonthDto>();
    for (const entry of entries) {
      let m = byMonth.get(entry.month);
      if (!m) {
        m = {
          month: entry.month,
          incomeCents: 0,
          spendingCents: 0,
          fundContributionCents: 0,
          fundReleaseCents: 0,
          deficitPaidCents: 0,
          changeCents: 0,
          balanceAfterCents: 0,
        };
        byMonth.set(entry.month, m);
      }
      const amount = entry.amountCents;
      if (entry.kind === 'income') m.incomeCents += amount;
      else if (entry.kind === 'spending') m.spendingCents -= amount;
      else if (entry.kind === 'fund_contribution') m.fundContributionCents -= amount;
      else if (entry.kind === 'fund_release') m.fundReleaseCents += amount;
      else if (entry.kind === 'deficit_payment') m.deficitPaidCents -= amount;
      m.changeCents += amount;
    }
    const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
    let running = 0;
    for (const m of months) {
      running += m.changeCents;
      m.balanceAfterCents = running;
    }

    return {
      balanceCents: running,
      funds: await this.fundBalances(),
      months: months.reverse(),
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

  /**
   * Each active fund's balance after the latest close: the carry-in (plus any deficit paid) on its line in the month
   * after the latest closed month, or in the first budgeted month when nothing has closed yet.
   */
  private async fundBalances(): Promise<FundBalanceDto[]> {
    const funds = await this.prisma.subcategory.findMany({
      where: { fund: true, archivedAt: null, category: { kind: 'expense', archivedAt: null } },
      include: { category: true },
      orderBy: [{ category: { sortOrder: 'asc' } }, { categoryId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
    if (!funds.length) return [];

    const lastClosed = await this.prisma.budgetMonth.findFirst({
      where: { status: 'closed' },
      orderBy: { month: 'desc' },
      select: { month: true },
    });
    const anchor = lastClosed
      ? addMonths(lastClosed.month, 1)
      : (await this.prisma.budgetMonth.findFirst({ orderBy: { month: 'asc' }, select: { month: true } }))?.month;
    const lines = anchor
      ? await this.prisma.budgetLine.findMany({ where: { month: anchor, subcategoryId: { in: funds.map((f) => f.id) } } })
      : [];
    const bySub = new Map(lines.map((line) => [line.subcategoryId, line.carryInCents + line.deficitPaidCents]));

    return funds.map((sub) => ({
      subcategoryId: sub.id,
      subcategoryName: sub.name,
      categoryName: sub.category.name,
      balanceCents: bySub.get(sub.id) ?? 0,
    }));
  }
}
