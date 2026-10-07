import { Injectable } from '@nestjs/common';
import { addMonths, type GroupSummary, type MonthSummary } from '@stabilitea/shared';
import { BudgetLifecycleService, planClose } from '../budgets/budget-lifecycle.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface Row {
  categoryId: number;
  categoryName: string;
  categorySort: number;
  groupId: number;
  groupName: string;
  groupSort: number;
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
        include: { lines: { include: { category: { include: { group: true } } } } },
      });
      const income = await this.lifecycle.totalsByCategory(tx, month, 'income');
      const spent = await this.lifecycle.spentByCategory(tx, month);

      const rows = new Map<number, Row>();
      for (const line of budget.lines) {
        const category = line.category;
        rows.set(category.id, {
          categoryId: category.id,
          categoryName: category.name,
          categorySort: category.sortOrder,
          groupId: category.group.id,
          groupName: category.group.name,
          groupSort: category.group.sortOrder,
          fund: line.fund,
          limitCents: line.limitCents,
          carryInCents: line.carryInCents,
          deficitPaidCents: line.deficitPaidCents,
          spentCents: spent.get(category.id) ?? 0,
        });
      }

      // Spending in categories without a line this month (e.g. archived) still counts.
      const unbudgeted = [...spent.keys()].filter((id) => !rows.has(id));
      if (unbudgeted.length) {
        const categories = await tx.category.findMany({ where: { id: { in: unbudgeted } }, include: { group: true } });
        for (const category of categories) {
          rows.set(category.id, {
            categoryId: category.id,
            categoryName: category.name,
            categorySort: category.sortOrder,
            groupId: category.group.id,
            groupName: category.group.name,
            groupSort: category.group.sortOrder,
            fund: false,
            limitCents: 0,
            carryInCents: 0,
            deficitPaidCents: 0,
            spentCents: spent.get(category.id) ?? 0,
          });
        }
      }

      const sorted = [...rows.values()].sort(
        (a, b) =>
          a.groupSort - b.groupSort ||
          a.groupId - b.groupId ||
          a.categorySort - b.categorySort ||
          a.categoryId - b.categoryId,
      );

      const groups: GroupSummary[] = [];
      for (const row of sorted) {
        let group = groups.at(-1);
        if (!group || group.id !== row.groupId) {
          group = {
            id: row.groupId,
            name: row.groupName,
            limitCents: 0,
            availableCents: 0,
            deficitPaidCents: 0,
            spentCents: 0,
            categories: [],
          };
          groups.push(group);
        }
        group.limitCents += row.limitCents;
        group.availableCents += row.limitCents + row.carryInCents + row.deficitPaidCents;
        group.deficitPaidCents += row.deficitPaidCents;
        group.spentCents += row.spentCents;
        group.categories.push({
          id: row.categoryId,
          name: row.categoryName,
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
      const deficitPaidCents = groups.reduce((sum, c) => sum + c.deficitPaidCents, 0);

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
            ? next.lines.map((l) => l.categoryId)
            : budget.lines.filter((l) => l.fund && !l.category.archivedAt).map((l) => l.categoryId),
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
        groups,
      };
    });
  }
}
