import { IsString, IsArray, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitMilestoneDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  completionNotes?: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  evidenceIds: string[] = [];
}
