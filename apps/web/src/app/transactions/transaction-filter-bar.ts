import { Component, computed, input, model } from '@angular/core';
import { Listbox, Option } from '@angular/aria/listbox';
import type { CategoryDto, TransactionFilters, TransactionType } from '@stabilitea/shared';

type TypeChoice = 'all' | TransactionType;

/** Filter chips built on @angular/aria Listbox (single select, horizontal). */
@Component({
  selector: 'app-transaction-filter-bar',
  imports: [Listbox, Option],
  template: `
    <div class="filter-group">
      <span class="label" id="filter-type-label">Type</span>
      <ul
        ngListbox
        class="filter-listbox"
        orientation="horizontal"
        selectionMode="follow"
        aria-labelledby="filter-type-label"
        [value]="typeValue()"
        (valueChange)="selectType($event)"
      >
        <li ngOption value="all">All</li>
        <li ngOption value="expense">Expenses</li>
        <li ngOption value="income">Income</li>
      </ul>
    </div>

    <div class="filter-group">
      <span class="label" id="filter-category-label">Category</span>
      <ul
        ngListbox
        class="filter-listbox"
        orientation="horizontal"
        selectionMode="follow"
        aria-labelledby="filter-category-label"
        [value]="categoryValue()"
        (valueChange)="selectCategory($event)"
      >
        <li ngOption [value]="0" label="All">All</li>
        @for (category of visibleCategories(); track category.id) {
          <li ngOption [value]="category.id" [label]="category.name">{{ category.name }}</li>
        }
      </ul>
    </div>

    @if (selectedCategory(); as category) {
      <div class="filter-group">
        <span class="label" id="filter-subcategory-label">{{ category.name }}</span>
        <ul
          ngListbox
          class="filter-listbox"
          orientation="horizontal"
          selectionMode="follow"
          aria-labelledby="filter-subcategory-label"
          [value]="subcategoryValue()"
          (valueChange)="selectSubcategory($event)"
        >
          <li ngOption [value]="0" label="All">All</li>
          @for (sub of category.subcategories; track sub.id) {
            <li ngOption [value]="sub.id" [label]="sub.name">{{ sub.name }}</li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    :host { display: grid; gap: 10px; }
    .filter-group { display: grid; grid-template-columns: 84px minmax(0, 1fr); align-items: center; gap: 8px; }
    @media (max-width: 560px) { .filter-group { grid-template-columns: minmax(0, 1fr); gap: 4px; } }
  `,
})
export class TransactionFilterBar {
  readonly categories = input.required<CategoryDto[]>();
  readonly filters = model.required<TransactionFilters>();

  protected readonly visibleCategories = computed(() =>
    this.categories().filter((c) => {
      const type = this.filters().type;
      return !type || c.kind === type;
    }),
  );

  protected readonly typeValue = computed<TypeChoice[]>(() => [this.filters().type ?? 'all']);
  protected readonly categoryValue = computed(() => [this.filters().categoryId ?? 0]);
  protected readonly subcategoryValue = computed(() => [this.filters().subcategoryId ?? 0]);

  protected readonly selectedCategory = computed(
    () => this.categories().find((c) => c.id === this.filters().categoryId) ?? null,
  );

  protected selectType(value: TypeChoice[]): void {
    const choice = value[0] ?? 'all';
    const type = choice === 'all' ? undefined : choice;
    this.filters.update((f) => {
      const category = this.categories().find((c) => c.id === f.categoryId);
      const keepCategory = !type || category?.kind === type;
      return keepCategory ? { ...f, type } : { type };
    });
  }

  protected selectCategory(value: number[]): void {
    const categoryId = value[0] || undefined;
    this.filters.update((f) => ({ type: f.type, categoryId }));
  }

  protected selectSubcategory(value: number[]): void {
    const subcategoryId = value[0] || undefined;
    this.filters.update((f) => ({ ...f, subcategoryId }));
  }
}
