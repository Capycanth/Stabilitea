import { Component, computed, inject, linkedSignal } from '@angular/core';
import { Listbox, Option } from '@angular/aria/listbox';
import { errorMessage } from '../../shared/api-error';
import { Icon } from '../../shared/icon/icon';
import { ReportApi } from '../report-api';

@Component({
  selector: 'app-reports-page',
  imports: [Icon, Listbox, Option],
  templateUrl: './reports-page.html',
  styles: `
    .sheets { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .sheet { display: grid; gap: 6px; align-content: start; }
    .sheet app-icon { color: var(--st-green); }
    .sheet p { font-size: 0.9rem; color: var(--st-ink-muted); }
  `,
})
export class ReportsPage {
  private readonly api = inject(ReportApi);

  protected readonly years = this.api.yearsResource();
  protected readonly loadError = computed(() => errorMessage(this.years.error()));

  /** Defaults to the newest year and resets if the list of years changes. */
  protected readonly selection = linkedSignal<number[]>(() =>
    this.years.hasValue() && this.years.value().years.length ? [this.years.value().years[0]!] : [],
  );
  protected readonly selectedYear = computed(() => this.selection()[0] ?? null);
  protected readonly downloadUrl = computed(() => {
    const year = this.selectedYear();
    return year === null ? null : this.api.yearReportUrl(year);
  });
}
