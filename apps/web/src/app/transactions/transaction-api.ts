import { HttpClient, httpResource } from '@angular/common/http';
import { inject, Service, type Signal } from '@angular/core';
import type {
  CreateTransactionRequest,
  TransactionDto,
  TransactionFilters,
  UpdateTransactionRequest,
} from '@stabilitea/shared';
import { firstValueFrom } from 'rxjs';

@Service()
export class TransactionApi {
  private readonly http = inject(HttpClient);

  /** A month's transactions, refetched when the month or filters change. Call from an injection context. */
  transactionsResource(month: Signal<string>, filters: Signal<TransactionFilters>) {
    return httpResource<TransactionDto[]>(() => {
      const { type, groupId, categoryId } = filters();
      const params: Record<string, string | number> = { month: month() };
      if (type) params['type'] = type;
      if (groupId) params['groupId'] = groupId;
      if (categoryId) params['categoryId'] = categoryId;
      return { url: '/api/transactions', params };
    });
  }

  create(body: CreateTransactionRequest): Promise<TransactionDto> {
    return firstValueFrom(this.http.post<TransactionDto>('/api/transactions', body));
  }

  update(id: number, body: UpdateTransactionRequest): Promise<TransactionDto> {
    return firstValueFrom(this.http.patch<TransactionDto>(`/api/transactions/${id}`, body));
  }

  remove(id: number): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/transactions/${id}`));
  }
}
