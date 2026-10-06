import { Injectable } from '@nestjs/common';
import { monthBounds } from '@stabilitea/shared';
import { DEFICIT_PAYMENT, lineAvailable, SWEEP } from '../budgets/budget-lifecycle.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type MonthReportStatus = 'open' | 'closed' | 'not budgeted';
export type CloseOutcome = 'carried' | 'carried-deficit' | 'swept' | 'reset' | 'none' | 'open';

export interface LineReport {
  month: string;
  categoryName: string;
  subcategoryName: string;
  rollover: boolean;
  limitCents: number;
  carryInCents: number;
  deficitPaidCents: number;
  /** limit + carry-in + deficit paid */
  availableCents: number;
  spentCents: number;
  remainingCents: number;
  /** What closing did (or will do) with the remaining amount. */
  outcome: CloseOutcome;
}

export interface MonthReport {
  month: string;
  status: MonthReportStatus;
  plannedIncomeCents: number;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  budgetedCents: number;
  carryInCents: number;
  sweptCents: number;
  deficitPaidCents: number;
  savingsBalanceEndCents: number;
  lines: LineReport[];
}

export interface CategoryYearReport {
  categoryName: string;
  budgetedCents: number;
  spentCents: number;
  deficitPaidCents: number;
}

export interface YearReport {
  year: number;
  generatedAt: Date;
  months: MonthReport[];
  categories: CategoryYearReport[];
  totals: {
    plannedIncomeCents: number;
    incomeCents: number;
    expenseCents: number;
    netCents: number;
    budgetedCents: number;
    sweptCents: number;
    deficitPaidCents: number;
    deficitPaymentCount: number;
    savingsBalanceStartCents: number;
    savingsBalanceEndCents: number;
    monthsClosed: number;
  };
}

function outcomeFor(status: MonthReportStatus, rollover: boolean, remaining: number): CloseOutcome {
  if (status !== 'closed') return 'open';
  if (rollover) return remaining === 0 ? 'none' : remaining < 0 ? 'carried-deficit' : 'carried';
  if (remaining > 0) return 'swept';
  return remaining < 0 ? 'reset' : 'none';
}

/** Gathers a calendar year's budgets, actuals and savings movements. Read-only: never creates months. */
@Injectable()
export class YearReportBuilder {
  constructor(private readonly prisma: PrismaService) {}

  async years(): Promise<number[]> {
    const [months, first, last] = await Promise.all([
      this.prisma.budgetMonth.findMany({ select: { month: true } }),
      this.prisma.transaction.findFirst({ orderBy: { date: 'asc' }, select: { date: true } }),
      this.prisma.transaction.findFirst({ orderBy: { date: 'desc' }, select: { date: true } }),
    ]);
    const years = new Set<number>([new Date().getFullYear()]);
    for (const { month } of months) years.add(Number(month.slice(0, 4)));
    if (first && last) {
      for (let y = Number(first.date.slice(0, 4)); y <= Number(last.date.slice(0, 4)); y++) years.add(y);
    }
    return [...years].sort((a, b) => b - a);
  }

