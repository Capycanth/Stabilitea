import type { RecurringStatus } from './recurring.js';

/**
 * API contract shared by apps/api and apps/web.
 * All money is integer cents. Months are 'YYYY-MM'; dates are 'YYYY-MM-DD'.
 */

export type GroupKind = 'income' | 'expense';
export type TransactionType = GroupKind;
export type MonthStatus = 'open' | 'closed';

/**
 * How an expense category handles money (income categories are always 'standard').
 * - standard: spending comes out of savings when the month closes; the limit is a target.
 * - fund: keeps its own balance month to month (positive or negative); the limit is moved in from savings each month.
 * - recurring: a bill of `billCents` due every `billMonths` months. Each month stores a share of the bill (taken out of
 *   savings at close); the payment is made from the stored money and any leftover or shortfall settles with savings.
 */
export type CategoryType = 'standard' | 'fund' | 'recurring';

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export interface CategoryDto {
  id: number;
  groupId: number;
  name: string;
  defaultLimitCents: number;
  type: CategoryType;
  /** Recurring bill amount. Set for recurring categories (kept, but unused, after switching away). */
  billCents: number | null;
  /** Months the bill covers (it's due once every this many months). */
  billMonths: number | null;
  /** 'YYYY-MM' the bill is next due. Moves on a cycle when a closed month records the payment. */
  nextDueMonth: string | null;
  sortOrder: number;
  archivedAt: string | null;
  /** Number of transactions recorded against this category (all months). */
  transactionCount: number;
  /**
   * True when the category can be permanently deleted: it (or its group) is archived and it was never used — no
   * transactions, no savings entries and no lines in closed months.
   */
  deletable: boolean;
}

export interface GroupDto {
  id: number;
  name: string;
  kind: GroupKind;
  sortOrder: number;
  archivedAt: string | null;
  categories: CategoryDto[];
  /** True when the group is archived and every category in it was never used, so it can be permanently deleted. */
  deletable: boolean;
}

export interface CreateGroupRequest {
  name: string;
  kind: GroupKind;
}

export interface UpdateGroupRequest {
  name?: string;
  sortOrder?: number;
  archived?: boolean;
}

/** Recurring bill settings. All three are required when a category becomes recurring. */
export interface RecurringBillFields {
  billCents?: number;
  billMonths?: number;
  nextDueMonth?: string;
}

export interface CreateCategoryRequest extends RecurringBillFields {
  name: string;
  defaultLimitCents?: number;
  /** Fund and recurring are for expense categories only. Default 'standard'. */
  type?: CategoryType;
}

