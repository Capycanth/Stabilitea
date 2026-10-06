import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { form, FormField, FormRoot, maxLength, required, type TreeValidationResult } from '@angular/forms/signals';
import type { CategoryDto, UpdateCategoryRequest } from '@stabilitea/shared';
import { errorMessage, toApiError } from '../shared/api-error';
import { Icon } from '../shared/icon';
import { MoneyInput } from '../shared/money-input';
import { Notifier } from '../shared/notifier';
import { CategoryApi } from './category-api';

interface SubcategoryDraft {
  name: string;
  defaultLimitCents: number | null;
}

/** Detail panel for a selected category. */
@Component({
  selector: 'app-category-editor',
  imports: [FormField, FormRoot, Icon, MoneyInput],
  template: `
    <div class="head">
      <div>
        <p class="eyebrow">{{ category().kind === 'income' ? 'Income category' : 'Expense category' }}</p>
        <h2>{{ category().name }}</h2>
      </div>
      @if (category().archivedAt) {
        <span class="chip"><app-icon name="archive" [size]="13" />Archived</span>
      }
    </div>

    <form class="stack" novalidate [formRoot]="renameForm">
      <div class="field">
        <label for="category-name">Name</label>
        <div class="row nowrap">
          <input id="category-name" class="input" type="text" autocomplete="off" [formField]="renameForm.name" aria-describedby="category-name-errors" />
          <button type="submit" class="btn" [disabled]="renameForm().submitting() || renameModel().name === category().name">Rename</button>
        </div>
        <div id="category-name-errors">
          @for (error of renameForm.name().errors(); track $index) {
            <p class="field-error" role="alert">{{ error.message }}</p>
          }
        </div>
      </div>
    </form>

    @if (category().kind === 'expense') {
      <div class="field">
        <label class="checkbox">
          <input type="checkbox" [checked]="category().rollover" [disabled]="busy()" (change)="toggleRollover($event)" aria-describedby="rollover-hint" />
          Roll over leftovers
        </label>
        <p id="rollover-hint" class="hint">
          @if (category().rollover) {
            Unspent money carries into next month's limit when a month closes.
          } @else {
            Unspent money is swept into savings when a month closes.
          }
          Changes apply to open months only.
        </p>
      </div>
    }

    <div class="row">
      <button type="button" class="btn btn-sm" [disabled]="busy() || isFirst()" (click)="move(-1)">
        <app-icon name="arrow-up" [size]="16" />Move up
      </button>
      <button type="button" class="btn btn-sm" [disabled]="busy() || isLast()" (click)="move(1)">
        <app-icon name="arrow-down" [size]="16" />Move down
      </button>
      <button type="button" class="btn btn-sm" [disabled]="busy()" (click)="toggleArchived()">
        <app-icon name="archive" [size]="16" />{{ category().archivedAt ? 'Unarchive' : 'Archive' }}
      </button>
    </div>
    @if (!category().archivedAt) {
      <p class="hint">Archived categories are hidden from new budgets; their history stays intact.</p>
    }

    <form class="stack sub-form" novalidate [formRoot]="subForm" aria-labelledby="add-sub-title">
      <h3 id="add-sub-title">Add subcategory</h3>
      <div class="fields">
        <div class="field grow">
          <label for="sub-name">Name</label>
          <input id="sub-name" class="input" type="text" autocomplete="off" [formField]="subForm.name" aria-describedby="sub-errors" />
        </div>
        @if (category().kind === 'expense') {
          <div class="field limit">
            <label for="sub-limit">Default limit</label>
            <app-money-input inputId="sub-limit" describedBy="sub-errors" [formField]="subForm.defaultLimitCents" />
          </div>
        }
        <button type="submit" class="btn btn-primary" [disabled]="subForm().submitting()"><app-icon name="plus" />Add</button>
      </div>
      <div id="sub-errors">
        @if (subForm.name().touched()) {
          @for (error of subForm.name().errors(); track $index) {
            <p class="field-error" role="alert">{{ error.message }}</p>
          }
        }
        @for (error of subForm.defaultLimitCents().errors(); track $index) {
          <p class="field-error" role="alert">{{ error.message }}</p>
        }
      </div>
    </form>
  `,
  styles: `
    :host { display: grid; gap: 18px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .eyebrow { font-size: 0.8rem; color: var(--st-ink-muted); font-weight: 600; }
    .nowrap { flex-wrap: nowrap; }
    .sub-form { padding-top: 16px; border-top: 1px solid var(--st-line); }
    .fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
    .grow { flex: 1 1 180px; }
    .limit { width: 150px; }
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
    computation: () => ({ name: '', defaultLimitCents: 0 }),
  });
  protected readonly subForm = form(
    this.subModel,
    (f) => {
      required(f.name, { message: 'Enter a subcategory name' });
      maxLength(f.name, 60, { message: 'Name must be 60 characters or fewer' });
    },
    { submission: { action: () => this.addSubcategory() } },
  );

  protected toggleRollover(event: Event): void {
    const rollover = (event.target as HTMLInputElement).checked;
    void this.update({ rollover }, rollover ? 'Leftovers will roll over.' : 'Leftovers will be swept to savings.');
  }

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
    const { name, defaultLimitCents } = this.subModel();
    try {
      const sub = await this.api.createSubcategory(this.category().id, {
        name: name.trim(),
        defaultLimitCents: defaultLimitCents ?? 0,
      });
      this.subForm().reset({ name: '', defaultLimitCents: 0 });
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
