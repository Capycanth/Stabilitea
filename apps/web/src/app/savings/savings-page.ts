import { Component, computed, inject } from '@angular/core';
import type { SavingsEntryDto } from '@stabilitea/shared';
import { errorMessage } from '../shared/api-error';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money-pipe';
import { monthLabel } from '../shared/month';
import { SavingsApi } from './savings-api';

interface MonthGroup {
  month: string;
  label: string;
  totalCents: number;
  entries: SavingsEntryDto[];
}

@Component({
  selector: 'app-savings-page',
  imports: [Icon, MoneyPipe],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <p class="eyebrow">Running total</p>
          <h1>Savings</h1>
        </div>
      </div>

      @if (savings.error() && !savings.hasValue()) {
        <p class="form-error" role="alert"><app-icon name="warning" />{{ loadError() }}</p>
      }

      @if (savings.hasValue()) {
        <section class="balance" aria-labelledby="balance-label">
          <app-icon name="savings" [size]="34" />
          <div>
            <p id="balance-label" class="balance-label">Savings balance</p>
            <p class="balance-value money">{{ savings.value().balanceCents | money }}</p>
          </div>
          <p class="balance-note">
            Closing a month sweeps leftovers from non-rollover categories here. Paying a rollover deficit from the Budget page withdraws from it.
          </p>
        </section>

        <section class="stack" aria-labelledby="history-title">
          <h2 id="history-title">History</h2>
          @for (group of groups(); track group.month) {
            <div class="card month">
              <div class="month-head">
                <h3>{{ group.label }}</h3>
                <p class="money total" [class.negative]="group.totalCents < 0">{{ group.totalCents >= 0 ? '+' : '' }}{{ group.totalCents | money }}</p>
              </div>
              <table class="table">
                <caption class="visually-hidden">Savings activity for {{ group.label }}</caption>
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Type</th>
                    <th scope="col" class="end">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  @for (entry of group.entries; track entry.id) {
                    <tr>
                      <td>
                        @if (entry.subcategoryName) {
                          {{ entry.subcategoryName }} <span class="muted">· {{ entry.categoryName }}</span>
                        } @else {
                          <span class="muted">Unassigned leftover</span>
                        }
                      </td>
                      <td>
                        @if (entry.kind === 'deficit_payment') {
                          <span class="chip chip-orange">Deficit paid</span>
                        } @else {
                          <span class="chip chip-green">Swept at close</span>
                        }
                      </td>
                      <td class="end money">{{ entry.amountCents >= 0 ? '+' : '' }}{{ entry.amountCents | money }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @empty {
            <p class="empty">No savings activity yet. Close a month to move its non-rollover leftovers here.</p>
          }
        </section>
      } @else if (savings.isLoading()) {
        <p class="loading" role="status">Loading savings…</p>
      }
    </div>
  `,
  styles: `
    .balance { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 20px 24px; border-radius: 12px; background: #fce9dc; border: 1px solid var(--st-orange-soft); color: var(--st-ink); }
    .balance app-icon { color: var(--st-orange); }
    .balance-label { font-size: 0.9rem; font-weight: 600; color: var(--st-ink-muted); }
    .balance-value { font-size: 2.2rem; font-weight: 700; letter-spacing: -0.01em; }
    .balance-note { flex: 1 1 260px; font-size: 0.9rem; color: var(--st-ink-muted); }
    .month { padding: 16px 20px; display: grid; gap: 6px; }
    .month-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .total { font-weight: 650; color: var(--st-green); }
    .total.negative { color: var(--st-orange); }
    .table tr:last-child td { border-bottom: 0; }
    @media (max-width: 560px) {
      .month { padding: 12px; }
      .table th, .table td { padding: 8px 6px; }
      .table .chip { white-space: normal; }
    }
  `,
})
export class SavingsPage {
  private readonly api = inject(SavingsApi);

  protected readonly savings = this.api.savingsResource();
  protected readonly loadError = computed(() => errorMessage(this.savings.error()));

  protected readonly groups = computed<MonthGroup[]>(() => {
    if (!this.savings.hasValue()) return [];
    const groups: MonthGroup[] = [];
    for (const entry of this.savings.value().entries) {
      let group = groups.at(-1);
      if (!group || group.month !== entry.month) {
        group = { month: entry.month, label: monthLabel(entry.month), totalCents: 0, entries: [] };
        groups.push(group);
      }
      group.totalCents += entry.amountCents;
      group.entries.push(entry);
    }
    return groups;
  });
}
