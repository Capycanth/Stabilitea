import { Injectable } from '@nestjs/common';
import { type CategoryType, monthBounds } from '@stabilitea/shared';
import {
  DEFICIT_PAYMENT,
  FUND,
  FUND_CONTRIBUTION,
  FUND_RELEASE,
  lineAvailable,
  RECURRING,
  RECURRING_RELEASE,
  RECURRING_STORE,
} from '../budgets/budget-lifecycle.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type MonthReportStatus = 'open' | 'closed' | 'not budgeted';
export type CloseOutcome =
  | 'regular'
  | 'carried'
  | 'carried-deficit'
  | 'released'
  | 'stored'
  | 'settled'
  | 'recurring-released'
  | 'open';

export interface LineReport {
  month: string;
  groupName: string;
  categoryName: string;
  type: CategoryType;
  /** Recurring lines: the cycle's due month. */
  dueMonth: string | null;
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
  /** Moved from savings into funds at close. */
  fundContributionCents: number;
  /** Fund balances handed back to savings at close (may be negative). */
  fundReleaseCents: number;
  /** Stored from savings for recurring bills at close. */
  recurringStoredCents: number;
  /** Recurring leftovers (+) and shortfalls (−) settled with savings at close. */
  recurringReleaseCents: number;
  deficitPaidCents: number;
  /** Sum of the month's savings entries (0 for a month that isn't closed, apart from deficit payments). */
  savingsChangeCents: number;
  savingsBalanceEndCents: number;
  lines: LineReport[];
}

export interface GroupYearReport {
  groupName: string;
  budgetedCents: number;
  spentCents: number;
  deficitPaidCents: number;
}

export interface YearReport {
  year: number;
  generatedAt: Date;
  months: MonthReport[];
  groups: GroupYearReport[];
  totals: {
    plannedIncomeCents: number;
    incomeCents: number;
    expenseCents: number;
    netCents: number;
    budgetedCents: number;
    fundContributionCents: number;
    fundReleaseCents: number;
    recurringStoredCents: number;
    recurringReleaseCents: number;
    deficitPaidCents: number;
    savingsChangeCents: number;
    deficitPaymentCount: number;
    savingsBalanceStartCents: number;
    savingsBalanceEndCents: number;
    monthsClosed: number;
  };
}

