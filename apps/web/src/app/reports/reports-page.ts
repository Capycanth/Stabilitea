import { Component, computed, inject, linkedSignal } from '@angular/core';
import { Listbox, Option } from '@angular/aria/listbox';
import { errorMessage } from '../shared/api-error';
import { Icon } from '../shared/icon';
import { ReportApi } from './report-api';

@Component({
  selector: 'app-reports-page',
  imports: [Icon, Listbox, Option],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <p class="eyebrow">Export</p>
          <h1>Yearly report</h1>
        </div>
      </div>

      @if (years.error() && !years.hasValue()) {
        <p class="form-error" role="alert"><app-icon name="warning" />{{ loadError() }}</p>
      }

      <section class="card stack" aria-labelledby="report-title">
        <h2 id="report-title">Download an Excel workbook</h2>
        <p class="muted">One file for a calendar year, built from your budgets, transactions and savings ledger.</p>

        @if (years.hasValue()) {
          <div class="field">
            <span class="label" id="report-year-label">Year</span>
            <ul
              ngListbox
              class="filter-listbox"
              orientation="horizontal"
              selectionMode="follow"
              aria-labelledby="report-year-label"
              [value]="selection()"
              (valueChange)="selection.set($event)"
            >
              @for (year of years.value().years; track year) {
                <li ngOption [value]="year" [label]="'' + year">{{ year }}</li>
              }
            </ul>
          </div>

          @if (selectedYear(); as year) {
            <div>
              <a class="btn btn-primary" [href]="downloadUrl()" [attr.download]="'stabilitea-' + year + '-report.xlsx'">
                <app-icon name="download" />
                Download {{ year }} report (.xlsx)
              </a>
            </div>
          }
        } @else if (years.isLoading()) {
          <p class="loading" role="status">Loading years…</p>
        }
      </section>

      <section class="sheets" aria-labelledby="sheets-title">
        <h2 id="sheets-title" class="visually-hidden">What's in the workbook</h2>
        <div class="card-deep sheet">
          <app-icon name="report" />
          <h3>Summary</h3>
          <p>Income, expenses and net for the year, money swept into savings, deficits paid from savings, savings at the start and end of the year, and spending by category.</p>
        </div>
        <div class="card-deep sheet">
          <app-icon name="overview" />
          <h3>Monthly</h3>
          <p>One row per month: status, planned vs. actual income, expenses, net, budgeted, carry-in, sweeps, deficit payments and the savings balance.</p>
        </div>
        <div class="card-deep sheet">
          <app-icon name="budget" />
          <h3>Budget vs. actual</h3>
          <p>Every subcategory for every month: limit, carry-in (negative for carried deficits), amount paid from savings, budget, spent, remaining and what happened at close.</p>
        </div>
      </section>
    </div>
  `,
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
