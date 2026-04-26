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
import { UserRole } from '@prisma/client';
import { IsString, IsArray, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AiDesignService } from './ai-design.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

class GenerateDesignDto {
  @ApiProperty({ example: 'Modern minimalist with warm wood tones and natural light' })
  @IsString()
  themeText: string = '';

  @ApiProperty()
  filters: {
    style: string;
    colorPalette: string[];
    material: string[];
    lighting: string;
    usage: string;
  } = { style: '', colorPalette: [], material: [], lighting: '', usage: '' };

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  referenceImageUrls?: string[];
}

class LockDesignDto {
  @ApiProperty()
  @IsString()
  designId: string = '';
}

@ApiTags('projects')
@ApiBearerAuth('access-token')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiDesignController {
  constructor(private readonly aiDesignService: AiDesignService) {}

  @Post('projects/:id/design/generate')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue AI design generation (async)' })
  generate(
    @Param('id') projectId: string,
    @Body() dto: GenerateDesignDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.aiDesignService.generateDesigns(projectId, user.sub, dto);
  }

  @Get('projects/:id/designs')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'List generated designs for project' })
  listDesigns(@Param('id') projectId: string) {
    return this.aiDesignService.listDesigns(projectId);
  }

  @Post('projects/:id/design/lock')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lock selected design (irreversible)' })
  lockDesign(
    @Param('id') projectId: string,
    @Body() dto: LockDesignDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.aiDesignService.lockDesign(projectId, dto.designId, user.sub);
  }
}
