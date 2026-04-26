import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BoqService } from './boq.service';
import { AddBoqItemDto } from './dto/add-boq-item.dto';
import { RaiseVariationDto } from './dto/raise-variation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('boq')
@ApiBearerAuth('access-token')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class BoqController {
  constructor(private readonly boqService: BoqService) {}

  @Post('projects/:id/boq')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create BOQ for project' })
  create(@Param('id') projectId: string, @CurrentUser() user: JwtPayload) {
    return this.boqService.create(projectId, user.sub);
  }

  @Get('projects/:id/boq')
  @ApiOperation({ summary: 'Get current BOQ for project' })
  getByProject(@Param('id') projectId: string) {
    return this.boqService.getByProject(projectId);
  }

  @Post('boq/:id/items')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add item to BOQ' })
  addItem(
    @Param('id') boqId: string,
    @Body() dto: AddBoqItemDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.boqService.addItem(boqId, dto, user.sub);
  }

  @Patch('boq/:id/items/:itemId')
  @Roles(UserRole.VENDOR)
  @ApiOperation({ summary: 'Update BOQ item' })
  updateItem(
    @Param('id') boqId: string,
    @Param('itemId') itemId: string,
    @Body() dto: Partial<AddBoqItemDto>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.boqService.updateItem(boqId, itemId, dto, user.sub);
  }

  @Delete('boq/:id/items/:itemId')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove BOQ item' })
  removeItem(
    @Param('id') boqId: string,
    @Param('itemId') itemId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.boqService.removeItem(boqId, itemId, user.sub);
  }

  @Post('boq/:id/submit')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit BOQ for customer review' })
  submit(@Param('id') boqId: string, @CurrentUser() user: JwtPayload) {
    return this.boqService.submit(boqId, user.sub);
  }

  @Post('boq/:id/approve')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer approves BOQ' })
  approve(@Param('id') boqId: string, @CurrentUser() user: JwtPayload) {
    return this.boqService.approve(boqId, user.sub);
  }

  @Post('boq/:id/request-changes')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer requests changes to BOQ' })
  requestChanges(
    @Param('id') boqId: string,
    @Body('reason') reason: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.boqService.requestChanges(boqId, user.sub, reason);
  }

  @Post('boq/:id/lock')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lock approved BOQ' })
  lock(@Param('id') boqId: string, @CurrentUser() user: JwtPayload) {
    return this.boqService.lock(boqId, user.sub);
  }

  @Get('boq/:id/versions')
  @ApiOperation({ summary: 'List BOQ versions' })
  getVersions(@Param('id') boqId: string) {
    return this.boqService.getVersions(boqId);
  }

  @Post('boq/:id/variations')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Raise variation on locked BOQ' })
  raiseVariation(
    @Param('id') boqId: string,
    @Body() dto: RaiseVariationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.boqService.raiseVariation(boqId, dto, user.sub);
  }

  @Get('boq/:id/variations')
  @ApiOperation({ summary: 'List variations for BOQ' })
  getVariations(@Param('id') boqId: string) {
    return this.boqService.getVariations(boqId);
  }

  @Post('boq/:id/variations/:varId/approve')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer approves variation' })
  approveVariation(
    @Param('id') boqId: string,
    @Param('varId') varId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.boqService.approveVariation(boqId, varId, user.sub);
  }

  @Post('boq/:id/variations/:varId/reject')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer rejects variation' })
  rejectVariation(
    @Param('id') boqId: string,
    @Param('varId') varId: string,
    @Body('reason') reason: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.boqService.rejectVariation(boqId, varId, user.sub, reason);
  }

  @Get('boq/:id/quotation/pdf')
  @ApiOperation({ summary: 'Generate and download BOQ quotation PDF' })
  generatePdf(@Param('id') boqId: string, @CurrentUser() user: JwtPayload) {
    return this.boqService.generatePdf(boqId, user.sub);
  }
}
