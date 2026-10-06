import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { form, FormField, FormRoot, maxLength, min, required, type TreeValidationResult } from '@angular/forms/signals';
import type { CategoryDto, SubcategoryDto, UpdateSubcategoryRequest } from '@stabilitea/shared';
import { errorMessage, toApiError } from '../shared/api-error';
import { Icon } from '../shared/icon';
import { MoneyInput } from '../shared/money-input';
import { Notifier } from '../shared/notifier';
import { CategoryApi } from './category-api';

interface SubcategoryModel {
  name: string;
  defaultLimitCents: number | null;
  categoryId: string;
}

/** Detail panel for a selected subcategory. */
@Component({
  selector: 'app-subcategory-editor',
  imports: [FormField, FormRoot, Icon, MoneyInput],
  template: `
    <div class="head">
      <div>
        <p class="eyebrow">Subcategory of {{ parent().name }}</p>
        <h2>{{ subcategory().name }}</h2>
      </div>
      @if (subcategory().archivedAt) {
        <span class="chip"><app-icon name="archive" [size]="13" />Archived</span>
      }
    </div>

    <form class="stack" novalidate [formRoot]="subForm">
      <div class="field">
        <label for="subcategory-name">Name</label>
        <input id="subcategory-name" class="input" type="text" autocomplete="off" [formField]="subForm.name" aria-describedby="subcategory-errors" />
      </div>
      @if (parent().kind === 'expense') {
        <div class="field limit">
          <label for="subcategory-limit">Default limit</label>
          <app-money-input inputId="subcategory-limit" describedBy="subcategory-limit-hint subcategory-errors" [formField]="subForm.defaultLimitCents" />
        </div>
      }
      <div class="field">
        <label for="subcategory-parent">Category</label>
        <select id="subcategory-parent" class="input" [formField]="subForm.categoryId">
          @for (option of moveTargets(); track option.id) {
            <option [value]="'' + option.id">{{ option.name }}</option>
          }
        </select>
      </div>
      <div id="subcategory-errors">
        @for (error of allErrors(); track $index) {
          <p class="field-error" role="alert">{{ error }}</p>
        }
      </div>
      <div>
        <button type="submit" class="btn btn-primary" [disabled]="subForm().submitting() || !dirty()">Save changes</button>
      </div>
    </form>

    @if (parent().kind === 'expense') {
      <div class="field">
        <label class="checkbox">
          <input type="checkbox" [checked]="subcategory().fund" [disabled]="busy()" (change)="toggleFund($event)" aria-describedby="fund-hint" />
          Fund (keeps its own balance)
        </label>
        <p id="fund-hint" class="hint">
          @if (subcategory().fund) {
            Each month its limit moves from savings into this fund, and whatever is left (or overspent) carries into next
            month. A deficit can be paid from savings on the Budget page.
          } @else {
            Spending comes straight out of savings when a month closes; the limit is a target.
          }
          Changes apply to open months only.
        </p>
      </div>
    }

    <div class="row">
      <button type="button" class="btn btn-sm" [disabled]="busy() || index() === 0" (click)="move(-1)">
        <app-icon name="arrow-up" [size]="16" />Move up
      </button>
      <button type="button" class="btn btn-sm" [disabled]="busy() || index() >= count() - 1" (click)="move(1)">
        <app-icon name="arrow-down" [size]="16" />Move down
      </button>
      <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="toggleArchived()">
        <app-icon name="archive" [size]="16" />{{ subcategory().archivedAt ? 'Unarchive' : 'Archive' }}
      </button>
    </div>
    <p class="hint">
      @if (subcategory().transactionCount > 0) {
        {{ subcategory().transactionCount }} transaction{{ subcategory().transactionCount === 1 ? '' : 's' }} recorded.
        Subcategories with transactions can be archived but not deleted.
      } @else {
        Archived subcategories are hidden from new budgets and the transaction form.
      }
    </p>
  `,
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
