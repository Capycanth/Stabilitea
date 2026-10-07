import {
  type GroupKind,
  type CreateGroupRequest,
  type CreateCategoryRequest,
  MAX_CENTS,
  type UpdateGroupRequest,
  type UpdateCategoryRequest,
} from '@stabilitea/shared';
import { Transform } from 'class-transformer';
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
  @IsBoolean()
  fund?: boolean;
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
  @IsBoolean()
  fund?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}
