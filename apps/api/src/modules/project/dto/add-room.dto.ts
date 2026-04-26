import { IsString, IsInt, IsOptional, IsEnum, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DimensionUnit {
  CM = 'cm',
  FT = 'ft',
  M = 'm',
}

export class AddRoomDto {
  @ApiProperty({ example: 'Living Room' })
  @IsString()
  name: string = '';

  @ApiPropertyOptional({ enum: DimensionUnit, default: DimensionUnit.CM, description: 'Unit for length/width/height values' })
  @IsOptional()
  @IsEnum(DimensionUnit)
  unit?: DimensionUnit;

  @ApiProperty({ example: 450, description: 'Length in the specified unit (cm by default)' })
  @IsInt()
  @Min(1)
  @Max(100000)
  lengthCm: number = 0;

  @ApiProperty({ example: 360, description: 'Width in the specified unit (cm by default)' })
  @IsInt()
  @Min(1)
  @Max(100000)
  widthCm: number = 0;

  @ApiProperty({ example: 300, description: 'Height in the specified unit (cm by default)' })
  @IsInt()
  @Min(1)
  @Max(100000)
  heightCm: number = 0;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
