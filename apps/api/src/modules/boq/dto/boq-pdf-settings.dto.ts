import { IsString, IsNumber, IsBoolean, IsOptional, Min, Max, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';

export class UpdateBoqPdfSettingsDto {
  @ApiPropertyOptional({ example: 'DECOQO CONFIDENTIAL' })
  @IsOptional() @IsString() @MaxLength(100)
  watermarkText?: string;

  @ApiPropertyOptional({ example: 0.08, description: '0.0 (invisible) to 1.0 (opaque)' })
  @IsOptional() @IsNumber() @Min(0) @Max(1)
  watermarkOpacity?: number;

  @ApiPropertyOptional({ example: -45, description: 'Rotation angle in degrees' })
  @IsOptional() @IsNumber() @Min(-180) @Max(180)
  watermarkAngle?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean()
  showClientName?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional() @IsBoolean()
  showTimestamp?: boolean;
}
