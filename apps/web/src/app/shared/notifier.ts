import { Service, signal } from '@angular/core';

export interface Notice {
  id: number;
  tone: 'success' | 'error';
  text: string;
}

/** App-wide status messages, announced through a live region in the shell. */
@Service()
export class Notifier {
  private nextId = 1;
  private readonly current = signal<Notice | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly notice = this.current.asReadonly();

  success(text: string): void {
    this.show({ id: this.nextId++, tone: 'success', text });
  }

  error(text: string): void {
    this.show({ id: this.nextId++, tone: 'error', text });
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.current.set(null);
  }

  private show(notice: Notice): void {
    clearTimeout(this.timer);
    this.current.set(notice);
    this.timer = setTimeout(() => this.current.set(null), notice.tone === 'error' ? 8000 : 4000);
  }
}
