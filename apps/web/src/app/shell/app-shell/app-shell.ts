import { Component, computed, DestroyRef, type ElementRef, inject, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, pairwise } from 'rxjs';
import { Icon, type IconName } from '../../shared/icon/icon';
import { Notifier } from '../../shared/notifier';
import { MonthSwitcher } from '../month-switcher/month-switcher';
import { SelectedMonth } from '../selected-month';
import { TeacupLogo } from '../teacup-logo/teacup-logo';

interface NavItem {
  label: string;
  icon: IconName;
  link: string;
  exact: boolean;
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, MonthSwitcher, TeacupLogo],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
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
      { label: 'Categories', icon: 'groups', link: '/categories', exact: false },
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
