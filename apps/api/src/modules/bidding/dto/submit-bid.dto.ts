import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MaterialQualityLevel {
  ECONOMY = 'ECONOMY',
  STANDARD = 'STANDARD',
  PREMIUM = 'PREMIUM',
  LUXURY = 'LUXURY',
}

/**
 * A single BOQ line item — mirrors real interior design practice.
 * Each item belongs to a room + work category.
 */
export class BidBoqItemDto {
  @ApiProperty({ example: 'Living Room' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  room: string = '';

  @ApiProperty({ example: 'Flooring', description: 'Work category (Flooring, Painting, Furniture, etc.)' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  category: string = '';

  @ApiProperty({ example: 'Italian Marble 600×600mm' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description: string = '';

  @ApiPropertyOptional({ example: 'Kajaria' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  material?: string;

  @ApiPropertyOptional({ example: 'Kajaria Eternity' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @ApiProperty({ example: 120.5 })
  @IsNumber()
  @IsPositive()
  quantity: number = 0;

  @ApiProperty({ example: 'sqft', description: 'Unit of measurement (sqft, rft, nos, ls, etc.)' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  unit: string = '';

  @ApiProperty({ example: 250, description: 'Rate per unit in INR' })
  @IsNumber()
  @IsPositive()
  rateInr: number = 0;

  @ApiPropertyOptional({ example: 'Includes adhesive and grouting' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class SubmitBidDto {
  @ApiProperty()
  @IsString()
  projectId: string = '';

  @ApiProperty({ example: 10, description: 'Proposed timeline in weeks' })
  @IsNumber()
  @Min(1)
  @Max(104)
  timelineWeeks: number = 0;

  @ApiProperty({ enum: MaterialQualityLevel, description: 'Overall material quality tier' })
  @IsEnum(MaterialQualityLevel)
  materialQualityLevel: MaterialQualityLevel = MaterialQualityLevel.STANDARD;

  @ApiProperty({
    type: [BidBoqItemDto],
    description: 'Detailed BOQ line items — at least one required',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BidBoqItemDto)
  boqItems: BidBoqItemDto[] = [];

  @ApiPropertyOptional({ example: 'Excludes electrical rewiring and plumbing.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scopeExclusions?: string;

  @ApiPropertyOptional({ example: 'Site visit required before finalising tile selection.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
