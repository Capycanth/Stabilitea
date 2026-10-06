import ExcelJS from 'exceljs';
import { monthLabel } from '@stabilitea/shared';
import type { CloseOutcome, MonthReportStatus, YearReport } from './year-report.js';

const MONEY = '"$"#,##0.00;[Red]-"$"#,##0.00';
const GREEN = 'FF3F7A4E';
const IVORY = 'FFFBF7EE';
const IVORY_DEEP = 'FFF1EADB';
const ORANGE_SOFT = 'FFFBE6D6';
const LINE = 'FFE2D8C6';
const INK = 'FF2F2A26';
const MUTED = 'FF6B625A';

const dollars = (cents: number) => Math.round(cents) / 100;

const STATUS_LABEL: Record<MonthReportStatus, string> = { open: 'Open', closed: 'Closed', 'not budgeted': 'Not budgeted' };
const OUTCOME_LABEL: Record<CloseOutcome, string> = {
  carried: 'Carried to next month',
  'carried-deficit': 'Deficit carried to next month',
  swept: 'Swept to savings',
  reset: 'Reset (no rollover)',
  none: '—',
  open: 'Month open',
};

function styleHeader(row: ExcelJS.Row): void {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: GREEN } } };
  });
}

function styleTotal(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: INK } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IVORY_DEEP } };
    cell.border = { top: { style: 'thin', color: { argb: INK } } };
  });
}

function addTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string, width: number): void {
  sheet.mergeCells(1, 1, 1, width);
  sheet.mergeCells(2, 1, 2, width);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 16, color: { argb: INK } };
  const sub = sheet.getCell(2, 1);
  sub.value = subtitle;
  sub.font = { italic: true, color: { argb: MUTED } };
  for (const r of [1, 2]) {
    sheet.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IVORY } };
    });
  }
  sheet.getRow(1).height = 26;
  sheet.addRow([]);
}

