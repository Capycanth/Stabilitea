import {
  type CategoryType,
  type CreateCategoryRequest,
  type CreateGroupRequest,
  type GroupKind,
  MAX_BILL_MONTHS,
  MAX_CENTS,
  type UpdateCategoryRequest,
  type UpdateGroupRequest,
} from '@stabilitea/shared';
import { Transform } from 'class-transformer';
import { IsMonthKey } from '../common/validators.js';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateGroupDto implements CreateGroupRequest {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(60, { message: 'Name must be 60 characters or fewer' })
  name!: string;

  @IsIn(['income', 'expense'], { message: 'Kind must be income or expense' })
  kind!: GroupKind;
}

export class UpdateGroupDto implements UpdateGroupRequest {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(60, { message: 'Name must be 60 characters or fewer' })
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class CreateCategoryDto implements CreateCategoryRequest {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(60, { message: 'Name must be 60 characters or fewer' })
  name!: string;

  @IsOptional()
  @IsInt({ message: 'Default limit must be a whole number of cents' })
  @Min(0, { message: 'Default limit cannot be negative' })
  @Max(MAX_CENTS)
  defaultLimitCents?: number;

  @IsOptional()
  @IsIn(['standard', 'fund', 'recurring'], { message: 'Type must be standard, fund or recurring' })
  type?: CategoryType;

  @IsOptional()
  @IsInt({ message: 'Bill amount must be a whole number of cents' })
  @Min(1, { message: 'Bill amount must be greater than 0' })
  @Max(MAX_CENTS)
  billCents?: number;

  @IsOptional()
  @IsInt({ message: 'Months must be a whole number' })
  @Min(1, { message: 'Months must be at least 1' })
  @Max(MAX_BILL_MONTHS, { message: `Months must be ${MAX_BILL_MONTHS} or fewer` })
  billMonths?: number;

  @IsOptional()
  @IsMonthKey({ message: 'Next due month must be a valid month' })
  nextDueMonth?: string;
}

export class UpdateCategoryDto implements UpdateCategoryRequest {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Name is required' })
  @MaxLength(60, { message: 'Name must be 60 characters or fewer' })
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  groupId?: number;

  @IsOptional()
  @IsInt({ message: 'Default limit must be a whole number of cents' })
  @Min(0, { message: 'Default limit cannot be negative' })
  @Max(MAX_CENTS)
  defaultLimitCents?: number;

  @IsOptional()
  @IsIn(['standard', 'fund', 'recurring'], { message: 'Type must be standard, fund or recurring' })
  type?: CategoryType;

  @IsOptional()
  @IsInt({ message: 'Bill amount must be a whole number of cents' })
  @Min(1, { message: 'Bill amount must be greater than 0' })
  @Max(MAX_CENTS)
  billCents?: number;

  @IsOptional()
  @IsInt({ message: 'Months must be a whole number' })
  @Min(1, { message: 'Months must be at least 1' })
  @Max(MAX_BILL_MONTHS, { message: `Months must be ${MAX_BILL_MONTHS} or fewer` })
  billMonths?: number;

  @IsOptional()
  @IsMonthKey({ message: 'Next due month must be a valid month' })
  nextDueMonth?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}
