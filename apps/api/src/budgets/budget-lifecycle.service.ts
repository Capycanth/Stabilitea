import { Injectable } from '@nestjs/common';
import { addMonths, monthBounds, monthLabel } from '@stabilitea/shared';
import { conflict, monthClosed, notFound } from '../common/errors.js';
import { type Db, PrismaService } from '../prisma/prisma.service.js';

export interface LineOutcome {
  subcategoryId: number;
  /** available − spent for the line. For a fund, its balance at the end of the month. */
  remainingCents: number;
  /**
   * regular: spending came out of savings (remaining is informational).
   * carried: fund balance (positive or negative) became next month's carry-in.
   * released: fund balance had no fund line to carry into, so it went to savings.
   */
  result: 'regular' | 'carried' | 'released';
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
export const DEFICIT_PAYMENT = 'deficit_payment';
/** Entries written by closing a month (and removed by reopening it). */
export const CLOSE_KINDS = [INCOME, SPENDING, FUND_CONTRIBUTION, FUND_RELEASE];

/** A line's budget for the month: limit + carry-in (may be negative) + deficit paid from savings. */
export function lineAvailable(line: { limitCents: number; carryInCents: number; deficitPaidCents: number }): number {
  return line.limitCents + line.carryInCents + line.deficitPaidCents;
}

interface LineLike {
  subcategoryId: number;
  limitCents: number;
  carryInCents: number;
  deficitPaidCents: number;
  fund: boolean;
}

export interface SavingsMove {
  kind: typeof INCOME | typeof SPENDING | typeof FUND_CONTRIBUTION | typeof FUND_RELEASE;
  subcategoryId: number;
  amountCents: number;
}

export interface ClosePlan {
  moves: SavingsMove[];
  /** subcategoryId → carry-in for next month's fund line. */
  carries: Map<number, number>;
  outcomes: LineOutcome[];
}

/**
 * Pure close calculation. Savings changes by income − regular spending − fund contributions; each fund's balance
 * (limit + carry-in + deficit paid − spent) carries into next month's fund line, or is released to savings when there
 * is none. A regular line that still holds a carry-in or deficit payment (its subcategory was switched from a fund
 * this month) releases that money too, so nothing is lost.
 *
 * Invariant: savings + Σ fund balances changes by exactly income − all spending.
 */
export function planClose(
  lines: LineLike[],
  spent: Map<number, number>,
  income: Map<number, number>,
  nextFundLines: Set<number>,
): ClosePlan {
  const moves: SavingsMove[] = [];
  const carries = new Map<number, number>();
  const outcomes: LineOutcome[] = [];

  for (const [subcategoryId, amountCents] of income) {
    if (amountCents !== 0) moves.push({ kind: INCOME, subcategoryId, amountCents });
  }

  const lineBySub = new Map(lines.map((line) => [line.subcategoryId, line]));
  for (const [subcategoryId, amount] of spent) {
    if (amount !== 0 && !lineBySub.get(subcategoryId)?.fund) {
      moves.push({ kind: SPENDING, subcategoryId, amountCents: -amount });
    }
  }

  for (const line of lines) {
    const remainingCents = lineAvailable(line) - (spent.get(line.subcategoryId) ?? 0);
    if (!line.fund) {
      const held = line.carryInCents + line.deficitPaidCents;
      if (held !== 0) moves.push({ kind: FUND_RELEASE, subcategoryId: line.subcategoryId, amountCents: held });
      outcomes.push({ subcategoryId: line.subcategoryId, remainingCents, result: 'regular' });
      continue;
    }
    if (line.limitCents !== 0) {
      moves.push({ kind: FUND_CONTRIBUTION, subcategoryId: line.subcategoryId, amountCents: -line.limitCents });
    }
    if (nextFundLines.has(line.subcategoryId)) {
      carries.set(line.subcategoryId, remainingCents);
      outcomes.push({ subcategoryId: line.subcategoryId, remainingCents, result: 'carried' });
    } else {
      if (remainingCents !== 0) {
        moves.push({ kind: FUND_RELEASE, subcategoryId: line.subcategoryId, amountCents: remainingCents });
      }
      outcomes.push({ subcategoryId: line.subcategoryId, remainingCents, result: 'released' });
    }
  }

  return { moves, carries, outcomes };
}

/**
 * Month lifecycle rules: auto-copy, close (savings flow and fund carry-overs), reopen, and deficit payments.
 * Every public method runs inside a single database transaction.
 */
@Injectable()
export class BudgetLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns the budget month, creating it by copying the most recent earlier month if missing. */
  ensureMonth(month: string): Promise<void> {
    return this.prisma.$transaction((tx) => this.ensureMonthIn(tx, month));
  }

