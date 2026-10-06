/**
 * API contract shared by apps/api and apps/web.
 * All money is integer cents. Months are 'YYYY-MM'; dates are 'YYYY-MM-DD'.
 */

export type CategoryKind = 'income' | 'expense';
export type TransactionType = CategoryKind;
export type MonthStatus = 'open' | 'closed';

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface SubcategoryDto {
  id: number;
  categoryId: number;
  name: string;
  defaultLimitCents: number;
  /**
   * Expense only. true = a fund: it keeps its own balance, carried month to month (positive or negative).
   * false = regular: spending simply comes out of savings when the month closes.
   */
  fund: boolean;
  sortOrder: number;
  archivedAt: string | null;
  /** Number of transactions recorded against this subcategory (all months). */
  transactionCount: number;
}

export interface CategoryDto {
  id: number;
  name: string;
  kind: CategoryKind;
  sortOrder: number;
  archivedAt: string | null;
  subcategories: SubcategoryDto[];
}

export interface CreateCategoryRequest {
  name: string;
  kind: CategoryKind;
}

export interface UpdateCategoryRequest {
  name?: string;
  sortOrder?: number;
  archived?: boolean;
}

export interface CreateSubcategoryRequest {
  name: string;
  defaultLimitCents?: number;
  /** Expense subcategories only. */
  fund?: boolean;
}

export interface UpdateSubcategoryRequest {
  name?: string;
  /** Move to another category of the same kind. */
  categoryId?: number;
  defaultLimitCents?: number;
  /** Expense subcategories only. Open months follow the change; closed months keep their snapshot. */
  fund?: boolean;
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
  subcategoryId: number;
  subcategoryName: string;
  categoryId: number;
  categoryName: string;
  payee: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransactionRequest {
  date: string;
  type: TransactionType;
  amountCents: number;
  subcategoryId: number;
  payee?: string | null;
  note?: string | null;
}

export type UpdateTransactionRequest = Partial<CreateTransactionRequest>;

export interface TransactionFilters {
  type?: TransactionType;
  categoryId?: number;
  subcategoryId?: number;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export interface BudgetLineDto {
  id: number;
  month: string;
  subcategoryId: number;
  subcategoryName: string;
  /** Regular line: this month's spending target. Fund line: this month's contribution from savings. */
  limitCents: number;
  /** Fund balance brought in from last month. Negative when the fund carried a deficit. Always 0 for new regular lines. */
  carryInCents: number;
  /** Moved from savings this month to cover this fund's deficit. */
  deficitPaidCents: number;
  /** limit + carryIn + deficitPaid. May be negative. */
  availableCents: number;
  /** Snapshot of the subcategory's fund flag for this month. */
  fund: boolean;
  spentCents: number;
  /** available - spent. For a fund, its balance at the end of the month. */
  remainingCents: number;
}

export interface DeficitPaymentDto {
  /** Savings entry id. */
  id: number;
  month: string;
  budgetLineId: number | null;
  subcategoryId: number | null;
  subcategoryName: string | null;
  categoryName: string | null;
  /** Positive amount moved out of savings. */
  amountCents: number;
  createdAt: string;
}

export interface BudgetCategoryGroup {
  categoryId: number;
  categoryName: string;
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
  categories: BudgetCategoryGroup[];
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

export interface SubcategorySummary {
  id: number;
  name: string;
  fund: boolean;
  limitCents: number;
  carryInCents: number;
  deficitPaidCents: number;
  spentCents: number;
  /** limit + carryIn + deficitPaid - spent */
  remainingCents: number;
}

export interface CategorySummary {
  id: number;
  name: string;
  /** Sum of subcategory limits. */
  limitCents: number;
  /** Limits + carry-in + deficit paid. May be negative. */
  availableCents: number;
  deficitPaidCents: number;
  spentCents: number;
  subcategories: SubcategorySummary[];
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
  /** Moved from savings to cover fund deficits this month. */
  deficitPaidCents: number;
  /**
   * Net change to savings from this month: income − regular spending − fund contributions − deficits paid,
   * plus any balance a fund line hands back to savings (it was switched to regular). For an open month this is
   * the projection if it closed today.
   */
  savingsChangeCents: number;
  /** Earliest budgeted month before this one that is still open, if any. */
  earliestOpenPastMonth: string | null;
  categories: CategorySummary[];
}

// ---------------------------------------------------------------------------
// Savings
// ---------------------------------------------------------------------------

/**
 * Closing a month writes 'income' (+), 'spending' (− regular subcategories), 'fund_contribution' (− a fund's limit)
 * and 'fund_release' (± a fund balance that has no fund line to carry into). 'deficit_payment' (−) is written when
 * a fund's deficit is paid from savings.
 */
export type SavingsEntryKind = 'income' | 'spending' | 'fund_contribution' | 'fund_release' | 'deficit_payment';

export interface SavingsEntryDto {
  id: number;
  kind: SavingsEntryKind;
  month: string;
  subcategoryId: number | null;
  subcategoryName: string | null;
  categoryName: string | null;
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
  /** Paid from savings to cover fund deficits (positive number). */
  deficitPaidCents: number;
  /** Sum of the month's entries. */
  changeCents: number;
  /** Savings balance after this month's entries. */
  balanceAfterCents: number;
}

export interface FundBalanceDto {
  subcategoryId: number;
  subcategoryName: string;
  categoryName: string;
  /** Balance after the latest close, including deficits paid since. May be negative. */
  balanceCents: number;
}

export interface SavingsDto {
  /** Sum of all entries. May be negative. */
  balanceCents: number;
  /** Active funds and their balances. */
  funds: FundBalanceDto[];
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
  /** 2: funds on subcategories; savings ledger tracks income, spending and fund flows. */
  schemaVersion: 2;
  exportedAt: string;
  categories: unknown[];
  subcategories: unknown[];
  budgetMonths: unknown[];
  budgetLines: unknown[];
  transactions: unknown[];
  savingsEntries: unknown[];
}
