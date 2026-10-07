import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { BudgetMonthDto, GroupDto, MonthSummary, SavingsDto, TransactionDto } from '@stabilitea/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app-setup.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seedStarterGroups } from './starter-groups.js';
import { createTestDatabase, type TestDatabase } from './test-db.js';

describe('Stabilitea API (e2e)', () => {
  let testDb: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  let groups: GroupDto[];

  const category = (group: string, name: string) =>
    groups.find((c) => c.name === group)!.categories.find((s) => s.name === name)!;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    testDb = createTestDatabase();
    process.env['DATABASE_URL'] = testDb.url;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    testDb?.cleanup();
  });

  beforeEach(async () => {
    for (const table of ['savings_entry', 'transaction', 'budget_line', 'budget_month', 'category', 'category_group']) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
    }
    await seedStarterGroups(prisma);
    groups = (await http().get('/api/groups').expect(200)).body;
  });

  describe('groups', () => {
    it('lists seeded groups with nested categories in order', () => {
      expect(groups.map((c) => c.name)).toEqual(['Income', 'Housing', 'Food', 'Transportation', 'Personal']);
      expect(groups.find((c) => c.name === 'Food')).toMatchObject({ kind: 'expense' });
      expect(category('Housing', 'Internet')).toMatchObject({ defaultLimitCents: 7_000, type: 'standard', archivedAt: null });
      expect(category('Transportation', 'Maintenance')).toMatchObject({ type: 'fund' });
    });

    it('creates, renames, reorders and archives', async () => {
      const created: GroupDto = (await http().post('/api/groups').send({ name: ' Health ', kind: 'expense' }).expect(201)).body;
      expect(created).toMatchObject({ name: 'Health', sortOrder: 5 });

      await http().patch(`/api/groups/${created.id}`).send({ sortOrder: 0 }).expect(200);
      let list: GroupDto[] = (await http().get('/api/groups').expect(200)).body;
      expect(list[0]!.name).toBe('Health');

      await http().patch(`/api/groups/${created.id}`).send({ archived: true }).expect(200);
      list = (await http().get('/api/groups').expect(200)).body;
      expect(list.some((c) => c.id === created.id)).toBe(false);
      list = (await http().get('/api/groups?includeArchived=true').expect(200)).body;
      expect(list.find((c) => c.id === created.id)?.archivedAt).not.toBeNull();
    });

    it('rejects duplicate names with a field error', async () => {
      const res = await http().post('/api/groups').send({ name: 'Food', kind: 'expense' }).expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', fieldErrors: { name: [expect.stringContaining('already exists')] } });
    });

    it('creates categories and adds them to open budgets', async () => {
      const food = groups.find((c) => c.name === 'Food')!;
      await http().get('/api/budgets/2026-09').expect(200);
      const snack = (await http().post(`/api/groups/${food.id}/categories`).send({ name: 'Snacks', defaultLimitCents: 2_000, type: 'fund' }).expect(201)).body;
      expect(snack).toMatchObject({ type: 'fund' });
      const budget: BudgetMonthDto = (await http().get('/api/budgets/2026-09').expect(200)).body;
      const line = budget.groups.flatMap((g) => g.lines).find((l) => l.categoryId === snack.id);
      expect(line).toMatchObject({ limitCents: 2_000, carryInCents: 0, type: 'fund' });
    });

    it('rejects moving a category across kinds', async () => {
      const income = groups.find((c) => c.name === 'Income')!;
      const res = await http().patch(`/api/categories/${category('Food', 'Groceries').id}`).send({ groupId: income.id }).expect(400);
      expect(res.body.fieldErrors).toHaveProperty('groupId');
    });

    it('updates open lines when a category becomes a fund', async () => {
      await http().post('/api/budgets/2026-08/close').expect(200);
      const updated = (await http().patch(`/api/categories/${category('Food', 'Groceries').id}`).send({ type: 'fund' }).expect(200)).body;
      expect(updated).toMatchObject({ type: 'fund' });
      const aug: BudgetMonthDto = (await http().get('/api/budgets/2026-08')).body;
      const sep: BudgetMonthDto = (await http().get('/api/budgets/2026-09')).body;
      const groceriesLine = (b: BudgetMonthDto) => b.groups.flatMap((g) => g.lines).find((l) => l.categoryName === 'Groceries')!;
      expect(groceriesLine(aug).type).toBe('standard');
      expect(groceriesLine(sep).type).toBe('fund');
    });

    it('only lets expense categories be funds or recurring', async () => {
      const res = await http().patch(`/api/categories/${category('Income', 'Salary').id}`).send({ type: 'fund' }).expect(400);
      expect(res.body.fieldErrors).toHaveProperty('type');
      const income = groups.find((c) => c.name === 'Income')!;
      await http().post(`/api/groups/${income.id}/categories`).send({ name: 'Bonus', type: 'recurring', billCents: 100, billMonths: 2, nextDueMonth: '2026-12' }).expect(400);
    });
  });

  describe('transactions', () => {
    const valid = () => ({ date: '2026-09-04', type: 'expense', amountCents: 4_250, categoryId: category('Food', 'Groceries').id, payee: 'Market', note: '' });

    it('creates, lists with filters, updates and deletes', async () => {
      const created: TransactionDto = (await http().post('/api/transactions').send(valid()).expect(201)).body;
      expect(created).toMatchObject({ groupName: 'Food', categoryName: 'Groceries', payee: 'Market', note: null });

      await http().post('/api/transactions').send({ date: '2026-09-01', type: 'income', amountCents: 500_000, categoryId: category('Income', 'Salary').id }).expect(201);
      await http().post('/api/transactions').send({ ...valid(), date: '2026-10-01' }).expect(201);

      const all: TransactionDto[] = (await http().get('/api/transactions?month=2026-09').expect(200)).body;
      expect(all.map((t) => t.date)).toEqual(['2026-09-04', '2026-09-01']);
      const expenses: TransactionDto[] = (await http().get('/api/transactions?month=2026-09&type=expense').expect(200)).body;
      expect(expenses).toHaveLength(1);
      const food = groups.find((c) => c.name === 'Food')!;
      expect((await http().get(`/api/transactions?month=2026-09&groupId=${food.id}`)).body).toHaveLength(1);
      expect((await http().get(`/api/transactions?month=2026-09&categoryId=${category('Income', 'Salary').id}`)).body).toHaveLength(1);

      const updated = (await http().patch(`/api/transactions/${created.id}`).send({ amountCents: 5_000, payee: null }).expect(200)).body;
      expect(updated).toMatchObject({ amountCents: 5_000, payee: null });

      await http().delete(`/api/transactions/${created.id}`).expect(204);
      await http().delete(`/api/transactions/${created.id}`).expect(404);
    });

    it('returns field-level validation errors', async () => {
      const res = await http()
        .post('/api/transactions')
        .send({ date: '2026-02-30', type: 'expense', amountCents: 0, categoryId: 'x' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body.fieldErrors).sort()).toEqual(['amountCents', 'categoryId', 'date']);
      expect(res.body.fieldErrors.amountCents).toContain('Amount must be greater than 0');
    });

    it('rejects unknown fields and fractional cents', async () => {
      const res = await http().post('/api/transactions').send({ ...valid(), amountCents: 10.5, hacker: true }).expect(400);
      expect(res.body.fieldErrors).toHaveProperty('amountCents');
      expect(res.body.fieldErrors).toHaveProperty('hacker');
    });

    it('requires the type to match the group kind', async () => {
      const res = await http().post('/api/transactions').send({ ...valid(), type: 'income' }).expect(400);
      expect(res.body.fieldErrors.type[0]).toContain('expense');
    });

    it('rejects an invalid month query', async () => {
      const res = await http().get('/api/transactions?month=2026-13').expect(400);
      expect(res.body.fieldErrors).toHaveProperty('month');
    });

    it('returns 409 MONTH_CLOSED for writes in a closed month', async () => {
      const inAugust: TransactionDto = (await http().post('/api/transactions').send({ ...valid(), date: '2026-08-10' }).expect(201)).body;
      const inSeptember: TransactionDto = (await http().post('/api/transactions').send(valid()).expect(201)).body;
      await http().post('/api/budgets/2026-08/close').expect(200);

      const create = await http().post('/api/transactions').send({ ...valid(), date: '2026-08-11' }).expect(409);
      expect(create.body).toMatchObject({ statusCode: 409, code: 'MONTH_CLOSED' });
      expect((await http().patch(`/api/transactions/${inAugust.id}`).send({ amountCents: 1 }).expect(409)).body.code).toBe('MONTH_CLOSED');
      expect((await http().delete(`/api/transactions/${inAugust.id}`).expect(409)).body.code).toBe('MONTH_CLOSED');
      // Moving an open-month transaction into a closed month is also blocked.
      expect((await http().patch(`/api/transactions/${inSeptember.id}`).send({ date: '2026-08-02' }).expect(409)).body.code).toBe('MONTH_CLOSED');

      await http().post('/api/budgets/2026-08/reopen').expect(200);
      await http().patch(`/api/transactions/${inAugust.id}`).send({ amountCents: 1 }).expect(200);
    });
  });

  describe('budgets, summary and savings', () => {
    it('auto-creates a month and edits limits and planned income', async () => {
      const budget: BudgetMonthDto = (await http().get('/api/budgets/2026-09').expect(200)).body;
      expect(budget).toMatchObject({ month: '2026-09', status: 'open', canClose: true, canReopen: false });
      expect(budget.groups.map((g) => g.groupName)).toEqual(['Housing', 'Food', 'Transportation', 'Personal']);

      const line = budget.groups[1]!.lines[0]!;
      const afterLine: BudgetMonthDto = (await http().patch(`/api/budgets/2026-09/lines/${line.id}`).send({ limitCents: 55_500 }).expect(200)).body;
      expect(afterLine.groups[1]!.lines[0]!.limitCents).toBe(55_500);

      const afterIncome: BudgetMonthDto = (await http().patch('/api/budgets/2026-09').send({ plannedIncomeCents: 450_000 }).expect(200)).body;
      expect(afterIncome.plannedIncomeCents).toBe(450_000);

      const bad = await http().patch(`/api/budgets/2026-09/lines/${line.id}`).send({ limitCents: -1 }).expect(400);
      expect(bad.body.fieldErrors).toHaveProperty('limitCents');
      await http().patch(`/api/budgets/2026-10/lines/${line.id}`).send({ limitCents: 1 }).expect(404);
      await http().get('/api/budgets/not-a-month').expect(400);
    });

    it('blocks budget edits in a closed month', async () => {
      const budget: BudgetMonthDto = (await http().post('/api/budgets/2026-08/close').expect(200)).body;
      expect(budget).toMatchObject({ status: 'closed', canReopen: true, canClose: false });
      const line = budget.groups[0]!.lines[0]!;
      expect((await http().patch(`/api/budgets/2026-08/lines/${line.id}`).send({ limitCents: 1 }).expect(409)).body.code).toBe('MONTH_CLOSED');
      expect((await http().patch('/api/budgets/2026-08').send({ plannedIncomeCents: 1 }).expect(409)).body.code).toBe('MONTH_CLOSED');
      await http().post('/api/budgets/2026-08/close').expect(409);
    });

    it('summarizes budget vs. actual', async () => {
      await http().post('/api/transactions').send({ date: '2026-09-01', type: 'income', amountCents: 500_000, categoryId: category('Income', 'Salary').id }).expect(201);
      await http().post('/api/transactions').send({ date: '2026-09-02', type: 'expense', amountCents: 30_000, categoryId: category('Food', 'Groceries').id }).expect(201);
      await http().post('/api/transactions').send({ date: '2026-09-03', type: 'expense', amountCents: 25_000, categoryId: category('Food', 'Dining Out').id }).expect(201);

      const summary: MonthSummary = (await http().get('/api/summary/2026-09').expect(200)).body;
      expect(summary).toMatchObject({ month: '2026-09', status: 'open', incomeCents: 500_000, expenseCents: 55_000, netCents: 445_000 });
      // Projected: income − regular spending − Maintenance's 7_500 fund contribution
      expect(summary).toMatchObject({ fundContributionCents: 7_500, savingsChangeCents: 437_500 });
      const food = summary.groups.find((c) => c.name === 'Food')!;
      expect(food).toMatchObject({ limitCents: 70_000, availableCents: 70_000, spentCents: 55_000 });
      expect(food.categories.find((s) => s.name === 'Dining Out')).toMatchObject({ type: 'standard', remainingCents: -5_000 });
      expect(summary.groups.some((c) => c.name === 'Income')).toBe(false);
    });

    it('reports the earliest open past month', async () => {
      await http().get('/api/summary/2026-07').expect(200);
      const summary: MonthSummary = (await http().get('/api/summary/2026-09').expect(200)).body;
      expect(summary.earliestOpenPastMonth).toBe('2026-07');
    });

    const post = (date: string, categoryId: number, amountCents: number, type = 'expense') =>
      http().post('/api/transactions').send({ date, type, amountCents, categoryId }).expect(201);

    it('closes income, spending and fund contributions into savings', async () => {
      await post('2026-08-01', category('Income', 'Salary').id, 500_000, 'income');
      await post('2026-08-02', category('Housing', 'Rent/Mortgage').id, 140_000);
      await http().post('/api/budgets/2026-08/close').expect(200);

      const savings: SavingsDto = (await http().get('/api/savings').expect(200)).body;
      expect(savings.balanceCents).toBe(500_000 - 140_000 - 7_500);
      expect(savings.entries.map((e) => [e.kind, e.categoryName, e.amountCents])).toEqual([
        ['income', 'Salary', 500_000],
        ['spending', 'Rent/Mortgage', -140_000],
        ['fund_contribution', 'Maintenance', -7_500],
      ]);
      expect(savings.months).toEqual([
        {
          month: '2026-08',
          incomeCents: 500_000,
          spendingCents: 140_000,
          fundContributionCents: 7_500,
          fundReleaseCents: 0,
          recurringStoredCents: 0,
          recurringReleaseCents: 0,
          deficitPaidCents: 0,
          changeCents: 352_500,
          balanceAfterCents: 352_500,
        },
      ]);
      expect(savings.funds).toEqual([
        { categoryId: category('Transportation', 'Maintenance').id, categoryName: 'Maintenance', groupName: 'Transportation', balanceCents: 7_500 },
      ]);

      const august: MonthSummary = (await http().get('/api/summary/2026-08').expect(200)).body;
      expect(august.savingsChangeCents).toBe(352_500);
      const september: MonthSummary = (await http().get('/api/summary/2026-09').expect(200)).body;
      expect(september.groups.find((c) => c.name === 'Transportation')).toMatchObject({ limitCents: 22_500, availableCents: 30_000 });

      await http().post('/api/budgets/2026-08/reopen').expect(200);
      expect((await http().get('/api/savings')).body).toMatchObject({ balanceCents: 0, months: [], entries: [] });
    });

    it('carries fund deficits, pays them from savings, and undoes payments', async () => {
      await post('2026-08-01', category('Income', 'Salary').id, 100_000, 'income');
      await post('2026-08-06', category('Transportation', 'Maintenance').id, 20_000); // 7_500 → -12_500
      await http().post('/api/budgets/2026-08/close').expect(200);

      await post('2026-09-03', category('Transportation', 'Maintenance').id, 1_000);
      let budget: BudgetMonthDto = (await http().get('/api/budgets/2026-09').expect(200)).body;
      const findLine = (b: BudgetMonthDto, name: string) => b.groups.flatMap((g) => g.lines).find((l) => l.categoryName === name)!;
      let maintenance = findLine(budget, 'Maintenance');
      expect(maintenance).toMatchObject({ type: 'fund', carryInCents: -12_500, availableCents: -5_000, remainingCents: -6_000, deficitPaidCents: 0 });
      expect(budget.savingsBalanceCents).toBe(92_500);

      // Regular lines have nothing to pay down.
      await post('2026-09-04', category('Food', 'Groceries').id, 60_000);
      await http().post(`/api/budgets/2026-09/lines/${findLine(budget, 'Groceries').id}/pay-deficit`).expect(409);

      budget = (await http().post(`/api/budgets/2026-09/lines/${maintenance.id}/pay-deficit`).expect(200)).body;
      maintenance = findLine(budget, 'Maintenance');
      expect(maintenance).toMatchObject({ deficitPaidCents: 6_000, availableCents: 1_000, remainingCents: 0 });
      expect(budget).toMatchObject({ savingsBalanceCents: 86_500, deficitPaidCents: 6_000 });
      expect(budget.deficitPayments).toEqual([
        expect.objectContaining({ categoryName: 'Maintenance', groupName: 'Transportation', amountCents: 6_000, budgetLineId: maintenance.id }),
      ]);

      const summary: MonthSummary = (await http().get('/api/summary/2026-09').expect(200)).body;
      expect(summary.deficitPaidCents).toBe(6_000);
      const savings: SavingsDto = (await http().get('/api/savings').expect(200)).body;
      expect(savings.balanceCents).toBe(86_500);
      expect(savings.entries.find((e) => e.kind === 'deficit_payment')).toMatchObject({ month: '2026-09', amountCents: -6_000 });
      // August's closing balance (−12_500) plus September's payment.
      expect(savings.funds[0]).toMatchObject({ categoryName: 'Maintenance', balanceCents: -6_500 });

      const undone: BudgetMonthDto = (await http().delete(`/api/budgets/2026-09/deficit-payments/${budget.deficitPayments[0]!.id}`).expect(200)).body;
      expect(undone).toMatchObject({ savingsBalanceCents: 92_500, deficitPaidCents: 0, deficitPayments: [] });
    });

    it('creates a recurring category, stores shares, pays the bill and settles with savings', async () => {
      const housing = groups.find((g) => g.name === 'Housing')!;
      const missing = await http().post(`/api/groups/${housing.id}/categories`).send({ name: 'Insurance', type: 'recurring' }).expect(400);
      expect(Object.keys(missing.body.fieldErrors).sort()).toEqual(['billCents', 'billMonths', 'nextDueMonth']);
      await http()
        .post(`/api/groups/${housing.id}/categories`)
        .send({ name: 'Insurance', type: 'recurring', billCents: 38_733, billMonths: 2, nextDueMonth: '2026-13' })
        .expect(400);

      const insurance = (
        await http()
          .post(`/api/groups/${housing.id}/categories`)
          .send({ name: 'Insurance', type: 'recurring', billCents: 38_733, billMonths: 2, nextDueMonth: '2026-09' })
          .expect(201)
      ).body;
      expect(insurance).toMatchObject({ type: 'recurring', billCents: 38_733, billMonths: 2, nextDueMonth: '2026-09' });

      const august: BudgetMonthDto = (await http().get('/api/budgets/2026-08').expect(200)).body;
      await http().get('/api/budgets/2026-09').expect(200);
      const lineIn = (b: BudgetMonthDto) => b.groups.flatMap((g) => g.lines).find((l) => l.categoryId === insurance.id)!;
      expect(lineIn(august)).toMatchObject({
        type: 'recurring',
        limitCents: 19_367,
        recurring: { billCents: 38_733, billMonths: 2, dueMonth: '2026-09', status: 'saving' },
      });
      const editShare = await http().patch(`/api/budgets/2026-08/lines/${lineIn(august).id}`).send({ limitCents: 1 }).expect(409);
      expect(editShare.body.message).toMatch(/calculated/);

      const augSummary: MonthSummary = (await http().get('/api/summary/2026-08').expect(200)).body;
      expect(augSummary.recurringStoredCents).toBe(19_367);
      await http().post('/api/budgets/2026-08/close').expect(200);

      await post('2026-09-12', insurance.id, 40_000);
      const september: BudgetMonthDto = (await http().get('/api/budgets/2026-09').expect(200)).body;
      expect(lineIn(september)).toMatchObject({
        limitCents: 19_366,
        carryInCents: 19_367,
        spentCents: 40_000,
        remainingCents: -1_267,
        recurring: { status: 'paid' },
      });
      await http().post('/api/budgets/2026-09/close').expect(200);

      const savings: SavingsDto = (await http().get('/api/savings').expect(200)).body;
      const sep = savings.months.find((m) => m.month === '2026-09')!;
      expect(sep).toMatchObject({ recurringStoredCents: 19_366, recurringReleaseCents: -1_267 });
      expect(savings.recurring).toEqual([
        {
          categoryId: insurance.id,
          categoryName: 'Insurance',
          groupName: 'Housing',
          billCents: 38_733,
          billMonths: 2,
          dueMonth: '2026-11',
          storedCents: 0,
        },
      ]);
      const updated = (await http().get('/api/groups').expect(200)).body as GroupDto[];
      expect(updated.find((g) => g.id === housing.id)!.categories.find((c) => c.id === insurance.id)).toMatchObject({ nextDueMonth: '2026-11' });
    });

    it('downloads a yearly Excel report with summary, monthly and budget sheets', async () => {
      await post('2026-08-01', category('Income', 'Salary').id, 500_000, 'income');
      await post('2026-08-03', category('Transportation', 'Maintenance').id, 20_000);
      await http().post('/api/budgets/2026-08/close').expect(200);
      await post('2026-09-03', category('Transportation', 'Maintenance').id, 1_000);
      const budget: BudgetMonthDto = (await http().get('/api/budgets/2026-09')).body;
      const maintenance = budget.groups.flatMap((g) => g.lines).find((l) => l.categoryName === 'Maintenance')!;
      await http().post(`/api/budgets/2026-09/lines/${maintenance.id}/pay-deficit`).expect(200);

      expect((await http().get('/api/reports/years').expect(200)).body.years).toContain(2026);
      await http().get('/api/reports/12').expect(400);

      const res = await http()
        .get('/api/reports/2026')
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('stabilitea-2026-report.xlsx');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as Buffer);
      expect(workbook.worksheets.map((w) => w.name)).toEqual(['Summary', 'Monthly', 'Budget vs actual']);

      const summarySheet = workbook.getWorksheet('Summary')!;
      const valueFor = (label: string) => {
        let found: unknown;
        summarySheet.eachRow((row) => {
          if (row.getCell(1).value === label) found = row.getCell(2).value;
        });
        return found;
      };
      expect(valueFor('Income')).toBe(5000);
      expect(valueFor('Expenses')).toBe(210);
      expect(valueFor('Moved into funds')).toBe(75);
      expect(valueFor('Paid from savings to cover fund deficits')).toBe(60);
      // August: 5000 − 75 into Maintenance; September: −60 deficit payment (September is still open)
      expect(valueFor('Change in savings')).toBe(4865);
      expect(valueFor('Savings balance at year end')).toBe(4865);
      expect(valueFor('Deficit payments made')).toBe(1);

      const monthly = workbook.getWorksheet('Monthly')!;
      const rowFor = (label: string) => monthly.getRows(1, monthly.rowCount)!.find((r) => r.getCell(1).value === label)!;
      expect([2, 3, 4, 5].map((i) => rowFor('August 2026').getCell(i).value)).toEqual(['Closed', 5000, 200, 4800]);
      expect([2, 12, 13, 14].map((i) => rowFor('September 2026').getCell(i).value)).toEqual(['Open', 60, -60, 4865]);

      const detail = workbook.getWorksheet('Budget vs actual')!;
      const detailRow = (month: string, name: string) =>
        detail.getRows(1, detail.rowCount)!.find((r) => r.getCell(1).value === month && r.getCell(3).value === name)!;
      const maintSept = detailRow('September 2026', 'Maintenance');
      expect([4, 5, 6, 7, 8, 9, 10, 11].map((i) => maintSept.getCell(i).value)).toEqual(['Fund', '', 75, -125, 60, 10, 10, 0]);
      expect(detailRow('August 2026', 'Maintenance').getCell(12).value).toBe('Fund deficit carried');
      expect(detailRow('August 2026', 'Rent/Mortgage').getCell(12).value).toBe('Spent from savings');
    });

    it('exports every table', async () => {
      await http().get('/api/budgets/2026-09').expect(200);
      const res = await http().get('/api/export').expect(200);
      expect(res.headers['content-disposition']).toContain('stabilitea-export.json');
      expect(res.body).toMatchObject({ app: 'stabilitea', schemaVersion: 3 });
      expect(res.body.groups).toHaveLength(5);
      expect(res.body.budgetLines.length).toBeGreaterThan(0);
    });

    it('returns JSON 404 for unknown API routes', async () => {
      const res = await http().get('/api/nope').expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });
});
