import { Component, computed, DestroyRef, type ElementRef, inject, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, pairwise } from 'rxjs';
import { Icon, type IconName } from '../shared/icon';
import { Notifier } from '../shared/notifier';
import { MonthSwitcher } from './month-switcher';
import { SelectedMonth } from './selected-month';
import { TeacupLogo } from './teacup-logo';

interface NavItem {
  label: string;
  icon: IconName;
  link: string;
  exact: boolean;
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, MonthSwitcher, TeacupLogo],
  template: `
    <a class="skip-link" href="#main" (click)="focusMain($event)">Skip to content</a>
    <div class="layout">
      <aside class="sidebar">
        <a class="brand" [routerLink]="['/', selected.month()]">
          <app-teacup-logo />
          <span class="wordmark">Stabilitea</span>
        </a>
        <nav aria-label="Main">
          <ul>
            @for (item of nav(); track item.label) {
              <li>
                <a
                  [routerLink]="item.link"
                  routerLinkActive="active"
                  ariaCurrentWhenActive="page"
                  [routerLinkActiveOptions]="{ exact: item.exact }"
                >
                  <app-icon [name]="item.icon" />
                  <span>{{ item.label }}</span>
                </a>
              </li>
            }
          </ul>
        </nav>
        <a class="backup" href="/api/export" download="stabilitea-export.json">
          <app-icon name="download" [size]="16" />
          <span>Download backup</span>
        </a>
      </aside>

      <div class="content">
        @if (selected.inMonthRoute()) {
          <header class="topbar">
            <app-month-switcher />
          </header>
        }
        <main id="main" #main tabindex="-1">
          <router-outlet />
        </main>
      </div>
    </div>

    <div class="toast-region" aria-live="polite" role="status">
      @if (notifier.notice(); as notice) {
        <div class="toast" [class.error]="notice.tone === 'error'">
          <app-icon [name]="notice.tone === 'error' ? 'warning' : 'check'" />
          <span>{{ notice.text }}</span>
          <button type="button" class="btn btn-quiet btn-sm btn-icon" (click)="notifier.dismiss()">
            <app-icon name="close" [size]="16" />
            <span class="visually-hidden">Dismiss</span>
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; min-height: 100dvh; }
    .skip-link { position: absolute; left: 12px; top: -48px; z-index: 10; padding: 8px 12px; background: var(--st-green); color: var(--st-on-accent); border-radius: 8px; }
    .skip-link:focus-visible { top: 12px; }
    .layout { display: grid; grid-template-columns: 232px minmax(0, 1fr); min-height: 100dvh; }
    .sidebar { position: sticky; top: 0; height: 100dvh; display: flex; flex-direction: column; gap: 24px; padding: 20px 14px; background: var(--st-ivory-deep); border-right: 1px solid var(--st-line); }
    .brand { display: flex; align-items: center; gap: 10px; padding: 4px 8px; color: var(--st-ink); text-decoration: none; }
    .wordmark { font-family: var(--st-font-heading); font-variation-settings: 'SOFT' 100; font-size: 1.4rem; font-weight: 600; }
    nav ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
    nav a { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 8px; color: var(--st-ink); text-decoration: none; font-weight: 500; }
    nav a:hover { background: var(--st-line); }
    nav a.active { background: var(--st-surface); color: var(--st-green); font-weight: 650; box-shadow: inset 3px 0 0 var(--st-green); }
    .backup { margin-top: auto; display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 0.85rem; color: var(--st-ink-muted); }
    .content { min-width: 0; display: flex; flex-direction: column; }
    .topbar { display: flex; justify-content: flex-end; padding: 12px 32px 0; }
    main { padding: 20px 32px 48px; outline: none; }
    .toast-region { position: fixed; right: 16px; bottom: 16px; z-index: 20; max-width: calc(100vw - 32px); }
    .toast { display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 14px; border-radius: 12px; background: var(--st-ink); color: var(--st-ivory); box-shadow: 0 6px 24px rgb(47 42 38 / 0.18); }
    .toast .btn { color: inherit; }
    .toast .btn:hover { background: rgb(255 255 255 / 0.12); }
    .toast.error { background: var(--st-orange); }
    @media (max-width: 800px) {
      .layout { grid-template-columns: minmax(0, 1fr); }
      .sidebar { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 16px; border-right: 0; border-bottom: 1px solid var(--st-line); }
      nav { order: 3; width: 100%; overflow-x: auto; }
      nav ul { display: flex; gap: 4px; }
      nav a { padding: 7px 10px; white-space: nowrap; }
      nav a.active { box-shadow: inset 0 -3px 0 var(--st-green); }
      .backup { margin: 0 0 0 auto; padding: 6px; }
      .backup span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      .topbar { justify-content: center; padding: 10px 16px 0; }
      main { padding: 16px 16px 40px; }
    }
  `,
})
export class AppShell {
  protected readonly selected = inject(SelectedMonth);
  protected readonly notifier = inject(Notifier);
  private readonly router = inject(Router);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  protected readonly nav = computed<NavItem[]>(() => {
    const month = this.selected.month();
    return [
      { label: 'Overview', icon: 'overview', link: `/${month}`, exact: true },
      { label: 'Transactions', icon: 'transactions', link: `/${month}/transactions`, exact: false },
      { label: 'Budget', icon: 'budget', link: `/${month}/budget`, exact: false },
      { label: 'Categories', icon: 'categories', link: '/categories', exact: false },
      { label: 'Savings', icon: 'savings', link: '/savings', exact: false },
      { label: 'Reports', icon: 'report', link: '/reports', exact: false },
    ];
  });

  constructor() {
    // Move focus to the new page when the page changes (not on first load, and not when only the
    // month changes, so the month switcher keeps focus) so screen readers follow navigation.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        map((event) => event.urlAfterRedirects.split(/[?#]/)[0]!.replace(/^\/\d{4}-\d{2}/, '')),
        pairwise(),
        filter(([previous, next]) => previous !== next),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(() => this.main().nativeElement.focus({ preventScroll: true }));
  }

  protected focusMain(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }
}
