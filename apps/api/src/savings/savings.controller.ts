import { Controller, Get } from '@nestjs/common';
import {
  addMonths,
  type FundBalanceDto,
  type RecurringBalanceDto,
  type SavingsDto,
  type SavingsEntryKind,
  type SavingsMonthDto,
} from '@stabilitea/shared';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('savings')
export class SavingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(): Promise<SavingsDto> {
    const entries = await this.prisma.savingsEntry.findMany({
      orderBy: [{ month: 'desc' }, { id: 'asc' }],
      include: { category: { include: { group: true } } },
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
          recurringStoredCents: 0,
          recurringReleaseCents: 0,
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
      else if (entry.kind === 'recurring_store') m.recurringStoredCents -= amount;
      else if (entry.kind === 'recurring_release') m.recurringReleaseCents += amount;
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
      ...(await this.heldBalances()),
      months: months.reverse(),
      entries: entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind as SavingsEntryKind,
        month: entry.month,
        categoryId: entry.categoryId,
        categoryName: entry.category?.name ?? null,
        groupName: entry.category?.group.name ?? null,
        amountCents: entry.amountCents,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Each active fund's balance, and the money stored for each active recurring bill, after the latest close: the
   * carry-in (plus any deficit paid) on its line in the month after the latest closed month, or in the first budgeted
   * month when nothing has closed yet.
   */
  private async heldBalances(): Promise<Pick<SavingsDto, 'funds' | 'recurring'>> {
    const categories = await this.prisma.category.findMany({
      where: { type: { in: ['fund', 'recurring'] }, archivedAt: null, group: { kind: 'expense', archivedAt: null } },
      include: { group: true },
      orderBy: [{ group: { sortOrder: 'asc' } }, { groupId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    });
    if (!categories.length) return { funds: [], recurring: [] };

    const lastClosed = await this.prisma.budgetMonth.findFirst({
      where: { status: 'closed' },
      orderBy: { month: 'desc' },
      select: { month: true },
    });
    const anchor = lastClosed
      ? addMonths(lastClosed.month, 1)
      : (await this.prisma.budgetMonth.findFirst({ orderBy: { month: 'asc' }, select: { month: true } }))?.month;
    const lines = anchor
      ? await this.prisma.budgetLine.findMany({ where: { month: anchor, categoryId: { in: categories.map((c) => c.id) } } })
      : [];
    const lineByCategory = new Map(lines.map((line) => [line.categoryId, line]));
    const held = (id: number) => {
      const line = lineByCategory.get(id);
      return line ? line.carryInCents + line.deficitPaidCents : 0;
    };

    const funds: FundBalanceDto[] = categories
      .filter((c) => c.type === 'fund')
      .map((c) => ({ categoryId: c.id, categoryName: c.name, groupName: c.group.name, balanceCents: held(c.id) }));
    const recurring: RecurringBalanceDto[] = categories
      .filter((c) => c.type === 'recurring' && c.billCents !== null && c.billMonths !== null && c.nextDueMonth !== null)
      .map((c) => ({
        categoryId: c.id,
        categoryName: c.name,
        groupName: c.group.name,
        billCents: c.billCents!,
        billMonths: c.billMonths!,
        dueMonth: lineByCategory.get(c.id)?.dueMonth ?? c.nextDueMonth!,
        storedCents: held(c.id),
      }));
    return { funds, recurring };
  }
}
