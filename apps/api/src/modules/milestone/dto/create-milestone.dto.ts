import { IsString, IsInt, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMilestoneDto {
  @ApiProperty({ example: 'Material Procurement' })
  @IsString()
  name: string = '';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 30, description: 'Percentage of total project value (all must sum to 100)' })
  @IsInt()
  @Min(1)
  @Max(100)
  percentage: number = 0;
}
