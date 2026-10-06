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
  sortOrder: number;
  archivedAt: string | null;
  /** Number of transactions recorded against this subcategory (all months). */
  transactionCount: number;
}

export interface CategoryDto {
  id: number;
  name: string;
  kind: CategoryKind;
  /** Expense only. true = carry leftover forward; false = sweep to savings. */
  rollover: boolean;
  sortOrder: number;
  archivedAt: string | null;
  subcategories: SubcategoryDto[];
}

export interface CreateCategoryRequest {
  name: string;
  kind: CategoryKind;
  rollover?: boolean;
}

export interface UpdateCategoryRequest {
  name?: string;
  rollover?: boolean;
  sortOrder?: number;
  archived?: boolean;
}

export interface CreateSubcategoryRequest {
  name: string;
  defaultLimitCents?: number;
}

export interface UpdateSubcategoryRequest {
  name?: string;
  /** Move to another category of the same kind. */
  categoryId?: number;
  defaultLimitCents?: number;
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
  limitCents: number;
  /** Leftover carried from last month. Negative when a rollover line carried a deficit. */
  carryInCents: number;
  /** Moved from savings this month to cover this line's deficit. */
  deficitPaidCents: number;
  /** limit + carryIn + deficitPaid: this month's budget. May be negative. */
  availableCents: number;
  /** Snapshot of the category flag for this month. */
  rollover: boolean;
  spentCents: number;
  /** available - spent */
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
  rollover: boolean;
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
  /** Moved from savings to cover deficits this month. */
  deficitPaidCents: number;
  /** Earliest budgeted month before this one that is still open, if any. */
  earliestOpenPastMonth: string | null;
  categories: CategorySummary[];
}

// ---------------------------------------------------------------------------
// Savings
// ---------------------------------------------------------------------------

export type SavingsEntryKind = 'sweep' | 'deficit_payment';

export interface SavingsEntryDto {
  id: number;
  /** 'sweep' adds leftovers when a month closes; 'deficit_payment' withdraws to cover a deficit. */
  kind: SavingsEntryKind;
  month: string;
  subcategoryId: number | null;
  subcategoryName: string | null;
  categoryName: string | null;
  /** Positive for sweeps, negative for deficit payments. */
  amountCents: number;
  createdAt: string;
}

export interface SavingsDto {
  balanceCents: number;
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
  schemaVersion: 1;
  exportedAt: string;
  categories: unknown[];
  subcategories: unknown[];
  budgetMonths: unknown[];
  budgetLines: unknown[];
  transactions: unknown[];
  savingsEntries: unknown[];
}
