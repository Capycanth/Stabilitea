import { Component, input } from '@angular/core';

export type IconName =
  | 'overview'
  | 'transactions'
  | 'budget'
  | 'categories'
  | 'savings'
  | 'chevron-left'
  | 'chevron-right'
  | 'plus'
  | 'edit'
  | 'trash'
  | 'warning'
  | 'check'
  | 'lock'
  | 'unlock'
  | 'download'
  | 'close'
  | 'arrow-up'
  | 'arrow-down'
  | 'archive'
  | 'rollover'
  | 'info'
  | 'report'
  | 'piggy-out';

/** Decorative stroke icon. Always pair with visible or visually-hidden text. */
@Component({
  selector: 'app-icon',
  host: { class: 'icon', 'aria-hidden': 'true' },
  templateUrl: './icon.html',
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(18);
}
