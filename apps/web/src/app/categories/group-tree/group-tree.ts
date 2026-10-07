import { Component, computed, inject, signal } from '@angular/core';
import { Tree, TreeItem, TreeItemGroup } from '@angular/aria/tree';
import type { GroupDto, CategoryDto } from '@stabilitea/shared';
import { errorMessage } from '../../shared/api-error';
import { Icon } from '../../shared/icon/icon';
import { MoneyPipe } from '../../shared/money-pipe';
import { GroupApi } from '../group-api';
import { GroupEditor } from '../group-editor/group-editor';
import { NewGroupForm } from '../new-group-form/new-group-form';
import { CategoryEditor } from '../category-editor/category-editor';

type Selection =
  | { kind: 'group'; group: GroupDto; index: number; count: number }
  | { kind: 'category'; category: CategoryDto; parent: GroupDto; index: number; count: number };

@Component({
  selector: 'app-group-tree',
  imports: [Tree, TreeItem, TreeItemGroup, Icon, MoneyPipe, GroupEditor, CategoryEditor, NewGroupForm],
  templateUrl: './group-tree.html',
  styleUrl: './group-tree.scss',
})
export class GroupTree {
  private readonly api = inject(GroupApi);

  protected readonly showArchived = signal(false);
  /** Always load archived rows so reorder positions match the server's ordering. */
  protected readonly groups = this.api.groupsResource(() => true);
  protected readonly selection = signal<string[]>([]);

  protected readonly all = computed(() => (this.groups.hasValue() ? this.groups.value() : []));
  protected readonly loadError = computed(() => errorMessage(this.groups.error()));

  protected readonly visible = computed(() =>
    this.all()
      .filter((c) => this.showArchived() || !c.archivedAt)
      .map((c) => ({
        ...c,
        categories: c.categories.filter((s) => this.showArchived() || !s.archivedAt),
      })),
  );

  protected readonly selected = computed<Selection | null>(() => {
    const key = this.selection()[0];
    if (!key) return null;
    const id = Number(key.slice(2));
    const groups = this.all();
    if (key.startsWith('c-')) {
      const index = groups.findIndex((c) => c.id === id);
      return index === -1 ? null : { kind: 'group', group: groups[index]!, index, count: groups.length };
    }
    for (const parent of groups) {
      const index = parent.categories.findIndex((s) => s.id === id);
      if (index !== -1) {
        return { kind: 'category', category: parent.categories[index]!, parent, index, count: parent.categories.length };
      }
    }
    return null;
  });

  protected readonly groupSelection = computed(() => {
    const s = this.selected();
    return s?.kind === 'group' ? s : null;
  });

  protected readonly categorySelection = computed(() => {
    const s = this.selected();
    return s?.kind === 'category' ? s : null;
  });

  protected toggleArchived(event: Event): void {
    this.showArchived.set((event.target as HTMLInputElement).checked);
  }

  protected onCreated(group: GroupDto): void {
    this.groups.reload();
    this.selection.set([`c-${group.id}`]);
  }
}
