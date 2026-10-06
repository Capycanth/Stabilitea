import { formatCents } from '@stabilitea/shared';

export type BudgetTone = 'ok' | 'near' | 'over' | 'none';

export interface BudgetStatus {
  /** 0–100, clamped for bar width. */
  percent: number;
  tone: BudgetTone;
  /** Text equivalent of the bar, e.g. "$120.00 of $300.00 left" or "Over by $5.00". */
  label: string;
}

/**
 * Budget status colors:
 *  - under 80% used → ok (green-soft)
 *  - 80–100% used → near (orange-soft)
 *  - over 100% → over (orange-soft, full width, "Over by $X")
 */
export function budgetStatus(spentCents: number, availableCents: number): BudgetStatus {
  const remaining = availableCents - spentCents;
  if (availableCents < 0 || (availableCents === 0 && spentCents > 0)) {
    // A deficit carried in from last month counts as already overspent.
    return { percent: 100, tone: 'over', label: `Over by ${formatCents(-remaining)}` };
  }
  if (availableCents === 0) {
    return { percent: 0, tone: 'none', label: 'No budget set' };
  }
  if (remaining < 0) {
    return { percent: 100, tone: 'over', label: `Over by ${formatCents(-remaining)}` };
  }
  const used = (spentCents / availableCents) * 100;
  return {
    percent: Math.max(0, Math.min(100, used)),
    tone: used >= 80 ? 'near' : 'ok',
    label: `${formatCents(remaining)} of ${formatCents(availableCents)} left`,
  };
}
