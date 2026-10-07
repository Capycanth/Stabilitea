import { Injectable } from '@nestjs/common';
import { addMonths, type BudgetGroup, type BudgetMonthDto, type CategoryType } from '@stabilitea/shared';
import { conflict, notFound } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BudgetLifecycleService, DEFICIT_PAYMENT, lineAvailable, RECURRING, recurringInfo } from './budget-lifecycle.service.js';

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
        include: { lines: { include: { category: { include: { group: true } } } } },
      });
      const next = await tx.budgetMonth.findUnique({ where: { month: addMonths(month, 1) }, select: { status: true } });
      const spent = await this.lifecycle.spentByCategory(tx, month);
      const savingsBalanceCents = await this.lifecycle.savingsBalance(tx);
      const payments = await tx.savingsEntry.findMany({
        where: { month, kind: DEFICIT_PAYMENT },
        orderBy: { id: 'asc' },
        include: { category: { include: { group: true } } },
      });

      const sorted = [...row.lines].sort(
        (a, b) =>
          a.category.group.sortOrder - b.category.group.sortOrder ||
          a.category.group.id - b.category.group.id ||
          a.category.sortOrder - b.category.sortOrder ||
          a.category.id - b.category.id,
      );

      const groups: BudgetGroup[] = [];
      for (const line of sorted) {
        const group = line.category.group;
        let entry = groups.at(-1);
        if (!entry || entry.groupId !== group.id) {
          entry = { groupId: group.id, groupName: group.name, lines: [] };
          groups.push(entry);
        }
        const spentCents = spent.get(line.categoryId) ?? 0;
        const availableCents = lineAvailable(line);
        entry.lines.push({
          id: line.id,
          month: line.month,
          categoryId: line.categoryId,
          categoryName: line.category.name,
          limitCents: line.limitCents,
          carryInCents: line.carryInCents,
          deficitPaidCents: line.deficitPaidCents,
          availableCents,
          type: line.type as CategoryType,
          recurring: recurringInfo(line, spentCents),
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
        groups: groups,
        deficitPayments: payments.map((p) => ({
          id: p.id,
          month: p.month,
          budgetLineId: p.budgetLineId,
          categoryId: p.categoryId,
          categoryName: p.category?.name ?? null,
          groupName: p.category?.group.name ?? null,
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
      if (line.type === RECURRING) {
        throw conflict("A recurring bill's monthly share is calculated from the bill. Change the bill on the Categories page.");
      }
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
