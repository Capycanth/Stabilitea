import { ConflictException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BudgetLifecycleService, planClose } from './budget-lifecycle.service.js';

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

    const food = await prisma.group.create({
      data: {
        name: 'Food',
        kind: 'expense',
        sortOrder: 1,
        categories: {
          create: [
            { name: 'Groceries', defaultLimitCents: 50_000, type: 'fund' },
            { name: 'Dining Out', defaultLimitCents: 20_000, type: 'fund', sortOrder: 1 },
          ],
        },
      },
      include: { categories: true },
    });
    const housing = await prisma.group.create({
      data: {
        name: 'Housing',
        kind: 'expense',
        sortOrder: 2,
        categories: { create: [{ name: 'Rent', defaultLimitCents: 100_000 }] },
      },
      include: { categories: true },
    });
    const income = await prisma.group.create({
      data: { name: 'Income', kind: 'income', categories: { create: [{ name: 'Salary' }] } },
      include: { categories: true },
    });
    foodId = food.id;
    groceries = food.categories.find((s) => s.name === 'Groceries')!.id;
    dining = food.categories.find((s) => s.name === 'Dining Out')!.id;
    rent = housing.categories[0]!.id;
    salary = income.categories[0]!.id;
  });

  afterEach(async () => {
    await prisma.onModuleDestroy();
    testDb.cleanup();
  });

  const lines = async (month: string) =>
    new Map(
      (await prisma.budgetLine.findMany({ where: { month } })).map((line) => [line.categoryId, line]),
    );

  const spend = (date: string, categoryId: number, amountCents: number) =>
    prisma.transaction.create({ data: { date, type: 'expense', categoryId, amountCents } });

  const earn = (date: string, amountCents: number) =>
    prisma.transaction.create({ data: { date, type: 'income', categoryId: salary, amountCents } });

  const balance = () => lifecycle.savingsBalance(prisma);

  const entries = async (month: string) =>
    (await prisma.savingsEntry.findMany({ where: { month }, orderBy: { id: 'asc' } })).map((e) => ({
      kind: e.kind,
      categoryId: e.categoryId,
      amountCents: e.amountCents,
    }));

  /** Savings plus every fund balance carried into `month` (plus deficits paid there). */
  const totalHeld = async (month: string) =>
    (await balance()) +
    [...(await lines(month)).values()].filter((l) => l.type !== 'standard').reduce((sum, l) => sum + l.carryInCents + l.deficitPaidCents, 0);

  describe('planClose', () => {
    const line = (categoryId: number, fund: boolean | 'recurring', limitCents: number, carryInCents = 0, deficitPaidCents = 0) => ({
      categoryId,
      type: fund === 'recurring' ? 'recurring' : fund ? 'fund' : 'standard',
      limitCents,
      carryInCents,
      deficitPaidCents,
    });

    it('moves income in, regular spending out, fund limits out, and carries fund balances', () => {
      const plan = planClose(
        [line(1, false, 100_000), line(2, true, 20_000, -5_000)],
        new Map([[1, 90_000], [2, 25_000]]),
        new Map([[9, 300_000]]),
        new Map([[2, 'fund']]),
      );
      expect(plan.moves).toEqual([
        { kind: 'income', categoryId: 9, amountCents: 300_000 },
        { kind: 'spending', categoryId: 1, amountCents: -90_000 },
        { kind: 'fund_contribution', categoryId: 2, amountCents: -20_000 },
      ]);
      expect([...plan.carries]).toEqual([[2, -10_000]]);
      expect(plan.outcomes).toEqual([
        { categoryId: 1, remainingCents: 10_000, result: 'regular' },
        { categoryId: 2, remainingCents: -10_000, result: 'carried' },
      ]);
    });

    it('releases a fund balance when next month has no fund line for it', () => {
      const plan = planClose([line(2, true, 20_000, 3_000)], new Map(), new Map(), new Map());
      expect(plan.moves).toContainEqual({ kind: 'fund_release', categoryId: 2, amountCents: 23_000 });
      expect(plan.carries.size).toBe(0);
      expect(plan.outcomes[0]).toMatchObject({ result: 'released', remainingCents: 23_000 });
    });

    it('releases money still held on a line that was switched from fund to regular', () => {
      const plan = planClose([line(1, false, 10_000, -4_000, 1_000)], new Map([[1, 2_000]]), new Map(), new Map());
      expect(plan.moves).toEqual([
        { kind: 'spending', categoryId: 1, amountCents: -2_000 },
        { kind: 'fund_release', categoryId: 1, amountCents: -3_000 },
      ]);
    });

    it('stores a recurring share and carries the stored money while the bill is unpaid', () => {
      const plan = planClose([line(3, 'recurring', 5_000, 10_000)], new Map(), new Map(), new Map([[3, 'recurring']]));
      expect(plan.moves).toEqual([{ kind: 'recurring_store', categoryId: 3, amountCents: -5_000 }]);
      expect([...plan.carries]).toEqual([[3, 15_000]]);
      expect(plan.settled.size).toBe(0);
      expect(plan.outcomes[0]).toMatchObject({ result: 'stored', remainingCents: 15_000 });
    });

    it('pays a recurring bill from the stored money and settles the leftover with savings', () => {
      const plan = planClose([line(3, 'recurring', 5_000, 15_000)], new Map([[3, 19_500]]), new Map(), new Map([[3, 'recurring']]));
      expect(plan.moves).toEqual([
        { kind: 'recurring_store', categoryId: 3, amountCents: -5_000 },
        { kind: 'recurring_release', categoryId: 3, amountCents: 500 },
      ]);
      expect(plan.carries.size).toBe(0);
      expect([...plan.settled]).toEqual([3]);
      expect(plan.outcomes[0]).toMatchObject({ result: 'settled', remainingCents: 500 });
    });

    it('takes a recurring shortfall out of savings', () => {
      const plan = planClose([line(3, 'recurring', 5_000, 15_000)], new Map([[3, 21_000]]), new Map(), new Map());
      expect(plan.moves).toContainEqual({ kind: 'recurring_release', categoryId: 3, amountCents: -1_000 });
      expect(plan.moves.some((m) => m.kind === 'spending')).toBe(false);
    });

    it('releases stored money when the category stops being recurring', () => {
      const unpaid = planClose([line(3, 'recurring', 5_000, 10_000)], new Map(), new Map(), new Map([[3, 'standard']]));
      expect(unpaid.moves).toContainEqual({ kind: 'recurring_release', categoryId: 3, amountCents: 15_000 });
      expect(unpaid.outcomes[0]).toMatchObject({ result: 'released' });

      const switched = planClose([line(3, false, 5_000, 10_000)], new Map(), new Map(), new Map(), new Map([[3, 'recurring']]));
      expect(switched.moves).toEqual([{ kind: 'recurring_release', categoryId: 3, amountCents: 10_000 }]);
    });

    it('counts spending without a budget line as regular spending', () => {
      const plan = planClose([], new Map([[7, 1_234]]), new Map(), new Map());
      expect(plan.moves).toEqual([{ kind: 'spending', categoryId: 7, amountCents: -1_234 }]);
    });
  });

  describe('auto-copy', () => {
    it('uses default limits when no earlier month exists, for active expense categories only', async () => {
      await lifecycle.ensureMonth('2026-08');
      const month = await prisma.budgetMonth.findUniqueOrThrow({ where: { month: '2026-08' } });
      expect(month.status).toBe('open');
      expect(month.plannedIncomeCents).toBe(0);

      const byId = await lines('2026-08');
      expect([...byId.keys()].sort()).toEqual([groceries, dining, rent].sort());
      expect(byId.has(salary)).toBe(false);
      expect(byId.get(groceries)).toMatchObject({ limitCents: 50_000, carryInCents: 0, type: 'fund' });
      expect(byId.get(rent)).toMatchObject({ limitCents: 100_000, carryInCents: 0, type: 'standard' });
    });

    it('is idempotent', async () => {
      await lifecycle.ensureMonth('2026-08');
      await lifecycle.ensureMonth('2026-08');
      expect(await prisma.budgetLine.count({ where: { month: '2026-08' } })).toBe(3);
    });

    it('copies limits and planned income from the most recent earlier month', async () => {
      await lifecycle.ensureMonth('2026-06');
      await prisma.budgetMonth.update({ where: { month: '2026-06' }, data: { plannedIncomeCents: 400_000 } });
      await prisma.budgetLine.updateMany({ where: { month: '2026-06', categoryId: groceries }, data: { limitCents: 61_000 } });

      // Skips a gap: 2026-09 copies from 2026-06.
      await lifecycle.ensureMonth('2026-09');
      const month = await prisma.budgetMonth.findUniqueOrThrow({ where: { month: '2026-09' } });
      expect(month.plannedIncomeCents).toBe(400_000);
      expect((await lines('2026-09')).get(groceries)?.limitCents).toBe(61_000);
    });

    it('skips archived categories and adds active ones missing from the source', async () => {
      await lifecycle.ensureMonth('2026-08');
      await prisma.category.update({ where: { id: dining }, data: { archivedAt: new Date() } });
      const snacks = await prisma.category.create({ data: { groupId: foodId, name: 'Snacks', defaultLimitCents: 3_000 } });

      await lifecycle.ensureMonth('2026-09');
      const byId = await lines('2026-09');
      expect(byId.has(dining)).toBe(false);
      expect(byId.get(snacks.id)).toMatchObject({ limitCents: 3_000, type: 'standard' });
    });

    it('snapshots the category type at creation time', async () => {
      await prisma.category.update({ where: { id: groceries }, data: { type: 'standard' } });
      await lifecycle.ensureMonth('2026-08');
      expect((await lines('2026-08')).get(groceries)?.type).toBe('standard');
    });
  });

  describe('close', () => {
    it('adds income to savings and takes regular spending out of it', async () => {
      await earn('2026-08-01', 400_000);
      await spend('2026-08-02', rent, 95_000);
      await lifecycle.close('2026-08');

      expect(await entries('2026-08')).toEqual([
        { kind: 'income', categoryId: salary, amountCents: 400_000 },
        { kind: 'spending', categoryId: rent, amountCents: -95_000 },
        { kind: 'fund_contribution', categoryId: groceries, amountCents: -50_000 },
        { kind: 'fund_contribution', categoryId: dining, amountCents: -20_000 },
      ]);
      // 400_000 − 95_000 − 70_000 into funds
      expect(await balance()).toBe(235_000);
      const closed = await prisma.budgetMonth.findUniqueOrThrow({ where: { month: '2026-08' } });
      expect(closed).toMatchObject({ status: 'closed' });
      expect(closed.closedAt).toBeInstanceOf(Date);
    });

    it('lets regular overspending reduce savings, and underspending leave more in it', async () => {
      await earn('2026-08-01', 200_000);
      await spend('2026-08-02', rent, 120_000); // 20_000 over its 100_000 target
      const outcomes = await lifecycle.close('2026-08');

      expect(outcomes.find((o) => o.categoryId === rent)).toEqual({ categoryId: rent, remainingCents: -20_000, result: 'regular' });
      expect(await balance()).toBe(200_000 - 120_000 - 70_000);
      expect((await lines('2026-09')).get(rent)?.carryInCents).toBe(0);
    });

    it('lets savings go negative', async () => {
      await spend('2026-08-02', rent, 10_000);
      await lifecycle.close('2026-08');
      expect(await balance()).toBe(-10_000 - 70_000);
    });

    it('carries a fund balance forward, positive or negative', async () => {
      await spend('2026-08-10', groceries, 30_000); // 50_000 → +20_000
      await spend('2026-08-11', dining, 25_000); // 20_000 → -5_000
      const outcomes = await lifecycle.close('2026-08');

      expect(outcomes.find((o) => o.categoryId === groceries)).toMatchObject({ remainingCents: 20_000, result: 'carried' });
      expect(outcomes.find((o) => o.categoryId === dining)).toMatchObject({ remainingCents: -5_000, result: 'carried' });
      const next = await lines('2026-09');
      expect(next.get(groceries)?.carryInCents).toBe(20_000);
      expect(next.get(dining)?.carryInCents).toBe(-5_000);
      // Fund spending never touches savings directly; only the contributions do.
      expect((await entries('2026-08')).filter((e) => e.kind === 'spending')).toEqual([]);
    });

    it("adds each month's contribution to the fund balance", async () => {
      await spend('2026-08-11', dining, 45_000); // 20_000 → -25_000
      await lifecycle.close('2026-08');
      await spend('2026-09-02', dining, 1_000); // 20_000 − 25_000 − 1_000 → -6_000
      const outcomes = await lifecycle.close('2026-09');
      expect(outcomes.find((o) => o.categoryId === dining)?.remainingCents).toBe(-6_000);
      await lifecycle.close('2026-10'); // 20_000 − 6_000 → 14_000
      expect((await lines('2026-11')).get(dining)?.carryInCents).toBe(14_000);
    });

    it('releases a fund balance to savings when the next month has no fund line for it', async () => {
      await lifecycle.ensureMonth('2026-08');
      await spend('2026-08-11', dining, 30_000); // -10_000
      await prisma.category.update({ where: { id: dining }, data: { archivedAt: new Date() } });
      const outcomes = await lifecycle.close('2026-08');

      expect((await lines('2026-09')).has(dining)).toBe(false);
      expect(outcomes.find((o) => o.categoryId === dining)).toMatchObject({ remainingCents: -10_000, result: 'released' });
      expect((await entries('2026-08')).filter((e) => e.categoryId === dining)).toEqual([
        { kind: 'fund_contribution', categoryId: dining, amountCents: -20_000 },
        { kind: 'fund_release', categoryId: dining, amountCents: -10_000 },
      ]);
    });

    it('releases a fund balance when the category becomes regular', async () => {
      await lifecycle.close('2026-08'); // groceries carries 50_000 into September
      await prisma.$transaction((tx) => lifecycle.applyTypeToOpenMonths(tx, groceries, 'standard', 50_000));
      await spend('2026-09-03', groceries, 10_000);
      await lifecycle.close('2026-09');

      expect((await entries('2026-09')).filter((e) => e.categoryId === groceries)).toEqual([
        { kind: 'spending', categoryId: groceries, amountCents: -10_000 },
        { kind: 'fund_release', categoryId: groceries, amountCents: 50_000 },
      ]);
      expect((await lines('2026-10')).get(groceries)?.carryInCents).toBe(0);
    });

    it('keeps savings + fund balances equal to total income − total spending', async () => {
      await earn('2026-08-01', 300_000);
      await spend('2026-08-02', rent, 100_000);
      await spend('2026-08-03', groceries, 65_000);
      await spend('2026-08-04', dining, 5_000);
      await lifecycle.close('2026-08');
      expect(await totalHeld('2026-09')).toBe(300_000 - 170_000);

      await earn('2026-09-01', 310_000);
      await spend('2026-09-02', rent, 100_000);
      await spend('2026-09-03', dining, 60_000);
      await lifecycle.payDeficit('2026-09', (await lines('2026-09')).get(dining)!.id);
      await lifecycle.close('2026-09');
      expect(await totalHeld('2026-10')).toBe(300_000 - 170_000 + 310_000 - 160_000);
    });

    it('auto-creates the next month so carry-ins have a line to land on', async () => {
      expect(await prisma.budgetMonth.findUnique({ where: { month: '2026-09' } })).toBeNull();
      await lifecycle.close('2026-08');
      expect(await prisma.budgetMonth.findUnique({ where: { month: '2026-09' } })).not.toBeNull();
    });

    it('only counts transactions dated in the month', async () => {
      await earn('2026-07-31', 999_999);
      await spend('2026-07-31', groceries, 10_000);
      await spend('2026-09-01', groceries, 10_000);
      const outcomes = await lifecycle.close('2026-08');
      expect(outcomes.find((o) => o.categoryId === groceries)?.remainingCents).toBe(50_000);
      expect((await entries('2026-08')).some((e) => e.kind === 'income')).toBe(false);
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
    it("deletes the month's close entries, resets next month's carry-ins, and reopens", async () => {
      await earn('2026-08-01', 100_000);
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

    it('is allowed even when savings would go negative', async () => {
      await earn('2026-08-01', 100_000);
      await lifecycle.close('2026-08');
      await spend('2026-09-02', dining, 100_000);
      await lifecycle.payDeficit('2026-09', (await lines('2026-09')).get(dining)!.id); // uses all 30_000
      await expect(lifecycle.reopen('2026-08')).resolves.toBeUndefined();
      expect(await balance()).toBe(-30_000);
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
    const lineFor = async (month: string, categoryId: number) => (await lines(month)).get(categoryId)!;

    /** August: savings 30_000; dining over by 10_000 → carries -10_000. September dining: 10_000 − 16_000 = -6_000. */
    async function withSavingsAndDeficit() {
      await earn('2026-08-01', 200_000);
      await spend('2026-08-01', rent, 100_000);
      await spend('2026-08-02', dining, 30_000);
      await spend('2026-08-03', groceries, 50_000);
      await lifecycle.close('2026-08'); // 200_000 − 100_000 − 70_000
      await spend('2026-09-04', dining, 16_000);
    }

    it("zeros a fund's current deficit from savings and records it on the line", async () => {
      await withSavingsAndDeficit();
      expect(await balance()).toBe(30_000);
      const line = await lineFor('2026-09', dining);

      const result = await lifecycle.payDeficit('2026-09', line.id, new Date('2026-09-05T12:00:00Z'));

      expect(result).toEqual({ paidCents: 6_000, remainingDeficitCents: 0 });
      expect((await lineFor('2026-09', dining)).deficitPaidCents).toBe(6_000);
      expect(await balance()).toBe(24_000);
      const entry = await prisma.savingsEntry.findFirstOrThrow({ where: { kind: 'deficit_payment' } });
      expect(entry).toMatchObject({ month: '2026-09', categoryId: dining, budgetLineId: line.id, amountCents: -6_000 });
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

    it('rejects lines without a deficit, regular lines, and closed months', async () => {
      await withSavingsAndDeficit();
      await expect(lifecycle.payDeficit('2026-09', (await lineFor('2026-09', groceries)).id)).rejects.toThrow(/no deficit/);

      await spend('2026-09-07', rent, 200_000);
      await expect(lifecycle.payDeficit('2026-09', (await lineFor('2026-09', rent)).id)).rejects.toThrow(/isn't a fund/);

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
  });

  describe('recurring bills', () => {
    let insurance: number;

    /** Makes a recurring category in Housing. */
    const recurring = async (billCents: number, billMonths: number, nextDueMonth: string) => {
      const housing = await prisma.group.findFirstOrThrow({ where: { name: 'Housing' } });
      const category = await prisma.category.create({
        data: { groupId: housing.id, name: 'Insurance', type: 'recurring', billCents, billMonths, nextDueMonth, sortOrder: 1 },
      });
      insurance = category.id;
      await prisma.$transaction((tx) => lifecycle.syncRecurringLines(tx));
      return category;
    };
    const line = async (month: string) => (await lines(month)).get(insurance)!;
    const nextDue = async () => (await prisma.category.findUniqueOrThrow({ where: { id: insurance } })).nextDueMonth;
    /** Net effect of the bill's savings entries. */
    const billSavings = async () =>
      (await prisma.savingsEntry.findMany({ where: { categoryId: insurance } })).reduce((sum, e) => sum + e.amountCents, 0);

    it('stores an even share each month and pays the bill from it', async () => {
      await recurring(20_000, 4, '2026-12');
      for (const month of ['2026-09', '2026-10', '2026-11', '2026-12']) await lifecycle.ensureMonth(month);
      for (const month of ['2026-09', '2026-10', '2026-11', '2026-12']) {
        expect(await line(month)).toMatchObject({ type: 'recurring', limitCents: 5_000, dueMonth: '2026-12', billCents: 20_000 });
      }

      for (const month of ['2026-09', '2026-10', '2026-11']) await lifecycle.close(month);
      expect(await line('2026-12')).toMatchObject({ carryInCents: 15_000, limitCents: 5_000 });
      expect(await entries('2026-09')).toContainEqual({ kind: 'recurring_store', categoryId: insurance, amountCents: -5_000 });
      expect(await billSavings()).toBe(-15_000);

      await spend('2026-12-10', insurance, 19_500);
      await lifecycle.close('2026-12');
      expect((await entries('2026-12')).filter((e) => e.categoryId === insurance)).toEqual([
        { kind: 'recurring_store', categoryId: insurance, amountCents: -5_000 },
        { kind: 'recurring_release', categoryId: insurance, amountCents: 500 },
      ]);
      // The bill cost 19_500 in all; savings is down by exactly that.
      expect(await billSavings()).toBe(-19_500);
      expect(await nextDue()).toBe('2027-04');
      expect(await line('2027-01')).toMatchObject({ carryInCents: 0, limitCents: 5_000, dueMonth: '2027-04' });
    });

    it('splits an uneven bill with the extra cent first', async () => {
      await recurring(38_733, 2, '2026-11');
      await lifecycle.ensureMonth('2026-10');
      await lifecycle.ensureMonth('2026-11');
      expect((await line('2026-10')).limitCents).toBe(19_367);
      expect((await line('2026-11')).limitCents).toBe(19_366);
      await lifecycle.close('2026-10');
      expect(await line('2026-11')).toMatchObject({ carryInCents: 19_367, limitCents: 19_366 });
    });

    it('spreads the whole bill over the months left when starting mid-cycle', async () => {
      await recurring(20_000, 4, '2026-10');
      await lifecycle.ensureMonth('2026-09');
      await lifecycle.ensureMonth('2026-10');
      expect((await line('2026-09')).limitCents).toBe(10_000);
      expect((await line('2026-10')).limitCents).toBe(10_000);
    });

    it('re-spreads what is still needed when the bill changes', async () => {
      await recurring(20_000, 4, '2026-12');
      for (const month of ['2026-09', '2026-10', '2026-11', '2026-12']) await lifecycle.ensureMonth(month);
      await lifecycle.close('2026-09');
      await lifecycle.close('2026-10'); // 10_000 stored
      await prisma.category.update({ where: { id: insurance }, data: { billCents: 24_000 } });
      await prisma.$transaction((tx) => lifecycle.syncRecurringLines(tx, insurance));
      expect((await line('2026-11')).limitCents).toBe(7_000);
      expect((await line('2026-12')).limitCents).toBe(7_000);
    });

    it('holds the stored money past the due month until the payment is recorded', async () => {
      await recurring(10_000, 2, '2026-10');
      for (const month of ['2026-09', '2026-10', '2026-11']) await lifecycle.ensureMonth(month);
      await lifecycle.close('2026-09');
      await lifecycle.close('2026-10');
      expect(await nextDue()).toBe('2026-10');
      expect(await line('2026-11')).toMatchObject({ carryInCents: 10_000, limitCents: 0, dueMonth: '2026-10' });

      await spend('2026-11-03', insurance, 9_000);
      await lifecycle.close('2026-11');
      expect(await entries('2026-11')).toContainEqual({ kind: 'recurring_release', categoryId: insurance, amountCents: 1_000 });
      // The next cycle keeps its schedule (due December), so December stores the whole bill.
      expect(await nextDue()).toBe('2026-12');
      expect(await line('2026-12')).toMatchObject({ carryInCents: 0, limitCents: 10_000, dueMonth: '2026-12' });
    });

    it('starts the next cycle in later open months as soon as a payment is recorded', async () => {
      await recurring(20_000, 2, '2026-09');
      for (const month of ['2026-09', '2026-10', '2026-11']) await lifecycle.ensureMonth(month);
      expect((await line('2026-10')).limitCents).toBe(0); // overdue in the projection
      await spend('2026-09-20', insurance, 20_000);
      await prisma.$transaction((tx) => lifecycle.syncRecurringLines(tx, insurance));
      expect(await line('2026-10')).toMatchObject({ dueMonth: '2026-11', limitCents: 10_000 });
      expect(await line('2026-11')).toMatchObject({ dueMonth: '2026-11', limitCents: 10_000 });
    });

    it('reopening puts the bill back on its cycle and undoes the settlement', async () => {
      await recurring(10_000, 2, '2026-09');
      await lifecycle.ensureMonth('2026-09');
      await spend('2026-09-15', insurance, 10_000);
      await lifecycle.close('2026-09');
      expect(await nextDue()).toBe('2026-11');

      await lifecycle.reopen('2026-09');
      expect(await nextDue()).toBe('2026-09');
      expect(await entries('2026-09')).toEqual([]);
      // September's payment is still recorded, so October is projected onto the next cycle.
      expect(await line('2026-10')).toMatchObject({ carryInCents: 0, dueMonth: '2026-11' });
    });

    it('releases the stored money when the category becomes standard', async () => {
      await recurring(20_000, 4, '2026-12');
      await lifecycle.ensureMonth('2026-09');
      await lifecycle.close('2026-09'); // 5_000 stored
      await prisma.category.update({ where: { id: insurance }, data: { type: 'standard' } });
      await prisma.$transaction((tx) => lifecycle.applyTypeToOpenMonths(tx, insurance, 'standard', 0));
      expect(await line('2026-10')).toMatchObject({ type: 'standard', limitCents: 0, dueMonth: null, carryInCents: 5_000 });

      await lifecycle.close('2026-10');
      expect(await entries('2026-10')).toContainEqual({ kind: 'recurring_release', categoryId: insurance, amountCents: 5_000 });
      expect(await billSavings()).toBe(0);
    });

    it('keeps savings + funds + stored money equal to total income − total spending', async () => {
      await recurring(30_000, 3, '2026-10');
      await lifecycle.ensureMonth('2026-08');
      await earn('2026-08-01', 300_000);
      await spend('2026-08-02', rent, 100_000);
      await spend('2026-09-04', groceries, 60_000);
      await spend('2026-10-09', insurance, 31_000);
      await spend('2026-10-11', dining, 5_000);
      for (const month of ['2026-08', '2026-09', '2026-10']) await lifecycle.close(month);
      expect(await totalHeld('2026-11')).toBe(300_000 - 100_000 - 60_000 - 31_000 - 5_000);
    });
  });

  describe('other rules', () => {
    it('applies a type change to open months only', async () => {
      await lifecycle.close('2026-08');
      await prisma.$transaction((tx) => lifecycle.applyTypeToOpenMonths(tx, groceries, 'standard', 50_000));

      expect((await lines('2026-08')).get(groceries)?.type).toBe('fund');
      expect((await lines('2026-09')).get(groceries)?.type).toBe('standard');
    });

    it('adds a line for a new category to every open month', async () => {
      await lifecycle.close('2026-08');
      await lifecycle.ensureMonth('2026-10');
      const snacks = await prisma.category.create({
        data: { groupId: foodId, name: 'Snacks', defaultLimitCents: 2_500, type: 'fund' },
      });
      await prisma.$transaction((tx) => lifecycle.addLineToOpenMonths(tx, snacks.id));

      expect((await lines('2026-08')).has(snacks.id)).toBe(false);
      expect((await lines('2026-09')).get(snacks.id)?.limitCents).toBe(2_500);
      expect((await lines('2026-10')).get(snacks.id)?.type).toBe('fund');
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
