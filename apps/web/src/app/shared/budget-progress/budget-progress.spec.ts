import { TestBed } from '@angular/core/testing';
import { BudgetProgress } from './budget-progress';
import { budgetStatus } from '../budget-status';

describe('budgetStatus', () => {
  it('is ok under 80% used', () => {
    expect(budgetStatus(18_000, 30_000)).toEqual({ percent: 60, tone: 'ok', label: '$120.00 of $300.00 left' });
  });

  it('is near from 80% to 100% used', () => {
    expect(budgetStatus(24_000, 30_000).tone).toBe('near');
    expect(budgetStatus(30_000, 30_000)).toMatchObject({ percent: 100, tone: 'near', label: '$0.00 of $300.00 left' });
  });

  it('is over past 100%, at full width with the overage', () => {
    expect(budgetStatus(30_550, 30_000)).toEqual({ percent: 100, tone: 'over', label: 'Over by $5.50' });
  });

  it('handles lines without a budget', () => {
    expect(budgetStatus(0, 0)).toMatchObject({ tone: 'none', label: 'No budget set' });
    expect(budgetStatus(1_000, 0)).toMatchObject({ tone: 'over', label: 'Over by $10.00' });
  });

  it('treats a negative budget (carried deficit) as already over', () => {
    // $200 limit + (-$250) carried in = -$50 budget, nothing spent yet
    expect(budgetStatus(0, -5_000)).toEqual({ percent: 100, tone: 'over', label: 'Over by $50.00' });
    expect(budgetStatus(1_000, -5_000)).toMatchObject({ tone: 'over', label: 'Over by $60.00' });
  });
});

describe('BudgetProgress', () => {
  async function render(spentCents: number, availableCents: number) {
    const fixture = TestBed.createComponent(BudgetProgress);
    fixture.componentRef.setInput('spentCents', spentCents);
    fixture.componentRef.setInput('availableCents', availableCents);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows text, not just color', async () => {
    const el = await render(18_000, 30_000);
    expect(el.textContent).toContain('$120.00 of $300.00 left');
    expect(el.classList).toContain('tone-ok');
    expect((el.querySelector('.fill') as HTMLElement).style.width).toBe('60%');
    expect(el.querySelector('.track')?.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('app-icon')).toBeNull();
  });

  it('adds a warning icon and "Over by" text when over budget', async () => {
    const el = await render(35_000, 30_000);
    expect(el.textContent).toContain('Over by $50.00');
    expect(el.classList).toContain('tone-over');
    expect(el.querySelector('app-icon')).not.toBeNull();
  });
});
