import { MAX_CENTS, type UpdateBudgetLineRequest, type UpdateBudgetMonthRequest } from '@stabilitea/shared';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateBudgetMonthDto implements UpdateBudgetMonthRequest {
  @IsInt({ message: 'Planned income must be a whole number of cents' })
  @Min(0, { message: 'Planned income cannot be negative' })
  @Max(MAX_CENTS, { message: 'Planned income is too large' })
  plannedIncomeCents!: number;
}

export class UpdateBudgetLineDto implements UpdateBudgetLineRequest {
  @IsInt({ message: 'Limit must be a whole number of cents' })
  @Min(0, { message: 'Limit cannot be negative' })
  @Max(MAX_CENTS, { message: 'Limit is too large' })
  limitCents!: number;
}
