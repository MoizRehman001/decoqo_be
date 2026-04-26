import { IsString, IsNumber, IsEnum, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { VariationType } from '@prisma/client';

export class RaiseVariationDto {
  @ApiProperty({ enum: VariationType })
  @IsEnum(VariationType)
  type: VariationType = VariationType.POSITIVE;

  @ApiProperty({ example: 'Customer requested upgrade to Italian marble flooring' })
  @IsString()
  reason: string = '';

  @ApiProperty({ example: 46800, description: 'Delta amount in INR (positive or negative)' })
  @IsNumber()
  deltaAmountInr: number = 0;

  @ApiProperty({ type: [Object] })
  @IsArray()
  affectedItems: object[] = [];
}
