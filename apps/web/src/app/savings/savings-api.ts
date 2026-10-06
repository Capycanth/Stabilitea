import { httpResource } from '@angular/common/http';
import { Service } from '@angular/core';
import type { SavingsDto } from '@stabilitea/shared';

@Service()
export class SavingsApi {
  /** Savings balance and ledger. Call from an injection context. */
  savingsResource() {
    return httpResource<SavingsDto>(() => '/api/savings');
  }
}
