import { HttpClient, httpResource } from '@angular/common/http';
import { inject, Service, type Signal } from '@angular/core';
import type { BudgetMonthDto, MonthSummary } from '@stabilitea/shared';
import { firstValueFrom } from 'rxjs';

@Service()
export class BudgetApi {
  private readonly http = inject(HttpClient);

  /** The month's budget (auto-created from the previous month on first read). */
  budgetResource(month: Signal<string>) {
    return httpResource<BudgetMonthDto>(() => `/api/budgets/${month()}`);
  }

  /** Budget vs. actual summary for the month. */
  summaryResource(month: Signal<string>) {
    return httpResource<MonthSummary>(() => `/api/summary/${month()}`);
  }

  updatePlannedIncome(month: string, plannedIncomeCents: number): Promise<BudgetMonthDto> {
    return firstValueFrom(this.http.patch<BudgetMonthDto>(`/api/budgets/${month}`, { plannedIncomeCents }));
  }

  updateLineLimit(month: string, lineId: number, limitCents: number): Promise<BudgetMonthDto> {
    return firstValueFrom(this.http.patch<BudgetMonthDto>(`/api/budgets/${month}/lines/${lineId}`, { limitCents }));
  }

  /** Covers a fund line's deficit from savings (as much as the balance allows). */
  payDeficit(month: string, lineId: number): Promise<BudgetMonthDto> {
    return firstValueFrom(this.http.post<BudgetMonthDto>(`/api/budgets/${month}/lines/${lineId}/pay-deficit`, {}));
  }

  undoDeficitPayment(month: string, paymentId: number): Promise<BudgetMonthDto> {
    return firstValueFrom(this.http.delete<BudgetMonthDto>(`/api/budgets/${month}/deficit-payments/${paymentId}`));
  }

  close(month: string): Promise<BudgetMonthDto> {
    return firstValueFrom(this.http.post<BudgetMonthDto>(`/api/budgets/${month}/close`, {}));
  }

  reopen(month: string): Promise<BudgetMonthDto> {
    return firstValueFrom(this.http.post<BudgetMonthDto>(`/api/budgets/${month}/reopen`, {}));
  }
}
