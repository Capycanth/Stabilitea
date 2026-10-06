import { ConflictException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BudgetLifecycleService } from './budget-lifecycle.service.js';

describe('BudgetLifecycleService', () => {
  let testDb: TestDatabase;
  let prisma: PrismaService;
  let lifecycle: BudgetLifecycleService;
  let groceries: number;
  let dining: number;
  let rent: number;
  let salary: number;
  let foodId: number;

  beforeEach(async () => {
    testDb = createTestDatabase();
    process.env['DATABASE_URL'] = testDb.url;
    prisma = new PrismaService();
    await prisma.onModuleInit();
    lifecycle = new BudgetLifecycleService(prisma);

    const food = await prisma.category.create({
      data: {
        name: 'Food',
        kind: 'expense',
        rollover: true,
        sortOrder: 1,
        subcategories: {
          create: [
            { name: 'Groceries', defaultLimitCents: 50_000 },
            { name: 'Dining Out', defaultLimitCents: 20_000, sortOrder: 1 },
          ],
        },
      },
      include: { subcategories: true },
    });
    const housing = await prisma.category.create({
      data: {
        name: 'Housing',
        kind: 'expense',
        rollover: false,
        sortOrder: 2,
        subcategories: { create: [{ name: 'Rent', defaultLimitCents: 100_000 }] },
      },
      include: { subcategories: true },
    });
    const income = await prisma.category.create({
      data: { name: 'Income', kind: 'income', subcategories: { create: [{ name: 'Salary' }] } },
      include: { subcategories: true },
    });
    foodId = food.id;
    groceries = food.subcategories.find((s) => s.name === 'Groceries')!.id;
    dining = food.subcategories.find((s) => s.name === 'Dining Out')!.id;
    rent = housing.subcategories[0]!.id;
    salary = income.subcategories[0]!.id;
  });

  afterEach(async () => {
    await prisma.onModuleDestroy();
    testDb.cleanup();
  });

  const lines = async (month: string) =>
    new Map(
      (await prisma.budgetLine.findMany({ where: { month } })).map((line) => [line.subcategoryId, line]),
    );

  const spend = (date: string, subcategoryId: number, amountCents: number) =>
    prisma.transaction.create({ data: { date, type: 'expense', subcategoryId, amountCents } });

  describe('auto-copy', () => {
    it('uses default limits when no earlier month exists, for active expense subcategories only', async () => {
      await lifecycle.ensureMonth('2026-08');
      const month = await prisma.budgetMonth.findUniqueOrThrow({ where: { month: '2026-08' } });
      expect(month.status).toBe('open');
      expect(month.plannedIncomeCents).toBe(0);

      const byId = await lines('2026-08');
      expect([...byId.keys()].sort()).toEqual([groceries, dining, rent].sort());
      expect(byId.has(salary)).toBe(false);
      expect(byId.get(groceries)).toMatchObject({ limitCents: 50_000, carryInCents: 0, rollover: true });
      expect(byId.get(rent)).toMatchObject({ limitCents: 100_000, carryInCents: 0, rollover: false });
    });

    it('is idempotent', async () => {
      await lifecycle.ensureMonth('2026-08');
      await lifecycle.ensureMonth('2026-08');
      expect(await prisma.budgetLine.count({ where: { month: '2026-08' } })).toBe(3);
    });

    it('copies limits and planned income from the most recent earlier month', async () => {
      await lifecycle.ensureMonth('2026-06');
      await prisma.budgetMonth.update({ where: { month: '2026-06' }, data: { plannedIncomeCents: 400_000 } });
      await prisma.budgetLine.updateMany({ where: { month: '2026-06', subcategoryId: groceries }, data: { limitCents: 61_000 } });

      // Skips a gap: 2026-09 copies from 2026-06.
      await lifecycle.ensureMonth('2026-09');
      const month = await prisma.budgetMonth.findUniqueOrThrow({ where: { month: '2026-09' } });
      expect(month.plannedIncomeCents).toBe(400_000);
      expect((await lines('2026-09')).get(groceries)?.limitCents).toBe(61_000);
    });

    it('skips archived subcategories and adds active ones missing from the source', async () => {
      await lifecycle.ensureMonth('2026-08');
      await prisma.subcategory.update({ where: { id: dining }, data: { archivedAt: new Date() } });
      const fuel = await prisma.subcategory.create({ data: { categoryId: foodId, name: 'Snacks', defaultLimitCents: 3_000 } });

      await lifecycle.ensureMonth('2026-09');
      const byId = await lines('2026-09');
      expect(byId.has(dining)).toBe(false);
      expect(byId.get(fuel.id)?.limitCents).toBe(3_000);
    });

    it('snapshots the category rollover flag at creation time', async () => {
      await prisma.category.update({ where: { id: foodId }, data: { rollover: false } });
      await lifecycle.ensureMonth('2026-08');
      expect((await lines('2026-08')).get(groceries)?.rollover).toBe(false);
    });
  });

  describe('close', () => {
    it('carries positive leftovers forward for rollover lines', async () => {
      await spend('2026-08-03', groceries, 30_000);
      const outcomes = await lifecycle.close('2026-08');

      expect(outcomes.find((o) => o.subcategoryId === groceries)).toEqual({
        subcategoryId: groceries,
        leftoverCents: 20_000,
        result: 'carried',
      });
      expect((await lines('2026-09')).get(groceries)?.carryInCents).toBe(20_000);
      expect(await prisma.savingsEntry.count({ where: { subcategoryId: groceries } })).toBe(0);

      const closed = await prisma.budgetMonth.findUniqueOrThrow({ where: { month: '2026-08' } });
      expect(closed.status).toBe('closed');
      expect(closed.closedAt).toBeInstanceOf(Date);
    });

    it('sweeps positive leftovers to savings for non-rollover lines', async () => {
      await spend('2026-08-01', rent, 95_000);
      await lifecycle.close('2026-08');

      const entries = await prisma.savingsEntry.findMany({ where: { month: '2026-08' } });
      expect(entries).toEqual([expect.objectContaining({ subcategoryId: rent, amountCents: 5_000 })]);
      expect((await lines('2026-09')).get(rent)?.carryInCents).toBe(0);
    });

    it('carries a deficit forward for rollover lines, even when negative', async () => {
      await spend('2026-08-10', groceries, 50_000); // exactly spent
      await spend('2026-08-11', dining, 25_000); // overspent by 5_000
      const outcomes = await lifecycle.close('2026-08');

      expect(outcomes.find((o) => o.subcategoryId === groceries)).toMatchObject({ leftoverCents: 0, result: 'none' });
      expect(outcomes.find((o) => o.subcategoryId === dining)).toMatchObject({ leftoverCents: -5_000, result: 'carried' });
      const next = await lines('2026-09');
      expect(next.get(groceries)?.carryInCents).toBe(0);
      expect(next.get(dining)?.carryInCents).toBe(-5_000);
      expect(await prisma.savingsEntry.count({ where: { subcategoryId: { in: [groceries, dining] } } })).toBe(0);
    });

    it('adds this month\'s limit to a negative carry-in, and keeps carrying the result', async () => {
      await spend('2026-08-11', dining, 45_000); // 20_000 limit → -25_000
      await lifecycle.close('2026-08');
      // September budget: 20_000 + (-25_000) = -5_000; spend 1_000 more → -6_000
      await spend('2026-09-02', dining, 1_000);
      const outcomes = await lifecycle.close('2026-09');
      expect(outcomes.find((o) => o.subcategoryId === dining)?.leftoverCents).toBe(-6_000);
      // October budget: 20_000 - 6_000 = 14_000 with nothing spent → +14_000 carries to November
      await lifecycle.close('2026-10');
      expect((await lines('2026-11')).get(dining)?.carryInCents).toBe(14_000);
    });

    it('resets overspending for non-rollover lines', async () => {
      await spend('2026-08-12', rent, 120_000);
      const outcomes = await lifecycle.close('2026-08');
      expect(outcomes.find((o) => o.subcategoryId === rent)).toMatchObject({ leftoverCents: -20_000, result: 'none' });
      expect((await lines('2026-09')).get(rent)?.carryInCents).toBe(0);
      expect(await prisma.savingsEntry.count({ where: { subcategoryId: rent } })).toBe(0);
    });

    it('drops a deficit when the next month has no matching line', async () => {
      await lifecycle.ensureMonth('2026-08');
      await spend('2026-08-11', dining, 30_000);
      await prisma.subcategory.update({ where: { id: dining }, data: { archivedAt: new Date() } });
      const outcomes = await lifecycle.close('2026-08');
      expect(outcomes.find((o) => o.subcategoryId === dining)).toMatchObject({ leftoverCents: -10_000, result: 'none' });
      expect(await prisma.savingsEntry.count({ where: { subcategoryId: dining } })).toBe(0);
    });

    it('includes carry-in when computing the leftover', async () => {
      await lifecycle.close('2026-08'); // groceries carries 50_000 into September
      await spend('2026-09-05', groceries, 70_000);
      await lifecycle.close('2026-09');
      // 50_000 limit + 50_000 carry-in - 70_000 spent
      expect((await lines('2026-10')).get(groceries)?.carryInCents).toBe(30_000);
    });

    it('auto-creates the next month so carry-ins have a line to land on', async () => {
      expect(await prisma.budgetMonth.findUnique({ where: { month: '2026-09' } })).toBeNull();
      await lifecycle.close('2026-08');
      expect(await prisma.budgetMonth.findUnique({ where: { month: '2026-09' } })).not.toBeNull();
    });

    it('sends a rollover leftover to savings when the next month has no matching line', async () => {
      await lifecycle.ensureMonth('2026-08');
      await prisma.subcategory.update({ where: { id: dining }, data: { archivedAt: new Date() } });
      await lifecycle.close('2026-08');

      expect((await lines('2026-09')).has(dining)).toBe(false);
      const entries = await prisma.savingsEntry.findMany({ where: { subcategoryId: dining } });
      expect(entries.map((e) => e.amountCents)).toEqual([20_000]);
    });

    it('ignores income and other months when computing spending', async () => {
      await prisma.transaction.create({ data: { date: '2026-08-15', type: 'income', subcategoryId: salary, amountCents: 999_999 } });
      await spend('2026-07-31', groceries, 10_000);
      await spend('2026-09-01', groceries, 10_000);
      const outcomes = await lifecycle.close('2026-08');
      expect(outcomes.find((o) => o.subcategoryId === groceries)?.leftoverCents).toBe(50_000);
    });

    it('refuses to close an already closed month', async () => {
      await lifecycle.close('2026-08');
      await expect(lifecycle.close('2026-08')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to close when the next month is closed, and leaves data untouched', async () => {
      await lifecycle.ensureMonth('2026-08');
      await lifecycle.close('2026-09');
      await expect(lifecycle.close('2026-08')).rejects.toBeInstanceOf(ConflictException);
      const august = await prisma.budgetMonth.findUniqueOrThrow({ where: { month: '2026-08' } });
      expect(august.status).toBe('open');
    });

    it('is atomic: a failure rolls back every change', async () => {
      await spend('2026-08-01', rent, 10_000);
      await lifecycle.ensureMonth('2026-09');
      await prisma.budgetMonth.update({ where: { month: '2026-09' }, data: { status: 'closed' } });
      await expect(lifecycle.close('2026-08')).rejects.toThrow();
      expect(await prisma.savingsEntry.count()).toBe(0);
    });
  });

  describe('reopen', () => {
    it('deletes the month savings entries, resets next month carry-ins, and reopens', async () => {
      await spend('2026-08-01', rent, 90_000);
      await lifecycle.close('2026-08');
      expect(await prisma.savingsEntry.count()).toBeGreaterThan(0);
      expect((await lines('2026-09')).get(groceries)?.carryInCents).toBe(50_000);

      await lifecycle.reopen('2026-08');

      expect(await prisma.savingsEntry.count({ where: { month: '2026-08' } })).toBe(0);
      const next = await lines('2026-09');
      expect([...next.values()].every((line) => line.carryInCents === 0)).toBe(true);
      const august = await prisma.budgetMonth.findUniqueOrThrow({ where: { month: '2026-08' } });
      expect(august).toMatchObject({ status: 'open', closedAt: null });
    });

    it('recomputes correctly when closed again after corrections', async () => {
      await lifecycle.close('2026-08');
      await lifecycle.reopen('2026-08');
      await spend('2026-08-20', groceries, 45_000);
      await lifecycle.close('2026-08');
      expect((await lines('2026-09')).get(groceries)?.carryInCents).toBe(5_000);
    });

    it('requires the following month to be open (reopen newest-first)', async () => {
      await lifecycle.close('2026-08');
      await lifecycle.close('2026-09');
      await expect(lifecycle.reopen('2026-08')).rejects.toBeInstanceOf(ConflictException);

      await lifecycle.reopen('2026-09');
      await expect(lifecycle.reopen('2026-08')).resolves.toBeUndefined();
    });

    it('refuses to reopen a month that is not closed', async () => {
      await lifecycle.ensureMonth('2026-08');
      await expect(lifecycle.reopen('2026-08')).rejects.toBeInstanceOf(ConflictException);
      await expect(lifecycle.reopen('2030-01')).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not touch savings entries from other months', async () => {
      await lifecycle.close('2026-08');
      await lifecycle.close('2026-09');
      const septemberEntries = await prisma.savingsEntry.count({ where: { month: '2026-09' } });
      await lifecycle.reopen('2026-09');
      expect(await prisma.savingsEntry.count({ where: { month: '2026-09' } })).toBe(0);
      expect(await prisma.savingsEntry.count({ where: { month: '2026-08' } })).toBeGreaterThan(0);
      expect(septemberEntries).toBeGreaterThan(0);
    });
  });

  describe('deficit payments', () => {
    const lineFor = async (month: string, subcategoryId: number) => (await lines(month)).get(subcategoryId)!;
    const balance = () => lifecycle.savingsBalance(prisma);

    /** August: rent under by 30_000 → swept to savings. Dining over by 10_000 → carries -10_000. */
    async function withSavingsAndDeficit() {
      await spend('2026-08-01', rent, 70_000);
      await spend('2026-08-02', dining, 30_000);
      await spend('2026-08-03', groceries, 50_000);
      await lifecycle.close('2026-08');
      // Personal-free fixture: savings = 30_000 (rent). September dining: 20_000 - 10_000 = 10_000 available.
      await spend('2026-09-04', dining, 16_000); // remaining -6_000
    }

    it('zeros a rollover line\'s current deficit from savings and records it on the line', async () => {
      await withSavingsAndDeficit();
      expect(await balance()).toBe(30_000);
      const line = await lineFor('2026-09', dining);

      const result = await lifecycle.payDeficit('2026-09', line.id, new Date('2026-09-05T12:00:00Z'));

      expect(result).toEqual({ paidCents: 6_000, remainingDeficitCents: 0 });
      expect((await lineFor('2026-09', dining)).deficitPaidCents).toBe(6_000);
      expect(await balance()).toBe(24_000);
      const entry = await prisma.savingsEntry.findFirstOrThrow({ where: { kind: 'deficit_payment' } });
      expect(entry).toMatchObject({ month: '2026-09', subcategoryId: dining, budgetLineId: line.id, amountCents: -6_000 });
    });

    it('pays only what savings holds and leaves the rest as debt', async () => {
      await withSavingsAndDeficit();
      await spend('2026-09-06', dining, 40_000); // remaining -46_000
      const line = await lineFor('2026-09', dining);

      expect(await lifecycle.payDeficit('2026-09', line.id)).toEqual({ paidCents: 30_000, remainingDeficitCents: 16_000 });
      expect(await balance()).toBe(0);
      await expect(lifecycle.payDeficit('2026-09', line.id)).rejects.toThrow(/no savings/i);
    });

    it('carries only the unpaid part of the deficit when the month closes', async () => {
      await withSavingsAndDeficit();
      await spend('2026-09-06', dining, 40_000); // remaining -46_000; pay 30_000
      await lifecycle.payDeficit('2026-09', (await lineFor('2026-09', dining)).id);
      await lifecycle.close('2026-09');
      expect((await lineFor('2026-10', dining)).carryInCents).toBe(-16_000);
    });

    it('rejects lines without a deficit, non-rollover lines, and closed months', async () => {
      await withSavingsAndDeficit();
      await expect(lifecycle.payDeficit('2026-09', (await lineFor('2026-09', groceries)).id)).rejects.toThrow(/no deficit/);

      await spend('2026-09-07', rent, 200_000);
      await expect(lifecycle.payDeficit('2026-09', (await lineFor('2026-09', rent)).id)).rejects.toThrow(/doesn't roll over/);

      await lifecycle.close('2026-09');
      await expect(lifecycle.payDeficit('2026-09', (await lineFor('2026-09', dining)).id)).rejects.toMatchObject({
        response: { code: 'MONTH_CLOSED' },
      });
      await expect(lifecycle.payDeficit('2026-10', (await lineFor('2026-09', dining)).id)).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      });
    });

    it('can be undone while the month is open', async () => {
      await withSavingsAndDeficit();
      const line = await lineFor('2026-09', dining);
      await lifecycle.payDeficit('2026-09', line.id);
      const entry = await prisma.savingsEntry.findFirstOrThrow({ where: { kind: 'deficit_payment' } });

      await lifecycle.undoDeficitPayment('2026-09', entry.id);

      expect((await lineFor('2026-09', dining)).deficitPaidCents).toBe(0);
      expect(await balance()).toBe(30_000);
      await expect(lifecycle.undoDeficitPayment('2026-09', entry.id)).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    });

    it('keeps deficit payments when their month is reopened', async () => {
      await withSavingsAndDeficit();
      await lifecycle.payDeficit('2026-09', (await lineFor('2026-09', dining)).id);
      await lifecycle.close('2026-09');
      await lifecycle.reopen('2026-09');
      expect(await prisma.savingsEntry.count({ where: { month: '2026-09', kind: 'deficit_payment' } })).toBe(1);
      expect((await lineFor('2026-09', dining)).deficitPaidCents).toBe(6_000);
    });

    it('blocks reopening a month whose sweeps were already spent on deficits', async () => {
      await withSavingsAndDeficit();
      await spend('2026-09-06', dining, 40_000);
      await lifecycle.payDeficit('2026-09', (await lineFor('2026-09', dining)).id); // uses all 30_000 of August's sweep

      await expect(lifecycle.reopen('2026-08')).rejects.toThrow(/Undo those deficit payments first/);
      expect((await prisma.budgetMonth.findUniqueOrThrow({ where: { month: '2026-08' } })).status).toBe('closed');
      expect(await balance()).toBe(0);
    });
  });

  describe('other rules', () => {
    it('applies a rollover change to open months only', async () => {
      await lifecycle.close('2026-08');
      await prisma.$transaction((tx) => lifecycle.applyRolloverToOpenMonths(tx, foodId, false));

      expect((await lines('2026-08')).get(groceries)?.rollover).toBe(true);
      expect((await lines('2026-09')).get(groceries)?.rollover).toBe(false);
    });

    it('adds a line for a new subcategory to every open month', async () => {
      await lifecycle.close('2026-08');
      await lifecycle.ensureMonth('2026-10');
      const snacks = await prisma.subcategory.create({ data: { categoryId: foodId, name: 'Snacks', defaultLimitCents: 2_500 } });
      await prisma.$transaction((tx) => lifecycle.addLineToOpenMonths(tx, snacks.id));

      expect((await lines('2026-08')).has(snacks.id)).toBe(false);
      expect((await lines('2026-09')).get(snacks.id)?.limitCents).toBe(2_500);
      expect((await lines('2026-10')).get(snacks.id)?.rollover).toBe(true);
    });

    it('assertOpen rejects closed months with MONTH_CLOSED', async () => {
      await lifecycle.close('2026-08');
      await expect(lifecycle.assertOpen(prisma, '2026-08')).rejects.toMatchObject({
        response: { code: 'MONTH_CLOSED', statusCode: 409 },
      });
      await expect(lifecycle.assertOpen(prisma, '2026-09')).resolves.toBeUndefined();
      await expect(lifecycle.assertOpen(prisma, '2031-01')).resolves.toBeUndefined();
    });
  });
});
