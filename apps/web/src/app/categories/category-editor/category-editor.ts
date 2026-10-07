import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { apply, form, FormField, FormRoot, maxLength, min, required, type TreeValidationResult } from '@angular/forms/signals';
import type { GroupDto, CategoryDto, UpdateCategoryRequest } from '@stabilitea/shared';
import { errorMessage, toApiError } from '../../shared/api-error';
import { Icon } from '../../shared/icon/icon';
import { MoneyInput } from '../../shared/money-input/money-input';
import { Notifier } from '../../shared/notifier';
import {
  CategoryTypeFields,
  type CategoryTypeModel,
  categoryTypeRequest,
  categoryTypeSchema,
} from '../category-type-fields/category-type-fields';
import { GroupApi } from '../group-api';

interface CategoryModel {
  name: string;
  defaultLimitCents: number | null;
  groupId: string;
  typeFields: CategoryTypeModel;
}

function typeModel(category: CategoryDto): CategoryTypeModel {
  return {
    type: category.type,
    billCents: category.billCents,
    billMonths: category.billMonths,
    nextDueMonth: category.nextDueMonth ?? '',
  };
}

const TYPE_LABEL = { standard: 'a standard category', fund: 'a fund', recurring: 'a recurring bill' } as const;

/** Detail panel for a selected category. */
@Component({
  selector: 'app-category-editor',
  imports: [CategoryTypeFields, FormField, FormRoot, Icon, MoneyInput],
  templateUrl: './category-editor.html',
  styles: `
    :host { display: grid; gap: 18px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .eyebrow { font-size: 0.8rem; color: var(--st-ink-muted); font-weight: 600; }
    .limit { max-width: 200px; }
  `,
})
export class CategoryEditor {
  private readonly api = inject(GroupApi);
  private readonly notifier = inject(Notifier);

  readonly category = input.required<CategoryDto>();
  readonly parent = input.required<GroupDto>();
  readonly groups = input.required<GroupDto[]>();
  readonly index = input.required<number>();
  readonly count = input.required<number>();
  readonly changed = output<void>();

  protected readonly busy = signal(false);

  protected readonly moveTargets = computed(() =>
    this.groups().filter((c) => c.kind === this.parent().kind && (!c.archivedAt || c.id === this.parent().id)),
  );

  private readonly model = linkedSignal<CategoryDto, CategoryModel>({
    source: () => this.category(),
    computation: (category) => ({
      name: category.name,
      defaultLimitCents: category.defaultLimitCents,
      groupId: String(category.groupId),
      typeFields: typeModel(category),
    }),
  });

  protected readonly categoryForm = form(
    this.model,
    (f) => {
      required(f.name, { message: 'Enter a name' });
      maxLength(f.name, 60, { message: 'Name must be 60 characters or fewer' });
      required(f.defaultLimitCents, { message: 'Enter a default limit (0 for none)' });
      min(f.defaultLimitCents, 0, { message: 'Default limit cannot be negative' });
      apply(f.typeFields, categoryTypeSchema);
    },
    { submission: { action: () => this.save() } },
  );

  protected readonly dirty = computed(() => {
    const m = this.model();
    const s = this.category();
    const t = m.typeFields;
    const saved = typeModel(s);
    const typeChanged =
      t.type !== saved.type ||
      (t.type === 'recurring' &&
        (t.billCents !== saved.billCents || t.billMonths !== saved.billMonths || t.nextDueMonth !== saved.nextDueMonth));
    return m.name !== s.name || m.defaultLimitCents !== s.defaultLimitCents || m.groupId !== String(s.groupId) || typeChanged;
  });

  protected readonly isRecurring = computed(() => this.model().typeFields.type === 'recurring');

  protected readonly allErrors = computed(() => [
    ...this.categoryForm.name().errors().map((e) => e.message ?? ''),
    ...this.categoryForm.defaultLimitCents().errors().map((e) => e.message ?? ''),
    ...this.categoryForm.groupId().errors().map((e) => e.message ?? ''),
  ]);

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
      await this.api.updateCategory(this.category().id, body);
      this.notifier.success(success);
      this.changed.emit();
    } catch (error) {
      this.notifier.error(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async save(): Promise<TreeValidationResult> {
    const { name, defaultLimitCents, groupId, typeFields } = this.model();
    const typeChanged = typeFields.type !== this.category().type;
    try {
      await this.api.updateCategory(this.category().id, {
        name: name.trim(),
        defaultLimitCents: defaultLimitCents ?? 0,
        groupId: Number(groupId),
        ...(this.parent().kind === 'expense' ? categoryTypeRequest(typeFields) : {}),
      });
      this.notifier.success(typeChanged ? `${name.trim()} is now ${TYPE_LABEL[typeFields.type]}.` : 'Category saved.');
      this.changed.emit();
      return undefined;
    } catch (error) {
      const body = toApiError(error);
      const fields = body.fieldErrors ?? {};
      const targets = {
        name: this.categoryForm.name,
        defaultLimitCents: this.categoryForm.defaultLimitCents,
        groupId: this.categoryForm.groupId,
        type: this.categoryForm.typeFields.type,
        billCents: this.categoryForm.typeFields.billCents,
        billMonths: this.categoryForm.typeFields.billMonths,
        nextDueMonth: this.categoryForm.typeFields.nextDueMonth,
      } as const;
      const errors = Object.entries(fields).flatMap(([field, messages]) =>
        messages.map((message) => ({
          kind: 'server',
          message,
          fieldTree: targets[field as keyof typeof targets] ?? this.categoryForm.name,
        })),
      );
      return errors.length ? errors : { kind: 'server', message: body.message, fieldTree: this.categoryForm.name };
    }
  }
}
