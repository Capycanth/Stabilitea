# Stabilitea

A calm, local-only personal budget. Record income and expenses by month, set limits on
subcategories, see budget vs. actual, and close each month to settle it into savings. Any
subcategory can be a **fund** that keeps its own balance from month to month.

Everything runs on your machine: an Angular 22 app, a NestJS API bound to `127.0.0.1`,
and one SQLite file at `data/stabilitea.db`.

## Requirements

- Node 24 (or 22.22.3+), which ships npm 11. npm 10 hits an install bug with this dependency tree.
- A C/C++ toolchain is only needed if no prebuilt `better-sqlite3` binary exists for your platform.

## Quick start

```bash
npm run setup     # install, create the database, build
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
| `npm run db:push` | Create or update the SQLite schema from `schema.prisma` |
| `npm run backup` | Copy the DB to `data/backups/stabilitea-YYYYMMDD.db` (safe while running) |

You can also download a full JSON export from **Download backup** in the sidebar (`GET /api/export`).

## Yearly report

**Reports** in the sidebar downloads an Excel workbook for any calendar year (`GET /api/reports/:year`):

| Sheet | Contents |
| --- | --- |
| Summary | Income and expenses side by side, net, planned income, budgeted, moved into and released from funds, fund deficits paid, savings on Jan 1, change in savings, savings at year end, months closed, and spending by category |
| Monthly | One row per month: status, income, expenses, net, planned income, budgeted, fund contributions and releases, fund deficits paid, change in savings, savings balance at month end |
| Budget vs actual | Every subcategory for every month: regular or fund, limit, fund balance in, paid from savings, available, spent, remaining, and what happened at close |

Rows where a deficit was paid from savings are highlighted. The report is read-only and never creates budget months.

## Project layout

```
apps/
  web/        Angular 22.1 — standalone, zoneless, Signal Forms, httpResource, @angular/aria
  api/        NestJS 12 (ESM) + Prisma 7 + SQLite (better-sqlite3 adapter)
    prisma/   schema.prisma
packages/
  shared/     Request/response types + pure month and money helpers used by both apps
data/         stabilitea.db (gitignored), backups/
scripts/      backup.mjs
docs/         angular-best-practices.md
```

## How months work

- **First visit creates the month** by copying the most recent earlier month's limits and planned
  income (or each subcategory's default limit when there is none). Archived subcategories are skipped.
- **Savings is the money not committed to a fund.** Closing a month writes its savings entries:
  `income` (+ each income subcategory), `spending` (− each regular subcategory's spending) and
  `fund_contribution` (− each fund's limit). So savings changes by **income − regular spending − fund
  contributions**, and it can go negative. A regular subcategory's limit is a target: underspending simply
  leaves more in savings, overspending leaves less.
- **Funds** (a per-subcategory flag, expense only) keep their own balance: `limit + balance in + paid from
  savings − spent`. At close that balance, positive or negative, becomes next month's carry-in ("Balance
  in"). If next month has no fund line for it (archived, or switched to regular), the balance goes back to
  savings as a `fund_release` entry, so savings + all fund balances always equals total income − total spending.
- **Pay deficit from savings:** on an open month, a fund whose remaining balance is below $0 shows **Pay
  from savings**. It moves the whole deficit out of savings, or the whole positive balance if savings is
  smaller. Each payment is stored on the budget line (`deficit_paid_cents`) and as a negative
  `deficit_payment` savings entry, listed on the Budget page (with Undo while the month is open), on the
  Savings page, and in the yearly report.
- **Switching** a subcategory between regular and fund applies to open months only; closed months keep
  their snapshot.
- **Reopening** removes that month's close entries and resets next month's carry-ins; deficit payments stay
  recorded. Months reopen newest-first, and a closed month rejects transaction and budget edits with
  `409 MONTH_CLOSED`.

## Implementation notes

Choices made where the design document left room:

- **Open questions:** light ivory theme only; USD with cents. Refunds have no special handling yet: edit
  the original expense down or record the refund under Other Income.
- **Deficit payments are fund-only.** Regular spending already comes straight out of savings.
- **Upgrading from the rollover model:** run `npm run db:push`. It drops the old `rollover` columns. Savings
  entries and carry-ins from that model followed different rules, so start from a fresh database (delete
  `data/stabilitea.db` before `db:push`).
- **Budget lines exist only for expense subcategories.** Income is tracked against planned income.
- **New or unarchived expense subcategories** get a line (at their default limit) in every open month,
  so their spending shows up immediately.
- **Closing out of order** is allowed as long as the next month is open; closing an earlier month after a
  later one is closed is blocked, which keeps closed history stable.
- API responses add `canClose` / `canReopen` to budgets, and `earliestOpenPastMonth`,
  `fundContributionCents` and `savingsChangeCents` (projected for open months) to the summary.
- **Contrast:** `--st-green` text on `--st-ivory-deep` measures 4.27:1, below AA for body text. The UI
  only uses green text on ivory/surface backgrounds or at large sizes. All pages pass axe (WCAG 2.1 AA).
