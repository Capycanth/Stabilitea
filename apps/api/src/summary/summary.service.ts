import { Injectable } from '@nestjs/common';
import { type CategorySummary, monthBounds, type MonthSummary } from '@stabilitea/shared';
import { BudgetLifecycleService } from '../budgets/budget-lifecycle.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface Row {
  subcategoryId: number;
  subcategoryName: string;
  subcategorySort: number;
  categoryId: number;
  categoryName: string;
  categorySort: number;
  rollover: boolean;
  limitCents: number;
  carryInCents: number;
  deficitPaidCents: number;
  spentCents: number;
}

@Injectable()
export class SummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: BudgetLifecycleService,
  ) {}

  async get(month: string): Promise<MonthSummary> {
    await this.lifecycle.ensureMonth(month);
    return this.prisma.$transaction(async (tx) => {
      const budget = await tx.budgetMonth.findUniqueOrThrow({
        where: { month },
        include: { lines: { include: { subcategory: { include: { category: true } } } } },
      });
      const { first, last } = monthBounds(month);
      const income = await tx.transaction.aggregate({
        where: { type: 'income', date: { gte: first, lte: last } },
        _sum: { amountCents: true },
      });
      const spent = await this.lifecycle.spentBySubcategory(tx, month);

      const rows = new Map<number, Row>();
      for (const line of budget.lines) {
        const sub = line.subcategory;
        rows.set(sub.id, {
          subcategoryId: sub.id,
          subcategoryName: sub.name,
          subcategorySort: sub.sortOrder,
          categoryId: sub.category.id,
          categoryName: sub.category.name,
          categorySort: sub.category.sortOrder,
          rollover: line.rollover,
          limitCents: line.limitCents,
          carryInCents: line.carryInCents,
          deficitPaidCents: line.deficitPaidCents,
          spentCents: spent.get(sub.id) ?? 0,
        });
      }

      // Spending in subcategories without a line this month (e.g. archived) still counts.
      const unbudgeted = [...spent.keys()].filter((id) => !rows.has(id));
      if (unbudgeted.length) {
        const subs = await tx.subcategory.findMany({ where: { id: { in: unbudgeted } }, include: { category: true } });
        for (const sub of subs) {
          rows.set(sub.id, {
            subcategoryId: sub.id,
            subcategoryName: sub.name,
            subcategorySort: sub.sortOrder,
            categoryId: sub.category.id,
            categoryName: sub.category.name,
            categorySort: sub.category.sortOrder,
            rollover: sub.category.rollover,
            limitCents: 0,
            carryInCents: 0,
            deficitPaidCents: 0,
            spentCents: spent.get(sub.id) ?? 0,
          });
        }
      }

      const sorted = [...rows.values()].sort(
        (a, b) =>
          a.categorySort - b.categorySort ||
          a.categoryId - b.categoryId ||
          a.subcategorySort - b.subcategorySort ||
          a.subcategoryId - b.subcategoryId,
      );

      const categories: CategorySummary[] = [];
      for (const row of sorted) {
        let category = categories.at(-1);
        if (!category || category.id !== row.categoryId) {
          category = {
            id: row.categoryId,
            name: row.categoryName,
            rollover: row.rollover,
            limitCents: 0,
            availableCents: 0,
            deficitPaidCents: 0,
            spentCents: 0,
            subcategories: [],
          };
          categories.push(category);
        }
        category.limitCents += row.limitCents;
        category.availableCents += row.limitCents + row.carryInCents + row.deficitPaidCents;
        category.deficitPaidCents += row.deficitPaidCents;
        category.spentCents += row.spentCents;
        category.subcategories.push({
          id: row.subcategoryId,
          name: row.subcategoryName,
          limitCents: row.limitCents,
          carryInCents: row.carryInCents,
          deficitPaidCents: row.deficitPaidCents,
          spentCents: row.spentCents,
          remainingCents: row.limitCents + row.carryInCents + row.deficitPaidCents - row.spentCents,
        });
      }

      const incomeCents = income._sum.amountCents ?? 0;
      const expenseCents = [...spent.values()].reduce((sum, value) => sum + value, 0);
      return {
        month,
        status: budget.status === 'closed' ? 'closed' : 'open',
        plannedIncomeCents: budget.plannedIncomeCents,
        incomeCents,
        expenseCents,
        netCents: incomeCents - expenseCents,
        deficitPaidCents: categories.reduce((sum, c) => sum + c.deficitPaidCents, 0),
        earliestOpenPastMonth: await this.lifecycle.earliestOpenBefore(tx, month),
        categories,
      };
    });
  }
}
