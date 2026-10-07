import { Injectable } from '@nestjs/common';
import {
  addMonths,
  type CategoryType,
  monthBounds,
  monthLabel,
  monthOf,
  nextDueAfterPayment,
  recurringInstallment,
  type RecurringLineInfo,
  recurringStatus,
} from '@stabilitea/shared';
import { conflict, monthClosed, notFound } from '../common/errors.js';
import { type Db, PrismaService } from '../prisma/prisma.service.js';

export type LineResult = 'regular' | 'carried' | 'released' | 'stored' | 'settled';

export interface LineOutcome {
  categoryId: number;
  /**
   * available − spent for the line. Fund: its balance at the end of the month. Recurring: the money still stored, or
   * once paid, the leftover (positive) or shortfall (negative).
   */
  remainingCents: number;
  /**
   * regular: spending came out of savings (remaining is informational).
   * carried: fund balance (positive or negative) became next month's carry-in.
   * released: a fund or recurring balance had no line of the same type to carry into, so it went to savings.
   * stored: recurring money (plus this month's share) carried into next month, waiting for the bill.
   * settled: the recurring bill was paid from the stored money; the leftover or shortfall went to savings.
   */
  result: LineResult;
}

export interface DeficitPaymentResult {
  paidCents: number;
  /** Deficit still left on the line after the payment (0 when fully covered). */
  remainingDeficitCents: number;
}

export const INCOME = 'income';
export const SPENDING = 'spending';
export const FUND_CONTRIBUTION = 'fund_contribution';
export const FUND_RELEASE = 'fund_release';
export const RECURRING_STORE = 'recurring_store';
export const RECURRING_RELEASE = 'recurring_release';
export const DEFICIT_PAYMENT = 'deficit_payment';
/** Entries written by closing a month (and removed by reopening it). */
export const CLOSE_KINDS = [INCOME, SPENDING, FUND_CONTRIBUTION, FUND_RELEASE, RECURRING_STORE, RECURRING_RELEASE];

export const STANDARD: CategoryType = 'standard';
export const FUND: CategoryType = 'fund';
export const RECURRING: CategoryType = 'recurring';

/** The recurring snapshot for an API response, or null for other lines. */
export function recurringInfo(
  line: { type: string; billCents: number | null; billMonths: number | null; dueMonth: string | null; month: string },
  spentCents: number,
): RecurringLineInfo | null {
  if (line.type !== RECURRING || line.billCents === null || line.billMonths === null || line.dueMonth === null) {
    return null;
  }
  return {
    billCents: line.billCents,
    billMonths: line.billMonths,
    dueMonth: line.dueMonth,
    status: recurringStatus(line.billMonths, line.dueMonth, line.month, spentCents),
  };
}

/** A line's budget for the month: limit + carry-in (may be negative) + deficit paid from savings. */
export function lineAvailable(line: { limitCents: number; carryInCents: number; deficitPaidCents: number }): number {
  return line.limitCents + line.carryInCents + line.deficitPaidCents;
}

interface LineLike {
  categoryId: number;
  limitCents: number;
  carryInCents: number;
  deficitPaidCents: number;
  type: string;
}

export interface SavingsMove {
  kind:
    | typeof INCOME
    | typeof SPENDING
    | typeof FUND_CONTRIBUTION
    | typeof FUND_RELEASE
    | typeof RECURRING_STORE
    | typeof RECURRING_RELEASE;
  categoryId: number;
  amountCents: number;
}

export interface ClosePlan {
  moves: SavingsMove[];
  /** categoryId → carry-in for next month's fund or recurring line. */
  carries: Map<number, number>;
  /** Recurring categories whose bill was paid this month. */
  settled: Set<number>;
  outcomes: LineOutcome[];
}

/**
 * Pure close calculation.
 *
 * - Income goes into savings; standard spending comes out of it.
 * - Fund: its limit moves from savings into the fund, and the balance (limit + carry-in + deficit paid − spent)
 *   carries into next month's fund line, or is released to savings when there is none.
 * - Recurring: this month's share moves from savings into storage. With no payment, the stored money carries into
 *   next month's recurring line (or is released when there is none). Once a payment is recorded, the bill is paid
 *   from the stored money and what's left (positive) or missing (negative) settles with savings.
 * - A standard line still holding money (its category changed type this month) releases it. `previousTypes` says
 *   whether that money was a fund balance or stored for a bill.
 *
 * Invariant: savings + Σ fund balances + Σ recurring stored changes by exactly income − all spending.
 */
