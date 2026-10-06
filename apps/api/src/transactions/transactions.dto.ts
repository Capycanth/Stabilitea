import {
  type CreateTransactionRequest,
  MAX_CENTS,
  type TransactionFilters,
  type TransactionType,
  type UpdateTransactionRequest,
} from '@stabilitea/shared';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { IsCalendarDate } from '../common/validators.js';

const trimToNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export class CreateTransactionDto implements CreateTransactionRequest {
  @IsCalendarDate()
  date!: string;

  @IsIn(['income', 'expense'], { message: 'Type must be income or expense' })
  type!: TransactionType;

  @IsInt({ message: 'Amount must be a whole number of cents' })
  @Min(1, { message: 'Amount must be greater than 0' })
  @Max(MAX_CENTS, { message: 'Amount is too large' })
  amountCents!: number;

  @IsInt({ message: 'Choose a subcategory' })
  @Min(1, { message: 'Choose a subcategory' })
  subcategoryId!: number;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(120, { message: 'Payee must be 120 characters or fewer' })
  payee?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500, { message: 'Note must be 500 characters or fewer' })
  note?: string | null;
}

export class UpdateTransactionDto implements UpdateTransactionRequest {
  @IsOptional()
  @IsCalendarDate()
  date?: string;

  @IsOptional()
  @IsIn(['income', 'expense'], { message: 'Type must be income or expense' })
  type?: TransactionType;

  @IsOptional()
  @IsInt({ message: 'Amount must be a whole number of cents' })
  @Min(1, { message: 'Amount must be greater than 0' })
  @Max(MAX_CENTS, { message: 'Amount is too large' })
  amountCents?: number;

  @IsOptional()
  @IsInt({ message: 'Choose a subcategory' })
  @Min(1, { message: 'Choose a subcategory' })
  subcategoryId?: number;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(120, { message: 'Payee must be 120 characters or fewer' })
  payee?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(500, { message: 'Note must be 500 characters or fewer' })
  note?: string | null;
}

export class TransactionQueryDto implements TransactionFilters {
  @IsString()
  month!: string;

  @IsOptional()
  @IsIn(['income', 'expense'])
  type?: TransactionType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  subcategoryId?: number;
}
