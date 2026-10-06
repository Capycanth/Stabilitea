import { Injectable } from '@nestjs/common';
import { addMonths, formatCents, monthBounds, monthLabel } from '@stabilitea/shared';
import { conflict, monthClosed, notFound } from '../common/errors.js';
import { type Db, PrismaService } from '../prisma/prisma.service.js';

export interface LeftoverOutcome {
  subcategoryId: number;
  leftoverCents: number;
  /** carried: rolled into next month (positive or negative); swept: moved to savings; none: dropped. */
  result: 'carried' | 'swept' | 'none';
}

export interface DeficitPaymentResult {
  paidCents: number;
  /** Deficit still left on the line after the payment (0 when fully covered). */
  remainingDeficitCents: number;
}

export const SWEEP = 'sweep';
export const DEFICIT_PAYMENT = 'deficit_payment';

/** This month's budget for a line: limit + carry-in (may be negative) + deficit paid from savings. */
export function lineAvailable(line: { limitCents: number; carryInCents: number; deficitPaidCents: number }): number {
  return line.limitCents + line.carryInCents + line.deficitPaidCents;
}

/**
 * Month lifecycle rules: auto-copy, close (rollovers and savings sweeps), and reopen.
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
      include: { category: true },
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
            rollover: sub.category.rollover,
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

  /** Expense spending per subcategory for a month. */
  async spentBySubcategory(db: Db, month: string): Promise<Map<number, number>> {
    const { first, last } = monthBounds(month);
    const rows = await db.transaction.groupBy({
      by: ['subcategoryId'],
      where: { type: 'expense', date: { gte: first, lte: last } },
      _sum: { amountCents: true },
    });
    return new Map(rows.map((row) => [row.subcategoryId, row._sum.amountCents ?? 0]));
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

  /**
   * Close a month. For each line, leftover = limit + carryIn + deficitPaid - spent:
   *  - rollover with a matching next line → next month's carryIn = leftover, even when negative
   *  - leftover > 0 otherwise (no rollover, or no matching next line) → swept to savings
   *  - leftover ≤ 0 otherwise → nothing carries
   */
  close(month: string, now: Date = new Date()): Promise<LeftoverOutcome[]> {
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
      const nextLines = new Map(nextMonth.lines.map((line) => [line.subcategoryId, line]));

      // Carry-ins are owned by this close; start from a clean slate.
      await tx.budgetLine.updateMany({ where: { month: next }, data: { carryInCents: 0 } });

      const spent = await this.spentBySubcategory(tx, month);
      const outcomes: LeftoverOutcome[] = [];

      for (const line of current.lines) {
        const leftoverCents = lineAvailable(line) - (spent.get(line.subcategoryId) ?? 0);
        const nextLine = nextLines.get(line.subcategoryId);
        if (line.rollover && nextLine) {
          if (leftoverCents !== 0) {
            await tx.budgetLine.update({ where: { id: nextLine.id }, data: { carryInCents: leftoverCents } });
          }
          outcomes.push({ subcategoryId: line.subcategoryId, leftoverCents, result: leftoverCents === 0 ? 'none' : 'carried' });
        } else if (leftoverCents > 0) {
          await tx.savingsEntry.create({
            data: { kind: SWEEP, month, subcategoryId: line.subcategoryId, amountCents: leftoverCents, createdAt: now },
          });
          outcomes.push({ subcategoryId: line.subcategoryId, leftoverCents, result: 'swept' });
        } else {
          outcomes.push({ subcategoryId: line.subcategoryId, leftoverCents, result: 'none' });
        }
      }

      await tx.budgetMonth.update({ where: { month }, data: { status: 'closed', closedAt: now } });
      return outcomes;
    });
  }

  /**
   * Reverse a close. Allowed only while the following month is open, and only when removing the
   * month's sweeps would not leave savings below zero (deficit payments may have already used them).
   * Deficit payments recorded on the month stay in place.
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

      const { _sum } = await tx.savingsEntry.aggregate({ where: { month, kind: SWEEP }, _sum: { amountCents: true } });
      const swept = _sum.amountCents ?? 0;
      const balance = await this.savingsBalance(tx);
      if (balance - swept < 0) {
        throw conflict(
          `Reopening ${monthLabel(month)} would remove ${formatCents(swept)} of savings, but ${formatCents(swept - balance)} of it has already paid deficits. Undo those deficit payments first.`,
        );
      }

      await tx.savingsEntry.deleteMany({ where: { month, kind: SWEEP } });
      if (nextMonth) {
        await tx.budgetLine.updateMany({ where: { month: next }, data: { carryInCents: 0 } });
      }
      await tx.budgetMonth.update({ where: { month }, data: { status: 'open', closedAt: null } });
    });
  }

  /**
   * Cover a rollover line's deficit (remaining < 0) from savings. Pays the whole deficit when savings
   * allows, otherwise the entire savings balance. Recorded on the line and as a negative savings entry.
   */
  payDeficit(month: string, lineId: number, now: Date = new Date()): Promise<DeficitPaymentResult> {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.budgetLine.findUnique({ where: { id: lineId }, include: { subcategory: true } });
      if (!line || line.month !== month) throw notFound(`Budget line ${lineId} not found in ${month}`);
      await this.assertOpen(tx, month);
      if (!line.rollover) {
        throw conflict(`${line.subcategory.name} doesn't roll over, so its deficit resets when the month closes.`);
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

  /** Propagate a category's rollover flag to lines in open months only. */
  async applyRolloverToOpenMonths(db: Db, categoryId: number, rollover: boolean): Promise<void> {
    await db.budgetLine.updateMany({
      where: { subcategory: { categoryId }, budgetMonth: { status: 'open' } },
      data: { rollover },
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
        data: { month, subcategoryId, limitCents: sub.defaultLimitCents, carryInCents: 0, rollover: sub.category.rollover },
      });
    }
  }
}
