import { Injectable } from '@nestjs/common';
import { addMonths, type BudgetCategoryGroup, type BudgetMonthDto } from '@stabilitea/shared';
import { notFound } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BudgetLifecycleService, DEFICIT_PAYMENT, lineAvailable } from './budget-lifecycle.service.js';

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: BudgetLifecycleService,
  ) {}

  async get(month: string): Promise<BudgetMonthDto> {
    await this.lifecycle.ensureMonth(month);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.budgetMonth.findUniqueOrThrow({
        where: { month },
        include: { lines: { include: { subcategory: { include: { category: true } } } } },
      });
      const next = await tx.budgetMonth.findUnique({ where: { month: addMonths(month, 1) }, select: { status: true } });
      const spent = await this.lifecycle.spentBySubcategory(tx, month);
      const savingsBalanceCents = await this.lifecycle.savingsBalance(tx);
      const payments = await tx.savingsEntry.findMany({
        where: { month, kind: DEFICIT_PAYMENT },
        orderBy: { id: 'asc' },
        include: { subcategory: { include: { category: true } } },
      });

      const sorted = [...row.lines].sort(
        (a, b) =>
          a.subcategory.category.sortOrder - b.subcategory.category.sortOrder ||
          a.subcategory.category.id - b.subcategory.category.id ||
          a.subcategory.sortOrder - b.subcategory.sortOrder ||
          a.subcategory.id - b.subcategory.id,
      );

      const groups: BudgetCategoryGroup[] = [];
      for (const line of sorted) {
        const category = line.subcategory.category;
        let group = groups.at(-1);
        if (!group || group.categoryId !== category.id) {
          group = { categoryId: category.id, categoryName: category.name, lines: [] };
          groups.push(group);
        }
        const spentCents = spent.get(line.subcategoryId) ?? 0;
        const availableCents = lineAvailable(line);
        group.lines.push({
          id: line.id,
          month: line.month,
          subcategoryId: line.subcategoryId,
          subcategoryName: line.subcategory.name,
          limitCents: line.limitCents,
          carryInCents: line.carryInCents,
          deficitPaidCents: line.deficitPaidCents,
          availableCents,
          rollover: line.rollover,
          spentCents,
          remainingCents: availableCents - spentCents,
        });
      }

      const nextClosed = next?.status === 'closed';
      return {
        month: row.month,
        status: row.status === 'closed' ? 'closed' : 'open',
        plannedIncomeCents: row.plannedIncomeCents,
        closedAt: row.closedAt?.toISOString() ?? null,
        canReopen: row.status === 'closed' && !nextClosed,
        canClose: row.status === 'open' && !nextClosed,
        savingsBalanceCents,
        deficitPaidCents: payments.reduce((sum, p) => sum - p.amountCents, 0),
        categories: groups,
        deficitPayments: payments.map((p) => ({
          id: p.id,
          month: p.month,
          budgetLineId: p.budgetLineId,
          subcategoryId: p.subcategoryId,
          subcategoryName: p.subcategory?.name ?? null,
          categoryName: p.subcategory?.category.name ?? null,
          amountCents: -p.amountCents,
          createdAt: p.createdAt.toISOString(),
        })),
      };
    });
  }

  async updatePlannedIncome(month: string, plannedIncomeCents: number): Promise<BudgetMonthDto> {
    await this.lifecycle.ensureMonth(month);
    await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.assertOpen(tx, month);
      await tx.budgetMonth.update({ where: { month }, data: { plannedIncomeCents } });
    });
    return this.get(month);
  }

  async updateLineLimit(month: string, lineId: number, limitCents: number): Promise<BudgetMonthDto> {
    await this.prisma.$transaction(async (tx) => {
      const line = await tx.budgetLine.findUnique({ where: { id: lineId } });
      if (!line || line.month !== month) throw notFound(`Budget line ${lineId} not found in ${month}`);
      await this.lifecycle.assertOpen(tx, month);
      await tx.budgetLine.update({ where: { id: lineId }, data: { limitCents } });
    });
    return this.get(month);
  }

  async payDeficit(month: string, lineId: number): Promise<BudgetMonthDto> {
    await this.lifecycle.payDeficit(month, lineId);
    return this.get(month);
  }

  async undoDeficitPayment(month: string, entryId: number): Promise<BudgetMonthDto> {
    await this.lifecycle.undoDeficitPayment(month, entryId);
    return this.get(month);
  }

  async close(month: string): Promise<BudgetMonthDto> {
    await this.lifecycle.close(month);
    return this.get(month);
  }

  async reopen(month: string): Promise<BudgetMonthDto> {
    await this.lifecycle.reopen(month);
    return this.get(month);
  }
}
