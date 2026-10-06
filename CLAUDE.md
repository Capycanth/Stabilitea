# Stabilitea — agent guide

Local-only personal finance app. Read `stabilitea-design.md` (in the "Angular Finance WebApp" claude.ai project) and `README.md` for product rules, and
`docs/angular-best-practices.md` for how to write Angular code here (it is the project's
Angular best-practices file; follow it for everything under `apps/web`).

## Layout

- `packages/shared` — API contract types (`contracts.ts`) plus pure month and money helpers. Build it first.
- `apps/api` — NestJS 12 (ESM) + Prisma 7 (`prisma-client` generator, better-sqlite3 adapter) + SQLite.
  - Month rules (auto-copy, close with negative rollovers, reopen, deficit payments) live only in
    `src/budgets/budget-lifecycle.service.ts` and are covered by its spec.
  - The yearly Excel report is `src/reports/` (`year-report.ts` gathers data, `year-workbook.ts` renders with exceljs).
  - Every error leaving `/api` is an `ApiErrorBody` (`VALIDATION_FAILED` with `fieldErrors`, `MONTH_CLOSED`, `NOT_FOUND`, `CONFLICT`).
- `apps/web` — Angular 22.1: standalone, zoneless, OnPush by default, Signal Forms, `httpResource()`, `@angular/aria`.

## Conventions

- Money is integer cents everywhere; months are `YYYY-MM`; dates are `YYYY-MM-DD`.
- Web: feature folders, no type suffixes (`budget-editor.ts`). Components never call `HttpClient`;
  each `*-api.ts` `@Service()` exposes resource factories (reads) and promise methods (writes).
- Colors only through the `--st-*` tokens in `apps/web/src/styles.css`. `--st-green` text on
  `--st-ivory-deep` is 4.27:1, so use green text there only at large sizes.
- Don't write `standalone: true`, `changeDetection: OnPush`, `@Input()`, `ngClass`, or constructor injection.

## Verify before calling work done

```bash
npm run build   # shared → api → web, no warnings
npm test        # Vitest in shared, api (unit + e2e on a temp SQLite file), web
```

Schema changes: edit `apps/api/prisma/schema.prisma`, run `npm run db:migrate:dev -w @stabilitea/api -- --name <change>`,
and commit the generated migration folder.
