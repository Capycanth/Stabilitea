import { Component, type ElementRef, signal, viewChild } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
}

/**
 * Native <dialog> confirmation. `ask()` resolves true/false and returns focus to the element
 * that was focused when it opened.
 */
@Component({
  selector: 'app-confirm-dialog',
  template: `
    <dialog #dialog class="dialog" aria-labelledby="confirm-title" aria-describedby="confirm-message" (close)="settle(false)">
      @if (options(); as opts) {
        <div class="dialog-body">
          <h2 id="confirm-title">{{ opts.title }}</h2>
          <p id="confirm-message">{{ opts.message }}</p>
          <div class="dialog-actions">
            <button type="button" class="btn" (click)="settle(false)">Cancel</button>
            <button
              type="button"
              class="btn"
              [class.btn-danger]="opts.tone === 'danger'"
              [class.btn-primary]="opts.tone !== 'danger'"
              (click)="settle(true)"
            >
              {{ opts.confirmLabel }}
            </button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class ConfirmDialog {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly options = signal<ConfirmOptions | null>(null);
  private resolver: ((value: boolean) => void) | null = null;
  private returnFocus: HTMLElement | null = null;

  ask(options: ConfirmOptions): Promise<boolean> {
    this.resolver?.(false);
    this.options.set(options);
    const doc = this.dialog().nativeElement.ownerDocument;
    this.returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    openDialog(this.dialog().nativeElement);
    return new Promise((resolve) => (this.resolver = resolve));
  }

  protected settle(result: boolean): void {
    const resolve = this.resolver;
    this.resolver = null;
    closeDialog(this.dialog().nativeElement);
    this.returnFocus?.focus();
    this.returnFocus = null;
    resolve?.(result);
  }
}

export function openDialog(dialog: HTMLDialogElement): void {
  if (dialog.open) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

export function closeDialog(dialog: HTMLDialogElement): void {
  if (!dialog.open) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}