function outcomeFor(
  status: MonthReportStatus,
  type: string,
  released: boolean,
  spentCents: number,
  remaining: number,
): CloseOutcome {
  if (status !== 'closed') return 'open';
  if (type === RECURRING) {
    if (spentCents > 0) return 'settled';
    return released ? 'recurring-released' : 'stored';
  }
  if (type !== FUND) return 'regular';
  if (released) return 'released';
  return remaining < 0 ? 'carried-deficit' : 'carried';
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

    const [budgetMonths, transactions, savingsBefore, entries, categories] = await Promise.all([
      this.prisma.budgetMonth.findMany({
        where: { month: { gte: firstMonth, lte: lastMonth } },
        include: { lines: true },
      }),
      this.prisma.transaction.findMany({
        where: { date: { gte: monthBounds(firstMonth).first, lte: monthBounds(lastMonth).last } },
        select: { date: true, type: true, amountCents: true, categoryId: true },
      }),
      this.prisma.savingsEntry.aggregate({ where: { month: { lt: firstMonth } }, _sum: { amountCents: true } }),
      this.prisma.savingsEntry.findMany({ where: { month: { gte: firstMonth, lte: lastMonth } } }),
      this.prisma.category.findMany({ include: { group: true } }),
    ]);

    const categoryById = new Map(categories.map((s) => [s.id, s]));
    const sortKey = (categoryId: number) => {
      const category = categoryById.get(categoryId);
      return category ? [category.group.sortOrder, category.group.id, category.sortOrder, category.id] : [Infinity, 0, 0, categoryId];
    };
    const byMonth = new Map(budgetMonths.map((m) => [m.month, m]));

    let balance = savingsBefore._sum.amountCents ?? 0;
    const savingsBalanceStartCents = balance;
    const groupTotals = new Map<number, GroupYearReport & { sort: number[] }>();
    let deficitPaymentCount = 0;

    const months: MonthReport[] = monthKeys.map((month) => {
      const budget = byMonth.get(month);
      const status: MonthReportStatus = budget ? (budget.status === 'closed' ? 'closed' : 'open') : 'not budgeted';
      const monthTx = transactions.filter((t) => t.date.startsWith(month));
      const incomeCents = monthTx.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amountCents, 0);
      const spent = new Map<number, number>();
      for (const t of monthTx) {
        if (t.type === 'expense') spent.set(t.categoryId, (spent.get(t.categoryId) ?? 0) + t.amountCents);
      }
      const expenseCents = [...spent.values()].reduce((sum, v) => sum + v, 0);

      const monthEntries = entries.filter((e) => e.month === month);
      const kindTotal = (kind: string) => monthEntries.filter((e) => e.kind === kind).reduce((sum, e) => sum + e.amountCents, 0);
      const released = new Set(
        monthEntries.filter((e) => e.kind === FUND_RELEASE || e.kind === RECURRING_RELEASE).map((e) => e.categoryId),
      );
      const payments = monthEntries.filter((e) => e.kind === DEFICIT_PAYMENT);
      deficitPaymentCount += payments.length;
      const savingsChangeCents = monthEntries.reduce((sum, e) => sum + e.amountCents, 0);
      balance += savingsChangeCents;

      const lineSources = [
        ...(budget?.lines ?? []),
        // Spending without a budget line this month still shows up.
        ...[...spent.keys()]
          .filter((id) => !budget?.lines.some((l) => l.categoryId === id))
          .map((id) => ({
            categoryId: id,
            limitCents: 0,
            carryInCents: 0,
            deficitPaidCents: 0,
            type: 'standard',
            dueMonth: null as string | null,
          })),
      ].sort((a, b) => {
        const [ka, kb] = [sortKey(a.categoryId), sortKey(b.categoryId)];
        for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
        return 0;
      });

      const lines: LineReport[] = lineSources.map((line) => {
        const category = categoryById.get(line.categoryId);
        const availableCents = lineAvailable(line);
        const spentCents = spent.get(line.categoryId) ?? 0;
        const remainingCents = availableCents - spentCents;

        if (category) {
          const total = groupTotals.get(category.groupId) ?? {
            groupName: category.group.name,
            budgetedCents: 0,
            spentCents: 0,
            deficitPaidCents: 0,
            sort: [category.group.sortOrder, category.groupId],
          };
          total.budgetedCents += line.limitCents;
          total.spentCents += spentCents;
          total.deficitPaidCents += line.deficitPaidCents;
          groupTotals.set(category.groupId, total);
        }

        return {
          month,
          groupName: category?.group.name ?? 'Unknown',
          categoryName: category?.name ?? `#${line.categoryId}`,
          type: line.type as CategoryType,
          dueMonth: line.type === RECURRING ? line.dueMonth : null,
          limitCents: line.limitCents,
          carryInCents: line.carryInCents,
          deficitPaidCents: line.deficitPaidCents,
          availableCents,
          spentCents,
          remainingCents,
          outcome: outcomeFor(status, line.type, released.has(line.categoryId), spentCents, remainingCents),
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
        fundContributionCents: -kindTotal(FUND_CONTRIBUTION),
        fundReleaseCents: kindTotal(FUND_RELEASE),
        recurringStoredCents: -kindTotal(RECURRING_STORE),
        recurringReleaseCents: kindTotal(RECURRING_RELEASE),
        deficitPaidCents: -payments.reduce((sum, e) => sum + e.amountCents, 0),
        savingsChangeCents,
        savingsBalanceEndCents: balance,
        lines,
      };
    });

    const sum = (pick: (m: MonthReport) => number) => months.reduce((total, m) => total + pick(m), 0);
    return {
      year,
      generatedAt,
      months,
      groups: [...groupTotals.values()]
        .sort((a, b) => a.sort[0]! - b.sort[0]! || a.sort[1]! - b.sort[1]!)
        .map(({ sort: _sort, ...rest }) => rest),
      totals: {
        plannedIncomeCents: sum((m) => m.plannedIncomeCents),
        incomeCents: sum((m) => m.incomeCents),
        expenseCents: sum((m) => m.expenseCents),
        netCents: sum((m) => m.netCents),
        budgetedCents: sum((m) => m.budgetedCents),
        fundContributionCents: sum((m) => m.fundContributionCents),
        fundReleaseCents: sum((m) => m.fundReleaseCents),
        recurringStoredCents: sum((m) => m.recurringStoredCents),
        recurringReleaseCents: sum((m) => m.recurringReleaseCents),
        deficitPaidCents: sum((m) => m.deficitPaidCents),
        savingsChangeCents: sum((m) => m.savingsChangeCents),
        deficitPaymentCount,
        savingsBalanceStartCents,
        savingsBalanceEndCents: balance,
        monthsClosed: months.filter((m) => m.status === 'closed').length,
      },
    };
  }
}
