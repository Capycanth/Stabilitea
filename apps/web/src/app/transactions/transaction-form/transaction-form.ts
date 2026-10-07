import { Component, computed, type ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import {
  form,
  FormField,
  FormRoot,
  maxLength,
  min,
  required,
  type TreeValidationResult,
  validate,
  type ValidationError,
} from '@angular/forms/signals';
import type { CategoryDto, TransactionDto, TransactionType } from '@stabilitea/shared';
import { isValidDate, monthOf } from '@stabilitea/shared';
import { toApiError } from '../../shared/api-error';
import { closeDialog, openDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { Icon } from '../../shared/icon/icon';
import { MoneyInput } from '../../shared/money-input/money-input';
import { currentMonth, monthLabel, today } from '../../shared/month';
import { TransactionApi } from '../transaction-api';

export interface TransactionModel {
  date: string;
  /** Integer cents; the input shows dollars. */
  amountCents: number | null;
  /** Select value: '' or a subcategory id. */
  subcategoryId: string;
  payee: string;
  note: string;
}

function emptyModel(month: string): TransactionModel {
  return {
    date: month === currentMonth() ? today() : `${month}-01`,
    amountCents: null,
    subcategoryId: '',
    payee: '',
    note: '',
  };
}

@Component({
  selector: 'app-transaction-form',
  imports: [FormField, FormRoot, MoneyInput, Icon],
  templateUrl: './transaction-form.html',
  styles: `
    .title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
  `,
})
export class TransactionForm {
  private readonly api = inject(TransactionApi);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  readonly month = input.required<string>();
  readonly categories = input.required<CategoryDto[]>();
  readonly saved = output<TransactionDto>();

  protected readonly editing = signal<TransactionDto | null>(null);
  protected readonly formError = signal<string | null>(null);
  private returnFocus: HTMLElement | null = null;

  private readonly model = signal<TransactionModel>(emptyModel(currentMonth()));

  protected readonly activeCategories = computed(() =>
    this.categories()
      .filter((c) => !c.archivedAt)
      .map((c) => ({ ...c, subcategories: c.subcategories.filter((s) => !s.archivedAt || this.isCurrentSub(s.id)) }))
      .filter((c) => c.subcategories.length > 0),
  );

  private readonly kindBySubcategory = computed(() => {
    const map = new Map<string, TransactionType>();
    for (const category of this.categories()) {
      for (const sub of category.subcategories) map.set(String(sub.id), category.kind);
    }
    return map;
  });

  /** `type` is inferred from the chosen subcategory's category kind. */
  protected readonly inferredType = computed(() => this.kindBySubcategory().get(this.model().subcategoryId) ?? null);

  protected readonly txForm = form(
    this.model,
    (f) => {
      required(f.date, { message: 'Choose a date' });
      validate(f.date, ({ value }) =>
        value() && !isValidDate(value()) ? { kind: 'date', message: 'Enter a valid date' } : undefined,
      );
      required(f.amountCents, { message: 'Enter an amount' });
      min(f.amountCents, 1, { message: 'Amount must be greater than 0' });
      required(f.subcategoryId, { message: 'Choose a category' });
      maxLength(f.payee, 120, { message: 'Payee must be 120 characters or fewer' });
      maxLength(f.note, 500, { message: 'Note must be 500 characters or fewer' });
    },
    {
      submission: {
        action: async (): Promise<TreeValidationResult> => this.save(),
      },
    },
  );

  /** Opens the dialog for a new transaction, or to edit an existing one. */
  open(transaction: TransactionDto | null = null): void {
    const doc = this.dialog().nativeElement.ownerDocument;
    this.returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    this.editing.set(transaction);
    this.formError.set(null);
    const next: TransactionModel = transaction
      ? {
          date: transaction.date,
          amountCents: transaction.amountCents,
          subcategoryId: String(transaction.subcategoryId),
          payee: transaction.payee ?? '',
          note: transaction.note ?? '',
        }
      : emptyModel(this.month());
    this.txForm().reset(next);
    openDialog(this.dialog().nativeElement);
  }

  close(): void {
    closeDialog(this.dialog().nativeElement);
  }

  protected onDialogClosed(): void {
    this.returnFocus?.focus();
    this.returnFocus = null;
  }

  protected showErrors(touched: boolean, invalid: boolean): boolean {
    return touched && invalid;
  }

  private isCurrentSub(id: number): boolean {
    return this.editing()?.subcategoryId === id;
  }

  private async save(): Promise<TreeValidationResult> {
    this.formError.set(null);
    const value = this.model();
    const type = this.inferredType();
    if (type === null || value.amountCents === null) return undefined;

    const body = {
      date: value.date,
      type,
      amountCents: value.amountCents,
      subcategoryId: Number(value.subcategoryId),
      payee: value.payee.trim() || null,
      note: value.note.trim() || null,
    };

    try {
      const current = this.editing();
      const result = current ? await this.api.update(current.id, body) : await this.api.create(body);
      this.saved.emit(result);
      this.close();
      return undefined;
    } catch (error) {
      return this.mapServerErrors(error, value.date);
    }
  }

  /** Maps API 400 field errors onto the form; other errors show above the form. */
  private mapServerErrors(error: unknown, date: string): TreeValidationResult {
    const body = toApiError(error);
    if (body.code === 'MONTH_CLOSED') {
      this.formError.set(`${monthLabel(monthOf(date))} is closed. Reopen it on the Budget page to make changes.`);
      return undefined;
    }
    if (!body.fieldErrors) {
      this.formError.set(body.message);
      return undefined;
    }
    const f = this.txForm;
    const targets = {
      date: f.date,
      amountCents: f.amountCents,
      subcategoryId: f.subcategoryId,
      type: f.subcategoryId,
      payee: f.payee,
      note: f.note,
    } as const;
    const errors: ValidationError.WithOptionalFieldTree[] = [];
    for (const [field, messages] of Object.entries(body.fieldErrors)) {
      const target = targets[field as keyof typeof targets];
      if (!target) {
        this.formError.set(messages[0] ?? body.message);
        continue;
      }
      for (const message of messages) errors.push({ kind: 'server', message, fieldTree: target });
    }
    return errors;
  }
}
