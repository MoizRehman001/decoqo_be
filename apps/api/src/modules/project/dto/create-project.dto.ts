import { IsString, IsOptional, IsEnum, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectType, SpaceType } from '@prisma/client';

export class CreateProjectDto {
  @ApiProperty({ example: '3BHK Living Room Renovation' })
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  title: string = '';

  @ApiProperty({ example: 'Bengaluru' })
  @IsString()
  city: string = '';

  @ApiPropertyOptional({ example: '560001' })
  @IsOptional()
  @IsString()
  pincode?: string;

  @ApiPropertyOptional({ enum: ProjectType })
  @IsOptional()
  @IsEnum(ProjectType)
  projectType?: ProjectType;

  @ApiPropertyOptional({ enum: SpaceType })
  @IsOptional()
  @IsEnum(SpaceType)
  spaceType?: SpaceType;

  @ApiPropertyOptional({ minLength: 10 })
  @IsOptional()
  @IsString()
  @MinLength(10)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
