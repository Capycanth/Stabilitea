import { Component, computed, inject, signal } from '@angular/core';
import { Tree, TreeItem, TreeItemGroup } from '@angular/aria/tree';
import type { CategoryDto, SubcategoryDto } from '@stabilitea/shared';
import { errorMessage } from '../../shared/api-error';
import { Icon } from '../../shared/icon/icon';
import { MoneyPipe } from '../../shared/money-pipe';
import { CategoryApi } from '../category-api';
import { CategoryEditor } from '../category-editor/category-editor';
import { NewCategoryForm } from '../new-category-form/new-category-form';
import { SubcategoryEditor } from '../subcategory-editor/subcategory-editor';

type Selection =
  | { kind: 'category'; category: CategoryDto; index: number; count: number }
  | { kind: 'subcategory'; subcategory: SubcategoryDto; parent: CategoryDto; index: number; count: number };

@Component({
  selector: 'app-category-tree',
  imports: [Tree, TreeItem, TreeItemGroup, Icon, MoneyPipe, CategoryEditor, SubcategoryEditor, NewCategoryForm],
  templateUrl: './category-tree.html',
  styleUrl: './category-tree.scss',
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
