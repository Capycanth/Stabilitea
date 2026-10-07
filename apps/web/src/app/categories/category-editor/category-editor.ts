import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { form, FormField, FormRoot, maxLength, required, type TreeValidationResult } from '@angular/forms/signals';
import type { CategoryDto, UpdateCategoryRequest } from '@stabilitea/shared';
import { errorMessage, toApiError } from '../../shared/api-error';
import { Icon } from '../../shared/icon/icon';
import { MoneyInput } from '../../shared/money-input/money-input';
import { Notifier } from '../../shared/notifier';
import { CategoryApi } from '../category-api';

interface SubcategoryDraft {
  name: string;
  defaultLimitCents: number | null;
  fund: boolean;
}

/** Detail panel for a selected category. */
@Component({
  selector: 'app-category-editor',
  imports: [FormField, FormRoot, Icon, MoneyInput],
  templateUrl: './category-editor.html',
  styles: `
    :host { display: grid; gap: 18px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .eyebrow { font-size: 0.8rem; color: var(--st-ink-muted); font-weight: 600; }
    .nowrap { flex-wrap: nowrap; }
    .sub-form { padding-top: 16px; border-top: 1px solid var(--st-line); }
    .fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
    .grow { flex: 1 1 180px; }
    .limit { width: 150px; }
    .fund { min-height: 40px; }
  `,
})
export class CategoryEditor {
  private readonly api = inject(CategoryApi);
  private readonly notifier = inject(Notifier);

  readonly category = input.required<CategoryDto>();
  /** Position among all categories, for move up/down. */
  readonly index = input.required<number>();
  readonly count = input.required<number>();
  readonly changed = output<void>();

  protected readonly busy = signal(false);
  protected readonly isFirst = computed(() => this.index() === 0);
  protected readonly isLast = computed(() => this.index() >= this.count() - 1);

  protected readonly renameModel = linkedSignal(() => ({ name: this.category().name }));
  protected readonly renameForm = form(
    this.renameModel,
    (f) => {
      required(f.name, { message: 'Enter a name' });
      maxLength(f.name, 60, { message: 'Name must be 60 characters or fewer' });
    },
    { submission: { action: () => this.rename() } },
  );

  private readonly subModel = linkedSignal<number, SubcategoryDraft>({
    source: () => this.category().id,
    computation: () => ({ name: '', defaultLimitCents: 0, fund: false }),
  });
  protected readonly subForm = form(
    this.subModel,
    (f) => {
      required(f.name, { message: 'Enter a subcategory name' });
      maxLength(f.name, 60, { message: 'Name must be 60 characters or fewer' });
    },
    { submission: { action: () => this.addSubcategory() } },
  );

  protected move(delta: number): void {
    void this.update({ sortOrder: this.index() + delta }, `Moved ${this.category().name}.`);
  }

  protected toggleArchived(): void {
    const archived = !this.category().archivedAt;
    void this.update({ archived }, `${this.category().name} ${archived ? 'archived' : 'restored'}.`);
  }

  private async update(body: UpdateCategoryRequest, success: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.update(this.category().id, body);
      this.notifier.success(success);
      this.changed.emit();
    } catch (error) {
      this.notifier.error(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async rename(): Promise<TreeValidationResult> {
    try {
      await this.api.update(this.category().id, { name: this.renameModel().name.trim() });
      this.notifier.success('Category renamed.');
      this.changed.emit();
      return undefined;
    } catch (error) {
      const body = toApiError(error);
      return { kind: 'server', message: body.fieldErrors?.['name']?.[0] ?? body.message, fieldTree: this.renameForm.name };
    }
  }

  private async addSubcategory(): Promise<TreeValidationResult> {
    const { name, defaultLimitCents, fund } = this.subModel();
    try {
      const sub = await this.api.createSubcategory(this.category().id, {
        name: name.trim(),
        defaultLimitCents: defaultLimitCents ?? 0,
        fund: this.category().kind === 'expense' && fund,
      });
      this.subForm().reset({ name: '', defaultLimitCents: 0, fund: false });
      this.notifier.success(`Added ${sub.name}.`);
      this.changed.emit();
      return undefined;
    } catch (error) {
      const body = toApiError(error);
      return {
        kind: 'server',
        message: body.fieldErrors?.['name']?.[0] ?? body.fieldErrors?.['defaultLimitCents']?.[0] ?? body.message,
        fieldTree: this.subForm.name,
      };
    }
  }
}
