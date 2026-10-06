import { httpResource } from '@angular/common/http';
import { Service } from '@angular/core';
import type { ReportYearsDto } from '@stabilitea/shared';

@Service()
export class ReportApi {
  /** Years that have budgets or transactions. Call from an injection context. */
  yearsResource() {
    return httpResource<ReportYearsDto>(() => '/api/reports/years');
  }

  /** Download URL for a year's Excel report. */
  yearReportUrl(year: number): string {
    return `/api/reports/${year}`;
  }
}
