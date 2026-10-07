import { Component, computed, inject, signal } from '@angular/core';
import { Tree, TreeItem, TreeItemGroup } from '@angular/aria/tree';
import type { CategoryDto, SubcategoryDto } from '@stabilitea/shared';
import { errorMessage } from '../shared/api-error';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money-pipe';
import { CategoryApi } from './category-api';
import { CategoryEditor } from './category-editor';
import { NewCategoryForm } from './new-category-form';
import { SubcategoryEditor } from './subcategory-editor';

type Selection =
  | { kind: 'category'; category: CategoryDto; index: number; count: number }
  | { kind: 'subcategory'; subcategory: SubcategoryDto; parent: CategoryDto; index: number; count: number };

@Component({
  selector: 'app-category-tree',
  imports: [Tree, TreeItem, TreeItemGroup, Icon, MoneyPipe, CategoryEditor, SubcategoryEditor, NewCategoryForm],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <p class="eyebrow">Setup</p>
          <h1>Categories</h1>
        </div>
        <label class="checkbox">
          <input type="checkbox" [checked]="showArchived()" (change)="toggleArchived($event)" />
          Show archived
        </label>
      </div>

      <app-new-category-form (created)="onCreated($event)" />

      @if (categories.error() && !categories.hasValue()) {
        <p class="form-error" role="alert"><app-icon name="warning" />{{ loadError() }}</p>
      }

      @if (categories.hasValue()) {
        <div class="split">
          <div class="card tree-card">
            <p id="tree-label" class="label">Categories and subcategories</p>
            <p class="hint">Use arrow keys to move, Right/Left to expand or collapse, and select an item to edit it.</p>
            @if (visible().length) {
              <ul ngTree #tree="ngTree" class="tree" aria-labelledby="tree-label" selectionMode="follow" [(value)]="selection">
                @for (category of visible(); track category.id) {
                  <li
                    ngTreeItem
                    #categoryItem="ngTreeItem"
                    [parent]="tree"
                    [value]="'c-' + category.id"
                    [label]="category.name"
                    [expanded]="true"
                    class="node"
                  >
                    <span class="node-row">
                      <span class="node-name">{{ category.name }}</span>
                      @if (category.kind === 'income') {
                        <span class="chip">Income</span>
                      }
                      @if (category.archivedAt) {
                        <span class="chip">Archived</span>
                      }
                    </span>
                    @if (category.subcategories.length) {
                      <ul role="group" class="group">
                        <ng-template ngTreeItemGroup [ownedBy]="categoryItem" #group="ngTreeItemGroup">
                          @for (sub of category.subcategories; track sub.id) {
                            <li ngTreeItem [parent]="group" [value]="'s-' + sub.id" [label]="sub.name" class="node leaf">
                              <span class="node-row">
                                <span class="node-name">{{ sub.name }}</span>
                                @if (category.kind === 'expense') {
                                  <span class="money muted small">{{ sub.defaultLimitCents | money }}</span>
                                }
                                @if (sub.fund) {
                                  <span class="chip chip-green">Fund</span>
                                }
                                @if (sub.archivedAt) {
                                  <span class="chip">Archived</span>
                                }
                              </span>
                            </li>
                          }
                        </ng-template>
                      </ul>
                    }
                  </li>
                }
              </ul>
            } @else {
              <p class="empty">No categories yet. Add one above.</p>
            }
          </div>

          <section class="card details" aria-live="polite" aria-label="Selected item">
            @switch (selected()?.kind) {
              @case ('category') {
                @let s = categorySelection();
                @if (s) {
                  <app-category-editor [category]="s.category" [index]="s.index" [count]="s.count" (changed)="categories.reload()" />
                }
              }
              @case ('subcategory') {
                @let s = subcategorySelection();
                @if (s) {
                  <app-subcategory-editor
                    [subcategory]="s.subcategory"
                    [parent]="s.parent"
                    [categories]="all()"
                    [index]="s.index"
                    [count]="s.count"
                    (changed)="categories.reload()"
                  />
                }
              }
              @default {
                <div class="placeholder">
                  <app-icon name="categories" [size]="28" />
                  <p>Select a category or subcategory to rename it, make a subcategory a fund, reorder, or archive it.</p>
                </div>
              }
            }
          </section>
        </div>
      } @else if (categories.isLoading()) {
        <p class="loading" role="status">Loading categories…</p>
      }
    </div>
  `,
  styles: `
    .split { display: grid; grid-template-columns: minmax(260px, 380px) minmax(0, 1fr); gap: 16px; align-items: start; }
    @media (max-width: 860px) { .split { grid-template-columns: minmax(0, 1fr); } }
    .tree-card { display: grid; gap: 6px; padding: 16px; }
    .tree { list-style: none; margin: 6px 0 0; padding: 0; outline: none; }
    .group { list-style: none; margin: 0; padding: 0 0 0 18px; }
    .node { outline: none; cursor: pointer; }
    .node-row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 8px; }
    .node[aria-expanded] > .node-row::before { content: ''; width: 0; height: 0; border-style: solid; border-width: 5px 0 5px 7px; border-color: transparent transparent transparent var(--st-ink-muted); transition: transform 120ms ease; }
    .node[aria-expanded='true'] > .node-row::before { transform: rotate(90deg); }
    .leaf > .node-row { padding-left: 16px; }
    .node-name { flex: 1; font-weight: 500; }
    .small { font-size: 0.82rem; }
    .node[aria-selected='true'] > .node-row { background: #e3efe1; color: #2f5f3b; }
    .node[data-active='true'] > .node-row { box-shadow: var(--st-focus-ring); }
    .node-row:hover { background: var(--st-ivory-deep); }
    .details { min-height: 240px; }
    .placeholder { display: grid; justify-items: center; gap: 10px; padding: 48px 16px; text-align: center; color: var(--st-ink-muted); }
  `,
})
export class CategoryTree {
  private readonly api = inject(CategoryApi);

  protected readonly showArchived = signal(false);
  /** Always load archived rows so reorder positions match the server's ordering. */
  protected readonly categories = this.api.categoriesResource(() => true);
  protected readonly selection = signal<string[]>([]);

  protected readonly all = computed(() => (this.categories.hasValue() ? this.categories.value() : []));
  protected readonly loadError = computed(() => errorMessage(this.categories.error()));

  protected readonly visible = computed(() =>
    this.all()
      .filter((c) => this.showArchived() || !c.archivedAt)
      .map((c) => ({
        ...c,
        subcategories: c.subcategories.filter((s) => this.showArchived() || !s.archivedAt),
      })),
  );

  protected readonly selected = computed<Selection | null>(() => {
    const key = this.selection()[0];
    if (!key) return null;
    const id = Number(key.slice(2));
    const categories = this.all();
    if (key.startsWith('c-')) {
      const index = categories.findIndex((c) => c.id === id);
      return index === -1 ? null : { kind: 'category', category: categories[index]!, index, count: categories.length };
    }
    for (const parent of categories) {
      const index = parent.subcategories.findIndex((s) => s.id === id);
      if (index !== -1) {
        return { kind: 'subcategory', subcategory: parent.subcategories[index]!, parent, index, count: parent.subcategories.length };
      }
    }
    return null;
  });

  protected readonly categorySelection = computed(() => {
    const s = this.selected();
    return s?.kind === 'category' ? s : null;
  });

  protected readonly subcategorySelection = computed(() => {
    const s = this.selected();
    return s?.kind === 'subcategory' ? s : null;
  });

  protected toggleArchived(event: Event): void {
    this.showArchived.set((event.target as HTMLInputElement).checked);
  }

  protected onCreated(category: CategoryDto): void {
    this.categories.reload();
    this.selection.set([`c-${category.id}`]);
  }
}
