import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RaiseDisputeDto {
  @ApiProperty()
  @IsString()
  milestoneId: string = '';

  @ApiProperty({ example: 'INCOMPLETE_WORK' })
  @IsString()
  reason: string = '';

  @ApiProperty({ example: 'False ceiling installation is incomplete. Only 60% done.' })
  @IsString()
  @MinLength(20)
  description: string = '';
}