  async build(year: number, generatedAt: Date = new Date()): Promise<YearReport> {
    const firstMonth = `${year}-01`;
    const lastMonth = `${year}-12`;
    const monthKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

    const [budgetMonths, transactions, savingsBefore, entries, subcategories] = await Promise.all([
      this.prisma.budgetMonth.findMany({
        where: { month: { gte: firstMonth, lte: lastMonth } },
        include: { lines: true },
      }),
      this.prisma.transaction.findMany({
        where: { date: { gte: monthBounds(firstMonth).first, lte: monthBounds(lastMonth).last } },
        select: { date: true, type: true, amountCents: true, subcategoryId: true },
      }),
      this.prisma.savingsEntry.aggregate({ where: { month: { lt: firstMonth } }, _sum: { amountCents: true } }),
      this.prisma.savingsEntry.findMany({ where: { month: { gte: firstMonth, lte: lastMonth } } }),
      this.prisma.subcategory.findMany({ include: { category: true } }),
    ]);

    const subById = new Map(subcategories.map((s) => [s.id, s]));
    const sortKey = (subcategoryId: number) => {
      const sub = subById.get(subcategoryId);
      return sub ? [sub.category.sortOrder, sub.category.id, sub.sortOrder, sub.id] : [Infinity, 0, 0, subcategoryId];
    };
    const byMonth = new Map(budgetMonths.map((m) => [m.month, m]));

    let balance = savingsBefore._sum.amountCents ?? 0;
    const savingsBalanceStartCents = balance;
    const categoryTotals = new Map<number, CategoryYearReport & { sort: number[] }>();
    let deficitPaymentCount = 0;

    const months: MonthReport[] = monthKeys.map((month) => {
      const budget = byMonth.get(month);
      const status: MonthReportStatus = budget ? (budget.status === 'closed' ? 'closed' : 'open') : 'not budgeted';
      const monthTx = transactions.filter((t) => t.date.startsWith(month));
      const incomeCents = monthTx.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amountCents, 0);
      const spent = new Map<number, number>();
      for (const t of monthTx) {
        if (t.type === 'expense') spent.set(t.subcategoryId, (spent.get(t.subcategoryId) ?? 0) + t.amountCents);
      }
      const expenseCents = [...spent.values()].reduce((sum, v) => sum + v, 0);

      const monthEntries = entries.filter((e) => e.month === month);
      const sweptCents = monthEntries.filter((e) => e.kind === SWEEP).reduce((sum, e) => sum + e.amountCents, 0);
      const payments = monthEntries.filter((e) => e.kind === DEFICIT_PAYMENT);
      deficitPaymentCount += payments.length;
      balance += monthEntries.reduce((sum, e) => sum + e.amountCents, 0);

      const lineSources = [
        ...(budget?.lines ?? []),
        // Spending without a budget line this month still shows up.
        ...[...spent.keys()]
          .filter((id) => !budget?.lines.some((l) => l.subcategoryId === id))
          .map((id) => ({ subcategoryId: id, limitCents: 0, carryInCents: 0, deficitPaidCents: 0, rollover: subById.get(id)?.category.rollover ?? false })),
      ].sort((a, b) => {
        const [ka, kb] = [sortKey(a.subcategoryId), sortKey(b.subcategoryId)];
        for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
        return 0;
      });

      const lines: LineReport[] = lineSources.map((line) => {
        const sub = subById.get(line.subcategoryId);
        const availableCents = lineAvailable(line);
        const spentCents = spent.get(line.subcategoryId) ?? 0;
        const remainingCents = availableCents - spentCents;

        if (sub) {
          const total = categoryTotals.get(sub.categoryId) ?? {
            categoryName: sub.category.name,
            budgetedCents: 0,
            spentCents: 0,
            deficitPaidCents: 0,
            sort: [sub.category.sortOrder, sub.categoryId],
          };
          total.budgetedCents += line.limitCents;
          total.spentCents += spentCents;
          total.deficitPaidCents += line.deficitPaidCents;
          categoryTotals.set(sub.categoryId, total);
        }

        return {
          month,
          categoryName: sub?.category.name ?? 'Unknown',
          subcategoryName: sub?.name ?? `#${line.subcategoryId}`,
          rollover: line.rollover,
          limitCents: line.limitCents,
          carryInCents: line.carryInCents,
          deficitPaidCents: line.deficitPaidCents,
          availableCents,
          spentCents,
          remainingCents,
          outcome: outcomeFor(status, line.rollover, remainingCents),
        };
      });

      return {
        month,
        status,
        plannedIncomeCents: budget?.plannedIncomeCents ?? 0,
        incomeCents,
        expenseCents,
        netCents: incomeCents - expenseCents,
        budgetedCents: lines.reduce((sum, l) => sum + l.limitCents, 0),
        carryInCents: lines.reduce((sum, l) => sum + l.carryInCents, 0),
        sweptCents,
        deficitPaidCents: -payments.reduce((sum, e) => sum + e.amountCents, 0),
        savingsBalanceEndCents: balance,
        lines,
      };
    });

    const sum = (pick: (m: MonthReport) => number) => months.reduce((total, m) => total + pick(m), 0);
    return {
      year,
      generatedAt,
      months,
      categories: [...categoryTotals.values()]
        .sort((a, b) => a.sort[0]! - b.sort[0]! || a.sort[1]! - b.sort[1]!)
        .map(({ sort: _sort, ...rest }) => rest),
      totals: {
        plannedIncomeCents: sum((m) => m.plannedIncomeCents),
        incomeCents: sum((m) => m.incomeCents),
        expenseCents: sum((m) => m.expenseCents),
        netCents: sum((m) => m.netCents),
        budgetedCents: sum((m) => m.budgetedCents),
        sweptCents: sum((m) => m.sweptCents),
        deficitPaidCents: sum((m) => m.deficitPaidCents),
        deficitPaymentCount,
        savingsBalanceStartCents,
        savingsBalanceEndCents: balance,
        monthsClosed: months.filter((m) => m.status === 'closed').length,
      },
    };
  }
}
