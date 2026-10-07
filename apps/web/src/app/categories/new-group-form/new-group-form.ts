import { Component, inject, output, signal } from '@angular/core';
import { form, FormField, FormRoot, maxLength, required, type TreeValidationResult } from '@angular/forms/signals';
import type { GroupDto, GroupKind } from '@stabilitea/shared';
import { toApiError } from '../../shared/api-error';
import { Icon } from '../../shared/icon/icon';
import { GroupApi } from '../group-api';

interface NewGroupModel {
  name: string;
  kind: GroupKind;
}

const initial = (): NewGroupModel => ({ name: '', kind: 'expense' });

@Component({
  selector: 'app-new-group-form',
  imports: [FormField, FormRoot, Icon],
  template: `
    <form class="card-deep" novalidate [formRoot]="groupForm" aria-labelledby="new-group-title">
      <h2 id="new-group-title" class="title">New group</h2>
      <div class="fields">
        <div class="field grow">
          <label for="new-group-name">Name</label>
          <input id="new-group-name" class="input" type="text" autocomplete="off" [formField]="groupForm.name" aria-describedby="new-group-errors" />
        </div>
        <div class="field">
          <label for="new-group-kind">Kind</label>
          <select id="new-group-kind" class="input" [formField]="groupForm.kind">
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary" [disabled]="groupForm().submitting()">
          <app-icon name="plus" />Add
        </button>
      </div>
      <div id="new-group-errors">
        @if (groupForm.name().touched()) {
          @for (error of groupForm.name().errors(); track $index) {
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
export class NewGroupForm {
  private readonly api = inject(GroupApi);
  readonly created = output<GroupDto>();

  protected readonly model = signal<NewGroupModel>(initial());

  protected readonly groupForm = form(
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
      const group = await this.api.create({ name: name.trim(), kind });
      this.groupForm().reset(initial());
      this.created.emit(group);
      return undefined;
    } catch (error) {
      const body = toApiError(error);
      return { kind: 'server', message: body.fieldErrors?.['name']?.[0] ?? body.message, fieldTree: this.groupForm.name };
    }
  }
}
