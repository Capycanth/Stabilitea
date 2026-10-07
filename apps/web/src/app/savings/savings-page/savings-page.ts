import { Component, computed, inject } from '@angular/core';
import type { SavingsEntryDto, SavingsEntryKind, SavingsMonthDto } from '@stabilitea/shared';
import { errorMessage } from '../../shared/api-error';
import { Icon } from '../../shared/icon/icon';
import { MoneyPipe } from '../../shared/money-pipe';
import { monthLabel } from '../../shared/month';
import { SavingsApi } from '../savings-api';

interface MonthGroup {
  month: SavingsMonthDto;
  label: string;
  entries: SavingsEntryDto[];
}

const KIND_LABEL: Record<SavingsEntryKind, string> = {
  income: 'Income',
  spending: 'Spending',
  fund_contribution: 'Into fund',
  fund_release: 'Fund released',
  deficit_payment: 'Fund deficit paid',
};

@Component({
  selector: 'app-savings-page',
  imports: [Icon, MoneyPipe],
  templateUrl: './savings-page.html',
  styleUrl: './savings-page.scss',
})
export class SavingsPage {
  private readonly api = inject(SavingsApi);

  protected readonly savings = this.api.savingsResource();
  protected readonly loadError = computed(() => errorMessage(this.savings.error()));
  protected readonly kindLabel = KIND_LABEL;

  protected readonly groups = computed<MonthGroup[]>(() => {
    if (!this.savings.hasValue()) return [];
    const { months, entries } = this.savings.value();
    return months.map((month) => ({
      month,
      label: monthLabel(month.month),
      entries: entries.filter((e) => e.month === month.month),
    }));
  });
}
