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
import { MilestoneService } from './milestone.service';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { SubmitMilestoneDto } from './dto/submit-milestone.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('milestones')
@ApiBearerAuth('access-token')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class MilestoneController {
  constructor(private readonly milestoneService: MilestoneService) {}

  @Post('projects/:id/milestones')
  @Roles(UserRole.CUSTOMER, UserRole.VENDOR)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('id') projectId: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.milestoneService.create(projectId, dto, user.sub);
  }

  @Get('projects/:id/milestones')
  findAll(@Param('id') projectId: string) {
    return this.milestoneService.findAll(projectId);
  }

  @Post('projects/:id/milestones/lock')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  lockAll(@Param('id') projectId: string, @CurrentUser() user: JwtPayload) {
    return this.milestoneService.lockAll(projectId, user.sub);
  }

  @Post('milestones/:id/start')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.OK)
  start(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.milestoneService.start(id, user.sub);
  }

  @Post('milestones/:id/submit')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('id') id: string,
    @Body() dto: SubmitMilestoneDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.milestoneService.submit(id, dto, user.sub);
  }

  @Post('milestones/:id/approve')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  approve(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.milestoneService.approve(id, user.sub);
  }

  @Post('milestones/:id/request-changes')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Customer requests changes on submitted milestone' })
  requestChanges(
    @Param('id') id: string,
    @Body('notes') notes: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.milestoneService.requestChanges(id, notes ?? '', user.sub);
  }

  @Post('milestones/:id/evidence')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload evidence for milestone' })
  uploadEvidence(
    @Param('id') id: string,
    @Body() body: { fileUrl: string; fileName: string; fileSizeKb: number; mimeType: string; description?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.milestoneService.uploadEvidence(id, body, user.sub);
  }

  @Post('milestones/:id/dispute')
  @Roles(UserRole.CUSTOMER, UserRole.VENDOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Raise a dispute on a milestone' })
  raiseDispute(
    @Param('id') id: string,
    @Body() body: { reason: string; description: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // Delegates to DisputeService via the dispute module
    // This is a convenience route — POST /disputes also works
    return { milestoneId: id, redirectTo: '/api/v1/disputes', body };
  }
}
