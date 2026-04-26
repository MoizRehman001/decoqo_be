import { IsInt, IsEnum, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BudgetFlexibility, PriorityMode } from '@prisma/client';

export class SetBudgetDto {
  @ApiProperty({ example: 50000000, description: 'Minimum budget in paise (₹5L = 50000000)' })
  @IsInt()
  @Min(0)
  budgetMin: number = 0;

  @ApiProperty({ example: 150000000, description: 'Maximum budget in paise' })
  @IsInt()
  @Min(0)
  budgetMax: number = 0;

  @ApiPropertyOptional({ enum: BudgetFlexibility })
  @IsOptional()
  @IsEnum(BudgetFlexibility)
  budgetFlexibility?: BudgetFlexibility;

  @ApiProperty({ example: 12, description: 'Timeline in weeks' })
  @IsInt()
  @Min(1)
  @Max(104)
  timelineWeeks: number = 0;

  @ApiPropertyOptional({ enum: PriorityMode })
  @IsOptional()
  @IsEnum(PriorityMode)
  priorityMode?: PriorityMode;
}
