import { Injectable } from '@nestjs/common';
import { addMonths, type CategorySummary, type MonthSummary } from '@stabilitea/shared';
import { BudgetLifecycleService, planClose } from '../budgets/budget-lifecycle.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface Row {
  subcategoryId: number;
  subcategoryName: string;
  subcategorySort: number;
  categoryId: number;
  categoryName: string;
  categorySort: number;
  fund: boolean;
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
      const income = await this.lifecycle.totalsBySubcategory(tx, month, 'income');
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
          fund: line.fund,
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
            fund: false,
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
          fund: row.fund,
          limitCents: row.limitCents,
          carryInCents: row.carryInCents,
          deficitPaidCents: row.deficitPaidCents,
          spentCents: row.spentCents,
          remainingCents: row.limitCents + row.carryInCents + row.deficitPaidCents - row.spentCents,
        });
      }

      const incomeCents = [...income.values()].reduce((sum, value) => sum + value, 0);
      const expenseCents = [...spent.values()].reduce((sum, value) => sum + value, 0);
      const deficitPaidCents = categories.reduce((sum, c) => sum + c.deficitPaidCents, 0);

      // Closed months: the ledger is the truth. Open months: project what closing today would write.
      let savingsChangeCents: number;
      if (budget.status === 'closed') {
        const { _sum } = await tx.savingsEntry.aggregate({ where: { month }, _sum: { amountCents: true } });
        savingsChangeCents = _sum.amountCents ?? 0;
      } else {
        const next = await tx.budgetMonth.findUnique({
          where: { month: addMonths(month, 1) },
          include: { lines: { where: { fund: true } } },
        });
        const nextFund = new Set(
          next
            ? next.lines.map((l) => l.subcategoryId)
            : budget.lines.filter((l) => l.fund && !l.subcategory.archivedAt).map((l) => l.subcategoryId),
        );
        const plan = planClose(budget.lines, spent, income, nextFund);
        savingsChangeCents = plan.moves.reduce((sum, m) => sum + m.amountCents, 0) - deficitPaidCents;
      }
      return {
        month,
        status: budget.status === 'closed' ? 'closed' : 'open',
        plannedIncomeCents: budget.plannedIncomeCents,
        incomeCents,
        expenseCents,
        netCents: incomeCents - expenseCents,
        fundContributionCents: budget.lines.filter((l) => l.fund).reduce((sum, l) => sum + l.limitCents, 0),
        deficitPaidCents,
        savingsChangeCents,
        earliestOpenPastMonth: await this.lifecycle.earliestOpenBefore(tx, month),
        categories,
      };
    });
  }
}