export interface UpdateCategoryRequest extends RecurringBillFields {
  name?: string;
  /** Move to another group of the same kind. */
  groupId?: number;
  defaultLimitCents?: number;
  /** Fund and recurring are for expense categories only. Open months follow the change; closed months keep theirs. */
  type?: CategoryType;
  sortOrder?: number;
  archived?: boolean;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface TransactionDto {
  id: number;
  date: string;
  type: TransactionType;
  amountCents: number;
  categoryId: number;
  categoryName: string;
  groupId: number;
  groupName: string;
  payee: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransactionRequest {
  date: string;
  type: TransactionType;
  amountCents: number;
  categoryId: number;
  payee?: string | null;
  note?: string | null;
}

export type UpdateTransactionRequest = Partial<CreateTransactionRequest>;

export interface TransactionFilters {
  type?: TransactionType;
  groupId?: number;
  categoryId?: number;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** A recurring line's bill as of its month (snapshot; closed months keep theirs). */
export interface RecurringLineInfo {
  billCents: number;
  billMonths: number;
  /** Due month of the cycle this month belongs to. */
  dueMonth: string;
  status: RecurringStatus;
}

export interface BudgetLineDto {
  id: number;
  month: string;
  categoryId: number;
  categoryName: string;
  /**
   * Standard: this month's spending target. Fund: this month's contribution from savings. Recurring: this month's
   * share of the bill, calculated (not editable) and stored at close.
   */
  limitCents: number;
  /**
   * Fund: balance brought in from last month (negative for a carried deficit). Recurring: money already stored for
   * the bill. 0 for standard lines.
   */
  carryInCents: number;
  /** Moved from savings this month to cover this fund's deficit. */
  deficitPaidCents: number;
  /** limit + carryIn + deficitPaid. May be negative. */
  availableCents: number;
  /** Snapshot of the category's type for this month. */
  type: CategoryType;
  /** Set for recurring lines. */
  recurring: RecurringLineInfo | null;
  spentCents: number;
  /**
   * available − spent. Fund: its balance at the end of the month. Recurring: stored after this month, or once paid,
   * the leftover (positive) or shortfall (negative) that settles with savings at close.
   */
  remainingCents: number;
  /**
   * The category or its group is archived. Open months drop archived lines unless they still hold money or
   * spending, which has to settle at close; those stay and are flagged.
   */
  archived: boolean;
}

export interface DeficitPaymentDto {
  /** Savings entry id. */
  id: number;
  month: string;
  budgetLineId: number | null;
  categoryId: number | null;
  categoryName: string | null;
  groupName: string | null;
  /** Positive amount moved out of savings. */
  amountCents: number;
  createdAt: string;
}

export interface BudgetGroup {
  groupId: number;
  groupName: string;
  lines: BudgetLineDto[];
}

export interface BudgetMonthDto {
  month: string;
  status: MonthStatus;
  plannedIncomeCents: number;
  closedAt: string | null;
  /** True when the month is closed and the following month is not closed. */
  canReopen: boolean;
  /** True when the month is open and the following month is not closed. */
  canClose: boolean;
  /** Current savings balance, available for paying deficits. */
  savingsBalanceCents: number;
  /** Sum of deficit payments recorded on this month. */
  deficitPaidCents: number;
  groups: BudgetGroup[];
  /** Deficit payments recorded on this month, oldest first. */
  deficitPayments: DeficitPaymentDto[];
}

export interface UpdateBudgetMonthRequest {
  plannedIncomeCents: number;
}

export interface UpdateBudgetLineRequest {
  limitCents: number;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface CategorySummary {
  id: number;
  name: string;
  type: CategoryType;
  /** Set for recurring lines. */
  recurring: RecurringLineInfo | null;
  limitCents: number;
  carryInCents: number;
  deficitPaidCents: number;
  spentCents: number;
  /** limit + carryIn + deficitPaid - spent */
  remainingCents: number;
}

export interface GroupSummary {
  id: number;
  name: string;
  /** Sum of category limits. */
  limitCents: number;
  /** Limits + carry-in + deficit paid. May be negative. */
  availableCents: number;
  deficitPaidCents: number;
  spentCents: number;
  categories: CategorySummary[];
}

export interface MonthSummary {
  month: string;
  status: MonthStatus;
  plannedIncomeCents: number;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  /** Sum of fund limits: what closing moves from savings into funds. */
  fundContributionCents: number;
  /** Sum of recurring shares: what closing stores from savings for recurring bills. */
  recurringStoredCents: number;
  /** Moved from savings to cover fund deficits this month. */
  deficitPaidCents: number;
  /**
   * Net change to savings from this month: income − standard spending − fund contributions − recurring shares −
   * deficits paid, plus releases (a recurring bill's leftover or shortfall once paid, or a balance a category hands
   * back after changing type). For an open month this is the projection if it closed today.
   */
  savingsChangeCents: number;
  /** Earliest budgeted month before this one that is still open, if any. */
  earliestOpenPastMonth: string | null;
  groups: GroupSummary[];
}

// ---------------------------------------------------------------------------
// Savings
// ---------------------------------------------------------------------------

/**
 * Closing a month writes 'income' (+), 'spending' (− standard categories), 'fund_contribution' (− a fund's limit),
 * 'fund_release' (± a fund balance that has no fund line to carry into), 'recurring_store' (− a recurring bill's
 * share) and 'recurring_release' (± what's left of the stored money once the bill is paid, or all of it when the
 * category stops being recurring). 'deficit_payment' (−) is written when a fund's deficit is paid from savings.
 */
export type SavingsEntryKind =
  | 'income'
  | 'spending'
  | 'fund_contribution'
  | 'fund_release'
  | 'recurring_store'
  | 'recurring_release'
  | 'deficit_payment';

export interface SavingsEntryDto {
  id: number;
  kind: SavingsEntryKind;
  month: string;
  categoryId: number | null;
  categoryName: string | null;
  groupName: string | null;
  /** Positive adds to savings, negative takes from it. */
  amountCents: number;
  createdAt: string;
}

export interface SavingsMonthDto {
  month: string;
  incomeCents: number;
  /** Regular spending (positive number). */
  spendingCents: number;
  /** Moved into funds (positive number). */
  fundContributionCents: number;
  /** Fund balances handed back to savings (may be negative). */
  fundReleaseCents: number;
  /** Stored for recurring bills (positive number). */
  recurringStoredCents: number;
  /** Recurring leftovers (+) and shortfalls (−) settled with savings once bills were paid. */
  recurringReleaseCents: number;
  /** Paid from savings to cover fund deficits (positive number). */
  deficitPaidCents: number;
  /** Sum of the month's entries. */
  changeCents: number;
  /** Savings balance after this month's entries. */
  balanceAfterCents: number;
}

export interface FundBalanceDto {
  categoryId: number;
  categoryName: string;
  groupName: string;
  /** Balance after the latest close, including deficits paid since. May be negative. */
  balanceCents: number;
}

export interface RecurringBalanceDto {
  categoryId: number;
  categoryName: string;
  groupName: string;
  billCents: number;
  billMonths: number;
  /** The cycle the stored money is for. */
  dueMonth: string;
  /** Stored after the latest close. */
  storedCents: number;
}

export interface SavingsDto {
  /** Sum of all entries. May be negative. */
  balanceCents: number;
  /** Active funds and their balances. */
  funds: FundBalanceDto[];
  /** Active recurring bills and the money stored for them. */
  recurring: RecurringBalanceDto[];
  /** Per-month totals, newest first. */
  months: SavingsMonthDto[];
  /** Newest month first. */
  entries: SavingsEntryDto[];
}

// ---------------------------------------------------------------------------
// Errors & export
// ---------------------------------------------------------------------------

export type ApiErrorCode = 'VALIDATION_FAILED' | 'MONTH_CLOSED' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';

export interface ApiErrorBody {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  /** Field name → messages. Present for VALIDATION_FAILED. */
  fieldErrors?: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportYearsDto {
  /** Years with budget months or transactions, newest first. */
  years: number[];
}

export interface ExportDto {
  app: 'stabilitea';
  /** 3: groups and categories (renamed from categories and subcategories); category type with recurring bills. */
  schemaVersion: 3;
  exportedAt: string;
  groups: unknown[];
  categories: unknown[];
  budgetMonths: unknown[];
  budgetLines: unknown[];
  transactions: unknown[];
  savingsEntries: unknown[];
}