export function planClose(
  lines: LineLike[],
  spent: Map<number, number>,
  income: Map<number, number>,
  nextTypes: Map<number, string>,
  previousTypes: Map<number, string> = new Map(),
): ClosePlan {
  const moves: SavingsMove[] = [];
  const carries = new Map<number, number>();
  const settled = new Set<number>();
  const outcomes: LineOutcome[] = [];

  for (const [categoryId, amountCents] of income) {
    if (amountCents !== 0) moves.push({ kind: INCOME, categoryId, amountCents });
  }

  const lineByCategory = new Map(lines.map((line) => [line.categoryId, line]));
  for (const [categoryId, amount] of spent) {
    const type = lineByCategory.get(categoryId)?.type ?? STANDARD;
    if (amount !== 0 && type !== FUND && type !== RECURRING) {
      moves.push({ kind: SPENDING, categoryId, amountCents: -amount });
    }
  }

  for (const line of lines) {
    const { categoryId } = line;
    const spentCents = spent.get(categoryId) ?? 0;
    const remainingCents = lineAvailable(line) - spentCents;

    if (line.type === FUND) {
      if (line.limitCents !== 0) moves.push({ kind: FUND_CONTRIBUTION, categoryId, amountCents: -line.limitCents });
      if (nextTypes.get(categoryId) === FUND) {
        carries.set(categoryId, remainingCents);
        outcomes.push({ categoryId, remainingCents, result: 'carried' });
      } else {
        if (remainingCents !== 0) moves.push({ kind: FUND_RELEASE, categoryId, amountCents: remainingCents });
        outcomes.push({ categoryId, remainingCents, result: 'released' });
      }
      continue;
    }

    if (line.type === RECURRING) {
      if (line.limitCents !== 0) moves.push({ kind: RECURRING_STORE, categoryId, amountCents: -line.limitCents });
      if (spentCents > 0) {
        settled.add(categoryId);
        if (remainingCents !== 0) moves.push({ kind: RECURRING_RELEASE, categoryId, amountCents: remainingCents });
        outcomes.push({ categoryId, remainingCents, result: 'settled' });
      } else if (nextTypes.get(categoryId) === RECURRING) {
        carries.set(categoryId, remainingCents);
        outcomes.push({ categoryId, remainingCents, result: 'stored' });
      } else {
        if (remainingCents !== 0) moves.push({ kind: RECURRING_RELEASE, categoryId, amountCents: remainingCents });
        outcomes.push({ categoryId, remainingCents, result: 'released' });
      }
      continue;
    }

    const held = line.carryInCents + line.deficitPaidCents;
    if (held !== 0) {
      const kind = previousTypes.get(categoryId) === RECURRING ? RECURRING_RELEASE : FUND_RELEASE;
      moves.push({ kind, categoryId, amountCents: held });
    }
    outcomes.push({ categoryId, remainingCents, result: 'regular' });
  }

  return { moves, carries, settled, outcomes };
}

/**
 * Month lifecycle rules: auto-copy, close (savings flow and fund carry-overs), reopen, and deficit payments.
 * Every public method runs inside a single database transaction.
 */
