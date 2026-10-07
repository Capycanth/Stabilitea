import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BudgetApi } from '../../budget/budget-api';
import { errorMessage } from '../../shared/api-error';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { Icon } from '../../shared/icon/icon';
import { MoneyPipe } from '../../shared/money-pipe';
import { addMonths, currentMonth, monthLabel, monthName } from '../../shared/month';
import { Notifier } from '../../shared/notifier';
import { GroupCard } from '../group-card/group-card';

@Component({
  selector: 'app-overview',
  imports: [RouterLink, GroupCard, Icon, MoneyPipe, ConfirmDialog],
  templateUrl: './overview.html',
  styleUrl: './overview.scss',
})
export class Overview {
  private readonly budgetApi = inject(BudgetApi);
  private readonly notifier = inject(Notifier);
  private readonly dialog = viewChild.required(ConfirmDialog);

  /** Bound from the `:month` route param. */
  readonly month = input.required<string>();

  protected readonly summary = this.budgetApi.summaryResource(this.month);
  protected readonly closing = signal(false);

  protected readonly label = computed(() => monthLabel(this.month()));
  protected readonly nextMonthLabel = computed(() => monthLabel(addMonths(this.month(), 1)));
  protected readonly loadError = computed(() => errorMessage(this.summary.error()));
  protected readonly totalAvailable = computed(() =>
    this.summary.hasValue() ? this.summary.value().groups.reduce((sum, c) => sum + c.availableCents, 0) : 0,
  );
  /** A past month that is still open, with no earlier open month blocking it. */
  protected readonly showCloseBanner = computed(
    () =>
      this.summary.hasValue() &&
      this.summary.value().status === 'open' &&
      this.month() < currentMonth() &&
      this.summary.value().earliestOpenPastMonth === null,
  );

  protected readonly monthName = monthName;
  protected readonly monthLabel = monthLabel;

  protected async closeMonth(): Promise<void> {
    const month = this.month();
    const ok = await this.dialog().ask({
      title: `Close ${monthLabel(month)}?`,
      message: `Closing adds this month's income to savings and takes out regular spending and fund contributions. Each fund's balance carries into ${monthLabel(addMonths(month, 1))}, even if it's negative. You can reopen it later to make corrections.`,
      confirmLabel: `Close ${monthName(month)}`,
    });
    if (!ok) return;
    this.closing.set(true);
    try {
      await this.budgetApi.close(month);
      this.notifier.success(`${monthLabel(month)} closed. Savings and funds updated.`);
      this.summary.reload();
    } catch (error) {
      this.notifier.error(errorMessage(error));
    } finally {
      this.closing.set(false);
    }
  }
}
