import type { Routes } from '@angular/router';
import { AppShell } from './shell/app-shell/app-shell';
import { currentMonth, validMonthMatch } from './shared/month';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: () => currentMonth() },
  {
    path: '',
    component: AppShell,
    children: [
      {
        path: 'categories',
        title: 'Categories · Stabilitea',
        loadComponent: () => import('./categories/group-tree/group-tree').then((m) => m.GroupTree),
      },
      {
        path: 'savings',
        title: 'Savings · Stabilitea',
        loadComponent: () => import('./savings/savings-page/savings-page').then((m) => m.SavingsPage),
      },
      {
        path: 'reports',
        title: 'Reports · Stabilitea',
        loadComponent: () => import('./reports/reports-page/reports-page').then((m) => m.ReportsPage),
      },
      {
        path: ':month',
        canMatch: [validMonthMatch],
        children: [
          {
            path: '',
            title: 'Overview · Stabilitea',
            loadComponent: () => import('./overview/overview/overview').then((m) => m.Overview),
          },
          {
            path: 'transactions',
            title: 'Transactions · Stabilitea',
            loadComponent: () => import('./transactions/transaction-list/transaction-list').then((m) => m.TransactionList),
          },
          {
            path: 'budget',
            title: 'Budget · Stabilitea',
            loadComponent: () => import('./budget/budget-editor/budget-editor').then((m) => m.BudgetEditor),
          },
        ],
      },
    ],
  },
  // Invalid month segments and unknown paths land on the current month.
  { path: '**', redirectTo: () => currentMonth() },
];
