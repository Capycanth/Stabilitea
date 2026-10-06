# Stabilitea

A calm, local-only personal budget. Record income and expenses by month, set limits on
subcategories, see budget vs. actual, and close each month to roll leftovers forward or
sweep them into savings.

Everything runs on your machine: an Angular 22 app, a NestJS API bound to `127.0.0.1`,
and one SQLite file at `data/stabilitea.db`.

## Requirements

- Node 24 (or 22.22.3+), which ships npm 11. npm 10 hits an install bug with this dependency tree.
- A C/C++ toolchain is only needed if no prebuilt `better-sqlite3` binary exists for your platform.

## Quick start

```bash
npm run setup     # install, create the database, add starter categories, build
npm start         # http://localhost:3000
```

For development with live reload (API on :3000, Angular dev server on :4200 with an `/api` proxy):

```bash
npm run dev       # open http://localhost:4200
```

| Script | What it does |
| --- | --- |
| `npm run dev` | API in watch mode + `ng serve` with `/api` proxy |
| `npm run build` | Build shared, API, and web |
| `npm start` | Run the built API, which serves the web app at localhost:3000 |
| `npm test` | Vitest across all workspaces |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Insert starter categories (skipped if any exist) |
| `npm run backup` | Copy the DB to `data/backups/stabilitea-YYYYMMDD.db` (safe while running) |

You can also download a full JSON export from **Download backup** in the sidebar (`GET /api/export`).

## Yearly report

**Reports** in the sidebar downloads an Excel workbook for any calendar year (`GET /api/reports/:year`):

| Sheet | Contents |
| --- | --- |
| Summary | Income, planned income, expenses, net, budgeted, swept into savings, deficits paid from savings, savings on Jan 1 and at year end, months closed, and spending by category |
| Monthly | One row per month: status, planned vs. actual income, expenses, net, budgeted, carry-in, sweeps, deficit payments, savings balance at month end |
| Budget vs actual | Every subcategory for every month: limit, carry-in, paid from savings, budget, spent, remaining, and what happened at close |

Rows where a deficit was paid from savings are highlighted. The report is read-only and never creates budget months.

## Project layout

```
apps/
  web/        Angular 22.1 — standalone, zoneless, Signal Forms, httpResource, @angular/aria
  api/        NestJS 12 (ESM) + Prisma 7 + SQLite (better-sqlite3 adapter)
    prisma/   schema.prisma, migrations/, seed.ts
packages/
  shared/     Request/response types + pure month and money helpers used by both apps
data/         stabilitea.db (gitignored), backups/
scripts/      backup.mjs
docs/         angular-best-practices.md
```

## How months work

- **First visit creates the month** by copying the most recent earlier month's limits and planned
  income (or each subcategory's default limit when there is none). Archived subcategories are skipped.
- **A month's budget** for each line is `limit + carry-in + paid from savings`, and the carry-in can be negative.
- **Closing a month** computes `leftover = budget − spent` for each line. In rollover categories the
  leftover becomes next month's carry-in, **even when negative**, so a deficit keeps reducing future months
  until it's made up. In other categories positive leftovers are swept to savings and overspending resets.
- **Pay deficit from savings:** on an open month, any rollover subcategory whose remaining balance is below
  $0 shows **Pay from savings**. It moves the whole deficit out of savings, or the entire balance if savings
  is smaller (savings never goes below $0). Each payment is stored on that month's budget line
  (`deficit_paid_cents`) and as a negative `deficit_payment` savings entry, listed on the Budget page (with Undo
  while the month is open), on the Savings page, and in the yearly report.
- **Reopening** removes that month's sweeps and resets next month's carry-ins; deficit payments stay recorded.
  Reopening is blocked if those sweeps were already spent on deficit payments (undo the payments first).
  Months reopen newest-first, and a closed month rejects transaction and budget edits with `409 MONTH_CLOSED`.

## Implementation notes

Choices made where the design document left room:

- **Open questions:** overspending carries forward in rollover categories and resets in others; savings only
  changes through sweeps and deficit payments; light ivory theme only; USD with cents. Refunds have no special
  handling yet: edit the original expense down or record the refund under Other Income.
- **Deficit payments are rollover-only.** Non-rollover categories reset at close, so there is nothing to pay down.
- **Budget lines exist only for expense subcategories.** Income is tracked against planned income.
- **New or unarchived expense subcategories** get a line (at their default limit) in every open month,
  so their spending shows up immediately.
- **Closing out of order** is allowed as long as the next month is open; closing an earlier month after a
  later one is closed is blocked, which keeps closed history stable.
- API responses add `canClose` / `canReopen` to budgets and `earliestOpenPastMonth` to the summary to drive
  the close banner and buttons.
- **Contrast:** `--st-green` text on `--st-ivory-deep` measures 4.27:1, below AA for body text. The UI
  only uses green text on ivory/surface backgrounds or at large sizes. All pages pass axe (WCAG 2.1 AA).