  async ensureMonthIn(db: Db, month: string): Promise<void> {
    const existing = await db.budgetMonth.findUnique({ where: { month } });
    if (existing) return;

    const source = await db.budgetMonth.findFirst({
      where: { month: { lt: month } },
      orderBy: { month: 'desc' },
      include: { lines: true },
    });
    const sourceLimits = new Map(source?.lines.map((line) => [line.subcategoryId, line.limitCents]) ?? []);

    const subcategories = await db.subcategory.findMany({
      where: { archivedAt: null, category: { archivedAt: null, kind: 'expense' } },
    });

    await db.budgetMonth.create({
      data: {
        month,
        status: 'open',
        plannedIncomeCents: source?.plannedIncomeCents ?? 0,
        lines: {
          create: subcategories.map((sub) => ({
            subcategoryId: sub.id,
            limitCents: sourceLimits.get(sub.id) ?? sub.defaultLimitCents,
            carryInCents: 0,
            fund: sub.fund,
          })),
        },
      },
    });
  }

  /** Throws 409 MONTH_CLOSED when the month exists and is closed. */
  async assertOpen(db: Db, month: string): Promise<void> {
    const row = await db.budgetMonth.findUnique({ where: { month }, select: { status: true } });
    if (row?.status === 'closed') throw monthClosed(month);
  }

  /** Transaction totals per subcategory for a month and type. */
  async totalsBySubcategory(db: Db, month: string, type: 'income' | 'expense'): Promise<Map<number, number>> {
    const { first, last } = monthBounds(month);
    const rows = await db.transaction.groupBy({
      by: ['subcategoryId'],
      where: { type, date: { gte: first, lte: last } },
      _sum: { amountCents: true },
    });
    return new Map(rows.map((row) => [row.subcategoryId, row._sum.amountCents ?? 0]));
  }

  /** Expense spending per subcategory for a month. */
  spentBySubcategory(db: Db, month: string): Promise<Map<number, number>> {
    return this.totalsBySubcategory(db, month, 'expense');
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

      const plan = planClose(
        current.lines,
        await this.totalsBySubcategory(tx, month, 'expense'),
        await this.totalsBySubcategory(tx, month, 'income'),
        new Set(nextMonth.lines.filter((line) => line.fund).map((line) => line.subcategoryId)),
      );

      const nextIds = new Map(nextMonth.lines.map((line) => [line.subcategoryId, line.id]));
      for (const [subcategoryId, carryInCents] of plan.carries) {
        if (carryInCents !== 0) {
          await tx.budgetLine.update({ where: { id: nextIds.get(subcategoryId)! }, data: { carryInCents } });
        }
      }
      if (plan.moves.length) {
        await tx.savingsEntry.createMany({
          data: plan.moves.map((move) => ({ ...move, month, createdAt: now })),
        });
      }

      await tx.budgetMonth.update({ where: { month }, data: { status: 'closed', closedAt: now } });
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
      await tx.budgetMonth.update({ where: { month }, data: { status: 'open', closedAt: null } });
    });
  }

  /**
   * Cover a fund's deficit (remaining < 0) from savings. Pays the whole deficit when savings allows, otherwise the
   * entire positive savings balance. Recorded on the line and as a negative savings entry.
   */
  payDeficit(month: string, lineId: number, now: Date = new Date()): Promise<DeficitPaymentResult> {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.budgetLine.findUnique({ where: { id: lineId }, include: { subcategory: true } });
      if (!line || line.month !== month) throw notFound(`Budget line ${lineId} not found in ${month}`);
      await this.assertOpen(tx, month);
      if (!line.fund) {
        throw conflict(`${line.subcategory.name} isn't a fund, so its spending already comes out of savings.`);
      }

      const spent = (await this.spentBySubcategory(tx, month)).get(line.subcategoryId) ?? 0;
      const deficit = spent - lineAvailable(line);
      if (deficit <= 0) throw conflict(`${line.subcategory.name} has no deficit to pay.`);

      const balance = await this.savingsBalance(tx);
      if (balance <= 0) throw conflict('There are no savings available to pay this deficit.');

      const paidCents = Math.min(deficit, balance);
      await tx.savingsEntry.create({
        data: {
          kind: DEFICIT_PAYMENT,
          month,
          subcategoryId: line.subcategoryId,
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

  /** Propagate a subcategory's fund flag to its lines in open months only. */
  async applyFundToOpenMonths(db: Db, subcategoryId: number, fund: boolean): Promise<void> {
    await db.budgetLine.updateMany({
      where: { subcategoryId, budgetMonth: { status: 'open' } },
      data: { fund },
    });
  }

  /** Give a newly active expense subcategory a line (at its default limit) in every open month. */
  async addLineToOpenMonths(db: Db, subcategoryId: number): Promise<void> {
    const sub = await db.subcategory.findUniqueOrThrow({ where: { id: subcategoryId }, include: { category: true } });
    if (sub.category.kind !== 'expense' || sub.archivedAt || sub.category.archivedAt) return;
    const openMonths = await db.budgetMonth.findMany({
      where: { status: 'open', lines: { none: { subcategoryId } } },
      select: { month: true },
    });
    for (const { month } of openMonths) {
      await db.budgetLine.create({
        data: { month, subcategoryId, limitCents: sub.defaultLimitCents, carryInCents: 0, fund: sub.fund },
      });
    }
  }
}
