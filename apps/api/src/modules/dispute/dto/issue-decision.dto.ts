import { IsEnum, IsString, IsOptional, IsNumber, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DisputeDecision } from '@prisma/client';

export class IssueDecisionDto {
  @ApiProperty({ enum: DisputeDecision })
  @IsEnum(DisputeDecision)
  decision: DisputeDecision = DisputeDecision.FULL_RELEASE;

  @ApiProperty({ example: 'Evidence shows 60% completion.' })
  @IsString()
  @MinLength(10)
  reason: string = '';

  @ApiPropertyOptional({ description: 'Required for PARTIAL_RELEASE — amount in INR' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  releaseAmountInr?: number;
}
