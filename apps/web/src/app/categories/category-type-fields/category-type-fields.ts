import { Component, computed, input } from '@angular/core';
import { applyWhen, type FieldTree, FormField, max, min, pattern, required, schema } from '@angular/forms/signals';
import { type CategoryType, MAX_BILL_MONTHS, monthLabel } from '@stabilitea/shared';
import { MoneyPipe } from '../../shared/money-pipe';
import { MoneyInput } from '../../shared/money-input/money-input';

/** Form model for a category's type and recurring bill. */
export interface CategoryTypeModel {
  type: CategoryType;
  billCents: number | null;
  billMonths: number | null;
  /** 'YYYY-MM', or '' when not set. */
  nextDueMonth: string;
}

export const emptyCategoryType = (): CategoryTypeModel => ({
  type: 'standard',
  billCents: null,
  billMonths: null,
  nextDueMonth: '',
});

/** The bill fields are required only for recurring categories. */
export const categoryTypeSchema = schema<CategoryTypeModel>((f) => {
  applyWhen(f, ({ valueOf }) => valueOf(f.type) === 'recurring', (r) => {
    required(r.billCents, { message: 'Enter the bill amount' });
    min(r.billCents, 1, { message: 'Bill amount must be greater than $0' });
    required(r.billMonths, { message: 'Enter how many months the bill covers' });
    min(r.billMonths, 1, { message: 'Months must be at least 1' });
    max(r.billMonths, MAX_BILL_MONTHS, { message: `Months must be ${MAX_BILL_MONTHS} or fewer` });
    required(r.nextDueMonth, { message: 'Choose the month the bill is next due' });
    pattern(r.nextDueMonth, /^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Choose a valid month' });
  });
});

/** The request fields for a type model: bill fields only for recurring. */
export function categoryTypeRequest(model: CategoryTypeModel) {
  return model.type === 'recurring'
    ? { type: model.type, billCents: model.billCents ?? 0, billMonths: model.billMonths ?? 0, nextDueMonth: model.nextDueMonth }
    : { type: model.type };
}

const HINTS: Record<CategoryType, string> = {
  standard: 'Spending comes straight out of savings when a month closes; the limit is a target.',
  fund:
    'Keeps its own balance. Each month its limit moves from savings into the fund, and whatever is left (or overspent) carries into next month.',
  recurring:
    'For a bill that comes every few months. Each month stores an even share of it from savings, and the bill is paid from the stored money. Any leftover or shortfall settles with savings.',
};

/** Category type dropdown plus the recurring bill fields. Expense categories only. */
@Component({
  selector: 'app-category-type-fields',
  imports: [FormField, MoneyInput, MoneyPipe],
  templateUrl: './category-type-fields.html',
  styles: `
    :host { display: grid; gap: 14px; }
    .type select { max-width: 220px; }
    .bill { display: grid; gap: 10px; margin: 0; padding: 12px 14px 14px; border: 1px solid var(--st-line); border-radius: 12px; }
    .bill legend { padding: 0 6px; font-weight: 600; font-size: 0.9rem; }
    .bill-fields { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
    .bill-fields .field { flex: 1 1 140px; }
    .bill-fields .months { flex: 0 1 120px; }
  `,
})
export class CategoryTypeFields {
  readonly fields = input.required<FieldTree<CategoryTypeModel>>();
  /** Prefix for element ids, unique on the page. */
  readonly idPrefix = input.required<string>();

  protected readonly isRecurring = computed(() => this.fields().type().value() === 'recurring');
  protected readonly hint = computed(() => HINTS[this.fields().type().value()]);

  protected readonly preview = computed(() => {
    const { billCents, billMonths, nextDueMonth } = this.fields()().value();
    if (!billCents || !billMonths || billMonths < 1 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(nextDueMonth)) return null;
    return { share: Math.ceil(billCents / billMonths), bill: billCents, due: monthLabel(nextDueMonth) };
  });

  /** Errors show once a field is touched (or after a submit attempt touches them). */
  protected readonly billErrors = computed(() => {
    const f = this.fields();
    return [f.billCents, f.billMonths, f.nextDueMonth].flatMap((field) =>
      field().touched() ? field().errors().map((e) => e.message ?? '') : [],
    );
  });
}