/** Renders the yearly report as an .xlsx workbook: Summary, Monthly, Budget vs actual. */
export async function renderYearWorkbook(report: YearReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Stabilitea';
  workbook.created = report.generatedAt;
  workbook.title = `Stabilitea ${report.year} yearly report`;
  const generated = `Generated ${report.generatedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}. Amounts in USD.`;

  // ---------------------------------------------------------------- Summary
  const pageSetup: Partial<ExcelJS.PageSetup> = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  const summary = workbook.addWorksheet('Summary', { views: [{ showGridLines: false }], pageSetup });
  summary.columns = [{ width: 36 }, { width: 18 }, { width: 18 }, { width: 22 }];
  addTitle(summary, `Stabilitea — ${report.year} yearly report`, generated, 4);

  const t = report.totals;
  const headline = summary.addRow(['Year at a glance', 'Amount']);
  styleHeader(headline);
  const rows: [string, number | string][] = [
    ['Income', dollars(t.incomeCents)],
    ['Planned income', dollars(t.plannedIncomeCents)],
    ['Expenses', dollars(t.expenseCents)],
    ['Net (income − expenses)', dollars(t.netCents)],
    ['Budgeted (sum of monthly limits)', dollars(t.budgetedCents)],
    ['Swept into savings', dollars(t.sweptCents)],
    ['Paid from savings to cover deficits', dollars(t.deficitPaidCents)],
    ['Savings balance on Jan 1', dollars(t.savingsBalanceStartCents)],
    ['Savings balance at year end', dollars(t.savingsBalanceEndCents)],
    ['Deficit payments made', t.deficitPaymentCount],
    ['Months closed', `${t.monthsClosed} of 12`],
  ];
  for (const [label, value] of rows) {
    const row = summary.addRow([label, value]);
    if (typeof value === 'number' && label !== 'Deficit payments made') row.getCell(2).numFmt = MONEY;
    row.getCell(1).border = { bottom: { style: 'hair', color: { argb: LINE } } };
    row.getCell(2).border = { bottom: { style: 'hair', color: { argb: LINE } } };
    if (label.startsWith('Paid from savings') && t.deficitPaidCents > 0) {
      row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE_SOFT } }));
    }
    if (label.startsWith('Savings balance at year end')) row.font = { bold: true };
  }

  summary.addRow([]);
  const catHeader = summary.addRow(['Spending by category', 'Budgeted', 'Spent', 'Paid from savings']);
  styleHeader(catHeader);
  const catStart = catHeader.number + 1;
  for (const c of report.categories) {
    const row = summary.addRow([c.categoryName, dollars(c.budgetedCents), dollars(c.spentCents), dollars(c.deficitPaidCents)]);
    [2, 3, 4].forEach((i) => (row.getCell(i).numFmt = MONEY));
  }
  const catEnd = summary.lastRow?.number ?? catStart;
  if (report.categories.length) {
    const total = summary.addRow([
      'Total',
      { formula: `SUM(B${catStart}:B${catEnd})` },
      { formula: `SUM(C${catStart}:C${catEnd})` },
      { formula: `SUM(D${catStart}:D${catEnd})` },
    ]);
    [2, 3, 4].forEach((i) => (total.getCell(i).numFmt = MONEY));
    styleTotal(total);
  }

  // ---------------------------------------------------------------- Monthly
  const monthly = workbook.addWorksheet('Monthly', { views: [{ state: 'frozen', ySplit: 4, xSplit: 1 }], pageSetup });
  const monthlyHeaders = [
    'Month',
    'Status',
    'Planned income',
    'Income',
    'Expenses',
    'Net',
    'Budgeted',
    'Carry-in',
    'Swept to savings',
    'Paid from savings (deficits)',
    'Savings balance (end of month)',
  ];
  monthly.columns = [{ width: 18 }, { width: 14 }, ...monthlyHeaders.slice(2).map(() => ({ width: 17 }))];
  addTitle(monthly, `${report.year} month by month`, 'Deficits paid from savings are highlighted.', monthlyHeaders.length);
  styleHeader(monthly.addRow(monthlyHeaders));
  const firstDataRow = monthly.rowCount + 1;
  for (const m of report.months) {
    const row = monthly.addRow([
      monthLabel(m.month),
      STATUS_LABEL[m.status],
      dollars(m.plannedIncomeCents),
      dollars(m.incomeCents),
      dollars(m.expenseCents),
      dollars(m.netCents),
      dollars(m.budgetedCents),
      dollars(m.carryInCents),
      dollars(m.sweptCents),
      dollars(m.deficitPaidCents),
      dollars(m.savingsBalanceEndCents),
    ]);
    for (let i = 3; i <= 11; i++) row.getCell(i).numFmt = MONEY;
    if (m.status === 'not budgeted') row.getCell(2).font = { color: { argb: MUTED } };
    if (m.deficitPaidCents > 0) {
      row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE_SOFT } }));
    }
  }
  const lastDataRow = monthly.rowCount;
  const col = (i: number) => String.fromCharCode(64 + i);
  const totalRow = monthly.addRow([
    'Total',
    '',
    // Carry-ins aren't additive across months, so that column has no total.
    ...[3, 4, 5, 6, 7, 8, 9, 10].map((i) => (i === 8 ? '' : { formula: `SUM(${col(i)}${firstDataRow}:${col(i)}${lastDataRow})` })),
    { formula: `${col(11)}${lastDataRow}` },
  ]);
  for (let i = 3; i <= 11; i++) totalRow.getCell(i).numFmt = MONEY;
  styleTotal(totalRow);

  // ---------------------------------------------------------------- Budget vs actual
  const detail = workbook.addWorksheet('Budget vs actual', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup });
  detail.pageSetup.printTitlesRow = '4:4';
  const detailHeaders = [
    'Month',
    'Category',
    'Subcategory',
    'Rolls over',
    'Limit',
    'Carry-in',
    'Paid from savings',
    'Budget (limit + carry-in + paid)',
    'Spent',
    'Remaining',
    'At close',
  ];
  detail.columns = [
    { width: 16 },
    { width: 18 },
    { width: 20 },
    { width: 11 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 22 },
  ];
  addTitle(
    detail,
    `${report.year} budget vs. actual`,
    'Negative carry-ins are deficits rolled over from the previous month. Rows where a deficit was paid from savings are highlighted.',
    detailHeaders.length,
  );
  const detailHeaderRow = detail.addRow(detailHeaders);
  styleHeader(detailHeaderRow);
  for (const m of report.months) {
    for (const line of m.lines) {
      const row = detail.addRow([
        monthLabel(m.month),
        line.categoryName,
        line.subcategoryName,
        line.rollover ? 'Yes' : 'No',
        dollars(line.limitCents),
        dollars(line.carryInCents),
        dollars(line.deficitPaidCents),
        dollars(line.availableCents),
        dollars(line.spentCents),
        dollars(line.remainingCents),
        OUTCOME_LABEL[line.outcome],
      ]);
      for (let i = 5; i <= 10; i++) row.getCell(i).numFmt = MONEY;
      if (line.deficitPaidCents > 0) {
        row.eachCell((cell) => (cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE_SOFT } }));
      }
    }
  }
  if (detail.rowCount > detailHeaderRow.number) {
    detail.autoFilter = { from: { row: detailHeaderRow.number, column: 1 }, to: { row: detail.rowCount, column: detailHeaders.length } };
  } else {
    detail.addRow(['No budget months in this year.']);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
