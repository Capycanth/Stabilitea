import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { BudgetLineDto, BudgetMonthDto } from '@stabilitea/shared';
import { BudgetLineRow } from './budget-line-row';

const line: BudgetLineDto = {
  id: 7,
  month: '2026-09',
  subcategoryId: 3,
  subcategoryName: 'Groceries',
  limitCents: 50_000,
  carryInCents: 2_500,
  deficitPaidCents: 0,
  availableCents: 52_500,
  rollover: true,
  spentCents: 55_000,
  remainingCents: -2_500,
};

@Component({
  imports: [BudgetLineRow],
  template: `
    <table>
      <tbody>
        <tr
          appBudgetLineRow
          [line]="line()"
          month="2026-09"
          [readonly]="readonly()"
          [savingsBalanceCents]="savings()"
          (updated)="updated.set($event)"
          (payDeficit)="paid.set($event)"
        ></tr>
      </tbody>
    </table>
  `,
})
class Host {
  readonly line = signal(line);
  readonly readonly = signal(false);
  readonly savings = signal(10_000);
  readonly updated = signal<BudgetMonthDto | null>(null);
  readonly paid = signal<BudgetLineDto | null>(null);
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('BudgetLineRow', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(readonly = false) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.readonly.set(readonly);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows carry-in, spent and an over-budget label with text', async () => {
    const { el } = await render();
    const text = el.textContent ?? '';
    expect(text).toContain('Groceries');
    expect(text).toContain('$25.00');
    expect(text).toContain('$550.00');
    expect(text).toContain('Over by $25.00');
    expect((el.querySelector('input') as HTMLInputElement).value).toBe('500.00');
  });

  it('saves the limit in cents when the input loses focus, not while typing', async () => {
    const { fixture, el } = await render();
    const inputEl = el.querySelector('input') as HTMLInputElement;
    expect(inputEl.getAttribute('aria-label')).toBe('Limit for Groceries');

    inputEl.value = '612.5';
    inputEl.dispatchEvent(new Event('input'));
    await tick();
    fixture.detectChanges();
    http.expectNone('/api/budgets/2026-09/lines/7');

    inputEl.dispatchEvent(new Event('blur'));
    await tick();
    fixture.detectChanges();
    const req = http.expectOne('/api/budgets/2026-09/lines/7');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ limitCents: 61_250 });

    const response = { month: '2026-09', categories: [] } as unknown as BudgetMonthDto;
    req.flush(response);
    await fixture.whenStable();
    expect(fixture.componentInstance.updated()).toEqual(response);
  });

  it('does not save an unchanged or invalid value', async () => {
    const { fixture, el } = await render();
    const inputEl = el.querySelector('input') as HTMLInputElement;

    inputEl.value = '500';
    inputEl.dispatchEvent(new Event('input'));
    inputEl.dispatchEvent(new Event('blur'));
    await tick();
    fixture.detectChanges();

    inputEl.value = '';
    inputEl.dispatchEvent(new Event('input'));
    inputEl.dispatchEvent(new Event('blur'));
    await fixture.whenStable();

    http.expectNone('/api/budgets/2026-09/lines/7');
    expect(el.textContent).toContain('Enter a limit (0 for none)');
  });

  it('offers to pay a rollover deficit from savings', async () => {
    const { fixture, el } = await render();
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Pay from savings'));
    expect(button?.textContent).toContain('for Groceries');
    button!.click();
    expect(fixture.componentInstance.paid()?.id).toBe(7);
  });

  it('shows a negative carry-in and the amount already paid from savings', async () => {
    const { fixture, el } = await render();
    fixture.componentInstance.line.set({ ...line, carryInCents: -3_000, deficitPaidCents: 1_000, availableCents: 48_000, remainingCents: -7_000 });
    await fixture.whenStable();
    const text = el.textContent ?? '';
    expect(text).toContain('-$30.00');
    expect(text).toContain('deficit carried from last month');
    expect(text).toContain('$10.00');
    expect(text).toContain('Over by $70.00');
  });

  it('hides the deficit payment without savings or for non-rollover lines', async () => {
    const { fixture, el } = await render();
    const payButton = () => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Pay from savings'));
    fixture.componentInstance.savings.set(0);
    await fixture.whenStable();
    expect(payButton()).toBeUndefined();
    fixture.componentInstance.savings.set(10_000);
    fixture.componentInstance.line.set({ ...line, rollover: false });
    await fixture.whenStable();
    expect(payButton()).toBeUndefined();
  });

  it('is read-only in a closed month', async () => {
    const { el } = await render(true);
    expect(el.querySelector('input')).toBeNull();
    expect(el.textContent).toContain('$500.00');
  });
});
