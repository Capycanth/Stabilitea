import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { form, FormField, FormRoot, maxLength, min, required, type TreeValidationResult } from '@angular/forms/signals';
import type { CategoryDto, SubcategoryDto, UpdateSubcategoryRequest } from '@stabilitea/shared';
import { errorMessage, toApiError } from '../../shared/api-error';
import { Icon } from '../../shared/icon/icon';
import { MoneyInput } from '../../shared/money-input/money-input';
import { Notifier } from '../../shared/notifier';
import { CategoryApi } from '../category-api';

interface SubcategoryModel {
  name: string;
  defaultLimitCents: number | null;
  categoryId: string;
}

/** Detail panel for a selected subcategory. */
@Component({
  selector: 'app-subcategory-editor',
  imports: [FormField, FormRoot, Icon, MoneyInput],
  templateUrl: './subcategory-editor.html',
  styles: `
    :host { display: grid; gap: 18px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .eyebrow { font-size: 0.8rem; color: var(--st-ink-muted); font-weight: 600; }
    .limit { max-width: 200px; }
  `,
})
export class SubcategoryEditor {
  private readonly api = inject(CategoryApi);
  private readonly notifier = inject(Notifier);

  readonly subcategory = input.required<SubcategoryDto>();
  readonly parent = input.required<CategoryDto>();
  readonly categories = input.required<CategoryDto[]>();
  readonly index = input.required<number>();
  readonly count = input.required<number>();
  readonly changed = output<void>();

  protected readonly busy = signal(false);

  protected readonly moveTargets = computed(() =>
    this.categories().filter((c) => c.kind === this.parent().kind && (!c.archivedAt || c.id === this.parent().id)),
  );

  private readonly model = linkedSignal<SubcategoryDto, SubcategoryModel>({
    source: () => this.subcategory(),
    computation: (sub) => ({
      name: sub.name,
      defaultLimitCents: sub.defaultLimitCents,
      categoryId: String(sub.categoryId),
    }),
  });

  protected readonly subForm = form(
    this.model,
    (f) => {
      required(f.name, { message: 'Enter a name' });
      maxLength(f.name, 60, { message: 'Name must be 60 characters or fewer' });
      required(f.defaultLimitCents, { message: 'Enter a default limit (0 for none)' });
      min(f.defaultLimitCents, 0, { message: 'Default limit cannot be negative' });
    },
    { submission: { action: () => this.save() } },
  );

  protected readonly dirty = computed(() => {
    const m = this.model();
    const s = this.subcategory();
    return m.name !== s.name || m.defaultLimitCents !== s.defaultLimitCents || m.categoryId !== String(s.categoryId);
  });

  protected readonly allErrors = computed(() => [
    ...this.subForm.name().errors().map((e) => e.message ?? ''),
    ...this.subForm.defaultLimitCents().errors().map((e) => e.message ?? ''),
    ...this.subForm.categoryId().errors().map((e) => e.message ?? ''),
  ]);

  protected toggleFund(event: Event): void {
    const fund = (event.target as HTMLInputElement).checked;
    const name = this.subcategory().name;
    void this.update({ fund }, fund ? `${name} is now a fund.` : `${name} is now a regular subcategory.`);
  }

  protected move(delta: number): void {
    void this.update({ sortOrder: this.index() + delta }, `Moved ${this.subcategory().name}.`);
  }

  protected toggleArchived(): void {
    const archived = !this.subcategory().archivedAt;
    void this.update({ archived }, `${this.subcategory().name} ${archived ? 'archived' : 'restored'}.`);
  }

  private async update(body: UpdateSubcategoryRequest, success: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.updateSubcategory(this.subcategory().id, body);
      this.notifier.success(success);
      this.changed.emit();
    } catch (error) {
      this.notifier.error(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async save(): Promise<TreeValidationResult> {
    const { name, defaultLimitCents, categoryId } = this.model();
    try {
      await this.api.updateSubcategory(this.subcategory().id, {
        name: name.trim(),
        defaultLimitCents: defaultLimitCents ?? 0,
        categoryId: Number(categoryId),
      });
      this.notifier.success('Subcategory saved.');
      this.changed.emit();
      return undefined;
    } catch (error) {
      const body = toApiError(error);
      const fields = body.fieldErrors ?? {};
      const targets = {
        name: this.subForm.name,
        defaultLimitCents: this.subForm.defaultLimitCents,
        categoryId: this.subForm.categoryId,
      } as const;
      const errors = Object.entries(fields).flatMap(([field, messages]) =>
        messages.map((message) => ({
          kind: 'server',
          message,
          fieldTree: targets[field as keyof typeof targets] ?? this.subForm.name,
        })),
      );
      return errors.length ? errors : { kind: 'server', message: body.message, fieldTree: this.subForm.name };
    }
  }
}
