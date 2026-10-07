import { Component, computed, input, model } from '@angular/core';
import { Listbox, Option } from '@angular/aria/listbox';
import type { GroupDto, TransactionFilters, TransactionType } from '@stabilitea/shared';

type TypeChoice = 'all' | TransactionType;

/** Filter chips built on @angular/aria Listbox (single select, horizontal). */
@Component({
  selector: 'app-transaction-filter-bar',
  imports: [Listbox, Option],
  templateUrl: './transaction-filter-bar.html',
  styles: `
    :host { display: grid; gap: 10px; }
    .filter-group { display: grid; grid-template-columns: 84px minmax(0, 1fr); align-items: center; gap: 8px; }
    @media (max-width: 560px) { .filter-group { grid-template-columns: minmax(0, 1fr); gap: 4px; } }
  `,
})
export class TransactionFilterBar {
  readonly groups = input.required<GroupDto[]>();
  readonly filters = model.required<TransactionFilters>();

  protected readonly visibleGroups = computed(() =>
    this.groups().filter((c) => {
      const type = this.filters().type;
      return !type || c.kind === type;
    }),
  );

  protected readonly typeValue = computed<TypeChoice[]>(() => [this.filters().type ?? 'all']);
  protected readonly groupValue = computed(() => [this.filters().groupId ?? 0]);
  protected readonly categoryValue = computed(() => [this.filters().categoryId ?? 0]);

  protected readonly selectedGroup = computed(
    () => this.groups().find((c) => c.id === this.filters().groupId) ?? null,
  );

  protected selectType(value: TypeChoice[]): void {
    const choice = value[0] ?? 'all';
    const type = choice === 'all' ? undefined : choice;
    this.filters.update((f) => {
      const group = this.groups().find((c) => c.id === f.groupId);
      const keepGroup = !type || group?.kind === type;
      return keepGroup ? { ...f, type } : { type };
    });
  }

  protected selectGroup(value: number[]): void {
    const groupId = value[0] || undefined;
    this.filters.update((f) => ({ type: f.type, groupId }));
  }

  protected selectCategory(value: number[]): void {
    const categoryId = value[0] || undefined;
    this.filters.update((f) => ({ ...f, categoryId }));
  }
}
