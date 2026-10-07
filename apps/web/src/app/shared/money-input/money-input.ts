import { Component, input, model, output } from '@angular/core';
import { type FormValueControl, transformedValue, type ValidationError } from '@angular/forms/signals';
import { centsToDollarString, dollarsToCents } from '@stabilitea/shared';

/**
 * Dollar text input bound to an integer-cents model.
 * The user types dollars ("12.50"); the field value is cents (1250).
 */
@Component({
  selector: 'app-money-input',
  host: { class: 'money-input' },
  template: `
    <span class="prefix" aria-hidden="true">$</span>
    <input
      class="input money"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      [id]="inputId()"
      [attr.aria-describedby]="describedBy() || null"
      [attr.aria-invalid]="touched() && invalid()"
      [attr.aria-required]="required() || null"
      [attr.aria-label]="ariaLabel() || null"
      [disabled]="disabled()"
      [readOnly]="readonly()"
      [value]="raw()"
      (input)="updateText($event)"
      (blur)="tidy(); touch.emit()"
    />
  `,
  styles: `
    :host { position: relative; display: block; }
    .prefix { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--st-ink-muted); pointer-events: none; }
    input { padding-left: 24px; text-align: right; }
  `,
})
export class MoneyInput implements FormValueControl<number | null> {
  readonly value = model<number | null>(null);
  readonly touched = input(false);
  readonly invalid = input(false);
  readonly required = input(false);
  readonly disabled = input(false);
  readonly readonly = input(false);
  readonly errors = input<readonly ValidationError.WithOptionalFieldTree[]>([]);
  readonly touch = output<void>();

  readonly inputId = input.required<string>();
  readonly describedBy = input<string>('');
  readonly ariaLabel = input<string>('');

  protected readonly raw = transformedValue(this.value, {
    parse: (text: string) => {
      if (text.trim() === '') return { value: null };
      const cents = dollarsToCents(text);
      return cents === null
        ? { error: { kind: 'parse', message: 'Enter a dollar amount like 12.50' } }
        : { value: cents };
    },
    format: (cents: number | null) => (cents === null ? '' : centsToDollarString(cents)),
  });

  protected updateText(event: Event): void {
    this.raw.set((event.target as HTMLInputElement).value);
  }

  /** Normalize the displayed text (e.g. "12.5" → "12.50") once the user leaves the field. */
  protected tidy(): void {
    const cents = this.value();
    const text = this.raw();
    if (cents !== null && dollarsToCents(text) === cents && text !== centsToDollarString(cents)) {
      this.raw.set(centsToDollarString(cents));
    }
  }
}
