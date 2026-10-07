import { Component, inject, output, signal } from '@angular/core';
import { form, FormField, FormRoot, maxLength, required, type TreeValidationResult } from '@angular/forms/signals';
import type { CategoryDto, CategoryKind } from '@stabilitea/shared';
import { toApiError } from '../shared/api-error';
import { Icon } from '../shared/icon';
import { CategoryApi } from './category-api';

interface NewCategoryModel {
  name: string;
  kind: CategoryKind;
}

const initial = (): NewCategoryModel => ({ name: '', kind: 'expense' });

@Component({
  selector: 'app-new-category-form',
  imports: [FormField, FormRoot, Icon],
  template: `
    <form class="card-deep" novalidate [formRoot]="categoryForm" aria-labelledby="new-category-title">
      <h2 id="new-category-title" class="title">New category</h2>
      <div class="fields">
        <div class="field grow">
          <label for="new-category-name">Name</label>
          <input id="new-category-name" class="input" type="text" autocomplete="off" [formField]="categoryForm.name" aria-describedby="new-category-errors" />
        </div>
        <div class="field">
          <label for="new-category-kind">Kind</label>
          <select id="new-category-kind" class="input" [formField]="categoryForm.kind">
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary" [disabled]="categoryForm().submitting()">
          <app-icon name="plus" />Add
        </button>
      </div>
      <div id="new-category-errors">
        @if (categoryForm.name().touched()) {
          @for (error of categoryForm.name().errors(); track $index) {
            <p class="field-error" role="alert">{{ error.message }}</p>
          }
        }
      </div>
    </form>
  `,
  styles: `
    :host { display: block; }
    .title { font-size: 1.05rem; margin-bottom: 10px; }
    .fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
    .grow { flex: 1 1 200px; }
  `,
})
export class NewCategoryForm {
  private readonly api = inject(CategoryApi);
  readonly created = output<CategoryDto>();

  protected readonly model = signal<NewCategoryModel>(initial());

  protected readonly categoryForm = form(
    this.model,
    (f) => {
      required(f.name, { message: 'Enter a name' });
      maxLength(f.name, 60, { message: 'Name must be 60 characters or fewer' });
    },
    { submission: { action: () => this.save() } },
  );

  private async save(): Promise<TreeValidationResult> {
    const { name, kind } = this.model();
    try {
      const category = await this.api.create({ name: name.trim(), kind });
      this.categoryForm().reset(initial());
      this.created.emit(category);
      return undefined;
    } catch (error) {
      const body = toApiError(error);
      return { kind: 'server', message: body.fieldErrors?.['name']?.[0] ?? body.message, fieldTree: this.categoryForm.name };
    }
  }
}