@Injectable()
export class BudgetLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the budget month, creating it by copying the most recent earlier month if missing. Also drops archived
   * categories' empty lines from open months (see {@link dropArchivedLines}).
   */
  ensureMonth(month: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureMonthIn(tx, month);
      await this.dropArchivedLines(tx);
    });
  }

  async ensureMonthIn(db: Db, month: string): Promise<void> {
    const existing = await db.budgetMonth.findUnique({ where: { month } });
    if (existing) return;

    const source = await db.budgetMonth.findFirst({
      where: { month: { lt: month } },
      orderBy: { month: 'desc' },
      include: { lines: true },
    });
    // A recurring line's limit is a calculated share, so only copy limits between non-recurring lines.
    const sourceLimits = new Map(
      source?.lines.filter((line) => line.type !== RECURRING).map((line) => [line.categoryId, line.limitCents]) ?? [],
    );

    const categories = await db.category.findMany({
      where: { archivedAt: null, group: { archivedAt: null, kind: 'expense' } },
    });

    await db.budgetMonth.create({
      data: {
        month,
        status: 'open',
        plannedIncomeCents: source?.plannedIncomeCents ?? 0,
        lines: {
          create: categories.map((category) => ({
            categoryId: category.id,
            limitCents: category.type === RECURRING ? 0 : (sourceLimits.get(category.id) ?? category.defaultLimitCents),
            carryInCents: 0,
            type: category.type,
          })),
        },
      },
    });
    if (categories.some((category) => category.type === RECURRING)) await this.syncRecurringLines(db);
  }

  /** Throws 409 MONTH_CLOSED when the month exists and is closed. */
  async assertOpen(db: Db, month: string): Promise<void> {
    const row = await db.budgetMonth.findUnique({ where: { month }, select: { status: true } });
    if (row?.status === 'closed') throw monthClosed(month);
  }

  /** Transaction totals per category for a month and type. */
  async totalsByCategory(db: Db, month: string, type: 'income' | 'expense'): Promise<Map<number, number>> {
    const { first, last } = monthBounds(month);
    const rows = await db.transaction.groupBy({
      by: ['categoryId'],
      where: { type, date: { gte: first, lte: last } },
      _sum: { amountCents: true },
    });
    return new Map(rows.map((row) => [row.categoryId, row._sum.amountCents ?? 0]));
  }

  /** Expense spending per category for a month. */
  spentByCategory(db: Db, month: string): Promise<Map<number, number>> {
    return this.totalsByCategory(db, month, 'expense');
  }

  async savingsBalance(db: Db): Promise<number> {
    const result = await db.savingsEntry.aggregate({ _sum: { amountCents: true } });
    return result._sum.amountCents ?? 0;
  }

  async earliestOpenBefore(db: Db, month: string): Promise<string | null> {
    const row = await db.budgetMonth.findFirst({
      where: { month: { lt: month }, status: 'open' },
      orderBy: { month: 'asc' },
      select: { month: true },
    });
    return row?.month ?? null;
  }

  /** Close a month: write its savings entries and carry fund balances into next month. See {@link planClose}. */
  close(month: string, now: Date = new Date()): Promise<LineOutcome[]> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureMonthIn(tx, month);
      const current = await tx.budgetMonth.findUniqueOrThrow({ where: { month }, include: { lines: true } });
      if (current.status === 'closed') throw conflict(`${monthLabel(month)} is already closed.`);

      const next = addMonths(month, 1);
      await this.ensureMonthIn(tx, next);
      const nextMonth = await tx.budgetMonth.findUniqueOrThrow({ where: { month: next }, include: { lines: true } });
      if (nextMonth.status === 'closed') {
        throw conflict(`${monthLabel(next)} is closed. Reopen it before closing ${monthLabel(month)}.`);
      }

      // Carry-ins are owned by this close; start from a clean slate.
      await tx.budgetLine.updateMany({ where: { month: next }, data: { carryInCents: 0 } });

      // Recurring shares depend on what's stored and paid; make sure this month's are current before closing.
      await this.syncRecurringLines(tx);
      const lines = await tx.budgetLine.findMany({ where: { month } });
      const previous = await tx.budgetLine.findMany({ where: { month: addMonths(month, -1) } });

      const plan = planClose(
        lines,
        await this.totalsByCategory(tx, month, 'expense'),
        await this.totalsByCategory(tx, month, 'income'),
        new Map(nextMonth.lines.map((line) => [line.categoryId, line.type])),
        new Map(previous.map((line) => [line.categoryId, line.type])),
      );

      const nextIds = new Map(nextMonth.lines.map((line) => [line.categoryId, line.id]));
      for (const [categoryId, carryInCents] of plan.carries) {
        if (carryInCents !== 0) {
          await tx.budgetLine.update({ where: { id: nextIds.get(categoryId)! }, data: { carryInCents } });
        }
      }
      if (plan.moves.length) {
        await tx.savingsEntry.createMany({
          data: plan.moves.map((move) => ({ ...move, month, createdAt: now })),
        });
      }

      // A paid bill starts its next cycle.
      for (const line of lines) {
        if (!plan.settled.has(line.categoryId) || !line.dueMonth || !line.billMonths) continue;
        await tx.category.updateMany({
          where: { id: line.categoryId, type: RECURRING },
          data: { nextDueMonth: nextDueAfterPayment(line.dueMonth, line.billMonths, month) },
        });
      }

      await tx.budgetMonth.update({ where: { month }, data: { status: 'closed', closedAt: now } });
      await this.syncRecurringLines(tx);
      return plan.outcomes;
    });
  }

  /**
   * Reverse a close. Allowed only while the following month is open. Removes the month's close entries and resets
   * next month's carry-ins; deficit payments recorded on the month stay in place.
   */
  reopen(month: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.budgetMonth.findUnique({ where: { month } });
      if (!current || current.status !== 'closed') throw conflict(`${monthLabel(month)} is not closed.`);

      const next = addMonths(month, 1);
      const nextMonth = await tx.budgetMonth.findUnique({ where: { month: next } });
      if (nextMonth?.status === 'closed') {
        throw conflict(`Reopen ${monthLabel(next)} first. Months reopen newest-first.`);
      }

      await tx.savingsEntry.deleteMany({ where: { month, kind: { in: CLOSE_KINDS } } });
      if (nextMonth) {
        await tx.budgetLine.updateMany({ where: { month: next }, data: { carryInCents: 0 } });
      }
      // Put each recurring bill back on the cycle it had in this month.
      const recurringLines = await tx.budgetLine.findMany({ where: { month, type: RECURRING, dueMonth: { not: null } } });
      for (const line of recurringLines) {
        await tx.category.updateMany({
          where: { id: line.categoryId, type: RECURRING },
          data: { nextDueMonth: line.dueMonth },
        });
      }
      await tx.budgetMonth.update({ where: { month }, data: { status: 'open', closedAt: null } });
      await this.syncRecurringLines(tx);
    });
  }

  /**
   * Cover a fund's deficit (remaining < 0) from savings. Pays the whole deficit when savings allows, otherwise the
   * entire positive savings balance. Recorded on the line and as a negative savings entry.
   */
  payDeficit(month: string, lineId: number, now: Date = new Date()): Promise<DeficitPaymentResult> {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.budgetLine.findUnique({ where: { id: lineId }, include: { category: true } });
      if (!line || line.month !== month) throw notFound(`Budget line ${lineId} not found in ${month}`);
      await this.assertOpen(tx, month);
      if (line.type !== FUND) {
        throw conflict(
          line.type === RECURRING
            ? `${line.category.name} is a recurring bill; a shortfall comes out of savings when the month closes.`
            : `${line.category.name} isn't a fund, so its spending already comes out of savings.`,
        );
      }

      const spent = (await this.spentByCategory(tx, month)).get(line.categoryId) ?? 0;
      const deficit = spent - lineAvailable(line);
      if (deficit <= 0) throw conflict(`${line.category.name} has no deficit to pay.`);

      const balance = await this.savingsBalance(tx);
      if (balance <= 0) throw conflict('There are no savings available to pay this deficit.');

      const paidCents = Math.min(deficit, balance);
      await tx.savingsEntry.create({
        data: {
          kind: DEFICIT_PAYMENT,
          month,
          categoryId: line.categoryId,
          budgetLineId: line.id,
          amountCents: -paidCents,
          createdAt: now,
        },
      });
      await tx.budgetLine.update({ where: { id: line.id }, data: { deficitPaidCents: { increment: paidCents } } });
      return { paidCents, remainingDeficitCents: deficit - paidCents };
    });
  }

  /** Reverse a deficit payment while its month is open; the money returns to savings. */
  undoDeficitPayment(month: string, entryId: number): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.savingsEntry.findUnique({ where: { id: entryId } });
      if (!entry || entry.kind !== DEFICIT_PAYMENT || entry.month !== month) {
        throw notFound(`Deficit payment ${entryId} not found in ${month}`);
      }
      await this.assertOpen(tx, month);
      if (entry.budgetLineId !== null) {
        await tx.budgetLine.update({
          where: { id: entry.budgetLineId },
          data: { deficitPaidCents: { decrement: -entry.amountCents } },
        });
      }
      await tx.savingsEntry.delete({ where: { id: entry.id } });
    });
  }

  /**
   * Propagate a category's type to its lines in open months only. Lines leaving recurring go back to the default
   * limit; recurring lines get their calculated shares.
   */
  async applyTypeToOpenMonths(db: Db, categoryId: number, type: CategoryType, defaultLimitCents: number): Promise<void> {
    const where = { categoryId, budgetMonth: { status: 'open' } };
    if (type !== RECURRING) {
      await db.budgetLine.updateMany({
        where: { ...where, type: RECURRING },
        data: { limitCents: defaultLimitCents, billCents: null, billMonths: null, dueMonth: null },
      });
    }
    await db.budgetLine.updateMany({ where, data: { type } });
    await this.syncRecurringLines(db, categoryId);
  }

  /**
   * Remove open-month lines whose category or group is archived, so archived categories leave the budget. A line
   * that still holds money (a carried fund balance, stored bill money or a deficit payment) or has spending that month
   * stays, because closing has to settle it with savings.
   */
  async dropArchivedLines(db: Db, categoryIds?: number[]): Promise<void> {
    const lines = await db.budgetLine.findMany({
      where: {
        budgetMonth: { status: 'open' },
        carryInCents: 0,
        deficitPaidCents: 0,
        savingsEntries: { none: {} },
        category: { OR: [{ archivedAt: { not: null } }, { group: { archivedAt: { not: null } } }] },
        ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      },
      select: { id: true, month: true, categoryId: true },
    });
    for (const line of lines) {
      const { first, last } = monthBounds(line.month);
      const spending = await db.transaction.count({
        where: { categoryId: line.categoryId, date: { gte: first, lte: last } },
      });
      if (spending === 0) await db.budgetLine.delete({ where: { id: line.id } });
    }
  }

  /** Give a newly active expense category a line (at its default limit) in every open month. */
  async addLineToOpenMonths(db: Db, categoryId: number): Promise<void> {
    const category = await db.category.findUniqueOrThrow({ where: { id: categoryId }, include: { group: true } });
    if (category.group.kind !== 'expense' || category.archivedAt || category.group.archivedAt) return;
    const openMonths = await db.budgetMonth.findMany({
      where: { status: 'open', lines: { none: { categoryId } } },
      select: { month: true },
    });
    for (const { month } of openMonths) {
      await db.budgetLine.create({
        data: {
          month,
          categoryId,
          limitCents: category.type === RECURRING ? 0 : category.defaultLimitCents,
          carryInCents: 0,
          type: category.type,
        },
      });
    }
    await this.syncRecurringLines(db, categoryId);
  }

  /**
   * Recalculate recurring lines in open months, oldest first: each month's share of the bill, plus a snapshot of the
   * bill and the cycle's due month. The first open month starts from its real carry-in; later open months assume the
   * months before them close as they stand (shares stored, a recorded payment starts the next cycle).
   */
  async syncRecurringLines(db: Db, categoryId?: number): Promise<void> {
    const categories = await db.category.findMany({ where: { type: RECURRING, ...(categoryId ? { id: categoryId } : {}) } });
    for (const category of categories) {
      const { billCents, billMonths, nextDueMonth } = category;
      if (billCents === null || billMonths === null || nextDueMonth === null) continue;
      const lines = await db.budgetLine.findMany({
        where: { categoryId: category.id, type: RECURRING, budgetMonth: { status: 'open' } },
        orderBy: { month: 'asc' },
      });
      if (!lines.length) continue;

      const payments = await db.transaction.findMany({
        where: { categoryId: category.id, type: 'expense', date: { gte: monthBounds(lines[0]!.month).first } },
        select: { date: true, amountCents: true },
      });
      const paid = new Set(payments.filter((p) => p.amountCents > 0).map((p) => monthOf(p.date)));

      let due = nextDueMonth;
      let projected: { month: string; stored: number } | null = null;
      for (const line of lines) {
        // Follow the projection only when this month directly follows the previous open one.
        const stored: number =
          projected && projected.month === line.month ? projected.stored : line.carryInCents + line.deficitPaidCents;
        const share = recurringInstallment(billCents, billMonths, due, line.month, stored);
        if (line.limitCents !== share || line.billCents !== billCents || line.billMonths !== billMonths || line.dueMonth !== due) {
          await db.budgetLine.update({
            where: { id: line.id },
            data: { limitCents: share, billCents, billMonths, dueMonth: due },
          });
        }
        const nextMonth = addMonths(line.month, 1);
        if (paid.has(line.month)) {
          due = nextDueAfterPayment(due, billMonths, line.month);
          projected = { month: nextMonth, stored: 0 };
        } else {
          projected = { month: nextMonth, stored: stored + share };
        }
      }
    }
  }
}
