import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { apply, form, FormField, FormRoot, maxLength, required, type TreeValidationResult } from '@angular/forms/signals';
import type { GroupDto, UpdateGroupRequest } from '@stabilitea/shared';
import { errorMessage, toApiError } from '../../shared/api-error';
import { Icon } from '../../shared/icon/icon';
import { MoneyInput } from '../../shared/money-input/money-input';
import { Notifier } from '../../shared/notifier';
import {
  CategoryTypeFields,
  type CategoryTypeModel,
  categoryTypeRequest,
  categoryTypeSchema,
  emptyCategoryType,
} from '../category-type-fields/category-type-fields';
import { GroupApi } from '../group-api';

interface CategoryDraft {
  name: string;
  defaultLimitCents: number | null;
  typeFields: CategoryTypeModel;
}

const emptyDraft = (): CategoryDraft => ({ name: '', defaultLimitCents: 0, typeFields: emptyCategoryType() });

/** Detail panel for a selected group. */
@Component({
  selector: 'app-group-editor',
  imports: [CategoryTypeFields, FormField, FormRoot, Icon, MoneyInput],
  templateUrl: './group-editor.html',
  styles: `
    :host { display: grid; gap: 18px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .eyebrow { font-size: 0.8rem; color: var(--st-ink-muted); font-weight: 600; }
    .nowrap { flex-wrap: nowrap; }
    .category-form { padding-top: 16px; border-top: 1px solid var(--st-line); }
    .fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
    .grow { flex: 1 1 180px; }
    .limit { width: 150px; }
  `,
})
export class GroupEditor {
  private readonly api = inject(GroupApi);
  private readonly notifier = inject(Notifier);

  readonly group = input.required<GroupDto>();
  /** Position among all groups, for move up/down. */
  readonly index = input.required<number>();
  readonly count = input.required<number>();
  readonly changed = output<void>();

  protected readonly busy = signal(false);
  protected readonly isFirst = computed(() => this.index() === 0);
  protected readonly isLast = computed(() => this.index() >= this.count() - 1);

  protected readonly renameModel = linkedSignal(() => ({ name: this.group().name }));
  protected readonly renameForm = form(
    this.renameModel,
    (f) => {
      required(f.name, { message: 'Enter a name' });
      maxLength(f.name, 60, { message: 'Name must be 60 characters or fewer' });
    },
    { submission: { action: () => this.rename() } },
  );

  private readonly categoryModel = linkedSignal<number, CategoryDraft>({
    source: () => this.group().id,
    computation: emptyDraft,
  });
  protected readonly categoryForm = form(
    this.categoryModel,
    (f) => {
      required(f.name, { message: 'Enter a category name' });
      maxLength(f.name, 60, { message: 'Name must be 60 characters or fewer' });
      apply(f.typeFields, categoryTypeSchema);
    },
    { submission: { action: () => this.addCategory() } },
  );
  protected readonly draftIsRecurring = computed(() => this.categoryModel().typeFields.type === 'recurring');

  protected move(delta: number): void {
    void this.update({ sortOrder: this.index() + delta }, `Moved ${this.group().name}.`);
  }

  protected toggleArchived(): void {
    const archived = !this.group().archivedAt;
    void this.update({ archived }, `${this.group().name} ${archived ? 'archived' : 'restored'}.`);
  }

  private async update(body: UpdateGroupRequest, success: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.update(this.group().id, body);
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
      await this.api.update(this.group().id, { name: this.renameModel().name.trim() });
      this.notifier.success('Group renamed.');
      this.changed.emit();
      return undefined;
    } catch (error) {
      const body = toApiError(error);
      return { kind: 'server', message: body.fieldErrors?.['name']?.[0] ?? body.message, fieldTree: this.renameForm.name };
    }
  }

  private async addCategory(): Promise<TreeValidationResult> {
    const { name, defaultLimitCents, typeFields } = this.categoryModel();
    try {
      const category = await this.api.createCategory(this.group().id, {
        name: name.trim(),
        defaultLimitCents: defaultLimitCents ?? 0,
        ...(this.group().kind === 'expense' ? categoryTypeRequest(typeFields) : {}),
      });
      this.categoryForm().reset(emptyDraft());
      this.notifier.success(`Added ${category.name}.`);
      this.changed.emit();
      return undefined;
    } catch (error) {
      const body = toApiError(error);
      return {
        kind: 'server',
        message: Object.values(body.fieldErrors ?? {})[0]?.[0] ?? body.message,
        fieldTree: this.categoryForm.name,
      };
    }
  }
}
