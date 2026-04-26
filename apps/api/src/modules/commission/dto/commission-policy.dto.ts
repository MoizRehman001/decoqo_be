import {
  IsString, IsEnum, IsInt, IsBoolean, IsOptional,
  IsArray, IsObject, Min, MaxLength, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum CommissionPolicyType {
  PROJECT_COUNT   = 'PROJECT_COUNT',
  TIME_RANGE      = 'TIME_RANGE',
  AMOUNT_RANGE    = 'AMOUNT_RANGE',
  CUSTOM_OVERRIDE = 'CUSTOM_OVERRIDE',
}

/**
 * Conditions JSON shape — all fields optional, engine evaluates what is present.
 * Keeping as plain object validated at service layer for maximum flexibility.
 */
export class PolicyConditionsDto {
  @ApiPropertyOptional({ example: 3 })
  @IsOptional() @IsInt() @Min(0)
  projectCountLessThan?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional() @IsInt() @Min(0)
  projectCountGreaterThan?: number;

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional() @IsInt() @Min(0)
  amountLessThan?: number;

  @ApiPropertyOptional({ example: 5000000 })
  @IsOptional() @IsInt() @Min(0)
  amountGreaterThan?: number;

  /** ISO date string — policy active from this date */
  @ApiPropertyOptional({ example: '2024-01-01T00:00:00Z' })
  @IsOptional() @IsString()
  startDate?: string;

  /** ISO date string — policy expires after this date */
  @ApiPropertyOptional({ example: '2024-12-31T23:59:59Z' })
  @IsOptional() @IsString()
  endDate?: string;
}

export class PolicyActionsDto {
  @ApiProperty({ example: 0, description: 'Commission percentage (0–100)' })
  @IsInt() @Min(0)
  commissionPercent: number = 0;

  @ApiPropertyOptional({ example: 2, description: 'Platform fee percentage override' })
  @IsOptional() @IsInt() @Min(0)
  platformFeePercent?: number;
}

export class CreateCommissionPolicyDto {
  @ApiProperty({ example: 'First 2 Projects Free' })
  @IsString() @MinLength(3) @MaxLength(200)
  name: string = '';

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: CommissionPolicyType })
  @IsEnum(CommissionPolicyType)
  type: CommissionPolicyType = CommissionPolicyType.PROJECT_COUNT;

  @ApiProperty({ example: 100, description: 'Higher priority runs first' })
  @IsInt() @Min(0)
  priority: number = 0;

  @ApiProperty({ type: PolicyConditionsDto })
  @IsObject()
  @Type(() => PolicyConditionsDto)
  conditions: PolicyConditionsDto = {};

  @ApiProperty({ type: PolicyActionsDto })
  @IsObject()
  @Type(() => PolicyActionsDto)
  actions: PolicyActionsDto = { commissionPercent: 0 };

  @ApiPropertyOptional({ type: [String], description: 'Vendor/designer IDs this policy applies to (empty = all)' })
  @IsOptional() @IsArray() @IsString({ each: true })
  applicableDesignerIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'City names this policy applies to (empty = all)' })
  @IsOptional() @IsArray() @IsString({ each: true })
  applicableCities?: string[];

  @ApiPropertyOptional({ type: [String], description: 'State names this policy applies to (empty = all)' })
  @IsOptional() @IsArray() @IsString({ each: true })
  applicableStates?: string[];
}

export class UpdateCommissionPolicyDto extends PartialType(CreateCommissionPolicyDto) {}

export class SetPriorityDto {
  @ApiProperty({ example: 200 })
  @IsInt() @Min(0)
  priority: number = 0;
}

export class ToggleActiveDto {
  @ApiProperty()
  @IsBoolean()
  isActive: boolean = true;
}
