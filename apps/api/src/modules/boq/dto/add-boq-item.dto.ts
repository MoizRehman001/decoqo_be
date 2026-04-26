import { IsString, IsNumber, IsOptional, Min, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddBoqItemDto {
  @ApiProperty({ example: 'Living Room' })
  @IsString()
  room: string = '';

  @ApiProperty({ example: 'FALSE_CEILING' })
  @IsString()
  category: string = '';

  @ApiProperty({ example: 'Gypsum false ceiling with cove lighting provision' })
  @IsString()
  description: string = '';

  @ApiPropertyOptional({ example: 'Gypsum Board 12.5mm' })
  @IsOptional()
  @IsString()
  material?: string;

  @ApiPropertyOptional({ example: 'Saint-Gobain' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiProperty({ example: 280 })
  @IsNumber()
  @Min(0.01)
  quantity: number = 0;

  @ApiProperty({ example: 'sqft' })
  @IsString()
  unit: string = '';

  @ApiProperty({ example: 85, description: 'Rate per unit in INR' })
  @IsNumber()
  @Min(0)
  rateInr: number = 0;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  milestoneId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
