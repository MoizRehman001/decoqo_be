import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RatingService } from './rating.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

class SubmitRatingDto {
  @ApiProperty()
  @IsString()
  ratedUserId: string = '';

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  score: number = 5;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

@ApiTags('ratings')
@ApiBearerAuth('access-token')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard)
export class RatingController {
  constructor(private readonly ratingService: RatingService) {}

  @Post('projects/:id/ratings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit rating after project closure' })
  submit(
    @Param('id') projectId: string,
    @Body() dto: SubmitRatingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ratingService.submitRating(
      projectId,
      user.sub,
      dto.ratedUserId,
      dto.score,
      dto.comment,
    );
  }

  @Get('projects/:id/ratings')
  @ApiOperation({ summary: 'Get ratings for a project' })
  getProjectRatings(@Param('id') projectId: string) {
    return this.ratingService.getProjectRatings(projectId);
  }

  @Get('vendors/:id/ratings')
  @ApiOperation({ summary: 'Get vendor ratings (public)' })
  getVendorRatings(@Param('id') vendorUserId: string) {
    return this.ratingService.getVendorRatings(vendorUserId);
  }
}
