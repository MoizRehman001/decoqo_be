import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Escrow ─────────────────────────────────────────────────────────────────

  @Get('admin/escrow')
  @ApiOperation({ summary: 'List all escrow accounts' })
  listEscrows(@Query() pagination: PaginationDto) {
    return this.adminService.listEscrows(pagination);
  }

  @Post('admin/escrow/:id/freeze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Freeze escrow account (hold funds pending investigation)' })
  freezeEscrow(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adminService.freezeEscrow(id, user.sub, reason);
  }

  @Post('admin/escrow/:id/unfreeze')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unfreeze escrow account (restore to FUNDED)' })
  unfreezeEscrow(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adminService.unfreezeEscrow(id, user.sub, reason);
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  @Get('admin/users')
  @ApiOperation({ summary: 'List all users' })
  @ApiQuery({ name: 'search', required: false })
  listUsers(@Query() pagination: PaginationDto, @Query('search') search?: string) {
    return this.adminService.listUsers(pagination, search);
  }

  @Get('admin/users/:id')
  @ApiOperation({ summary: 'Get user detail' })
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Post('admin/users/:id/ban')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ban user (revokes all sessions)' })
  banUser(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adminService.banUser(id, user.sub, reason);
  }

  @Post('admin/users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend user' })
  suspendUser(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adminService.suspendUser(id, user.sub, reason);
  }

  @Post('admin/users/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reinstate user' })
  reinstateUser(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adminService.reinstateUser(id, user.sub, reason);
  }

  // ── Vendors ────────────────────────────────────────────────────────────────

  @Get('admin/vendors')
  @ApiOperation({ summary: 'List vendors' })
  @ApiQuery({ name: 'kycStatus', required: false, enum: ['PENDING', 'APPROVED', 'REJECTED', 'NOT_STARTED'] })
  listVendors(@Query() pagination: PaginationDto, @Query('kycStatus') kycStatus?: string) {
    return this.adminService.listVendors(pagination, kycStatus);
  }

  @Get('admin/vendors/:id')
  @ApiOperation({ summary: 'Get vendor detail' })
  getVendor(@Param('id') id: string) {
    return this.adminService.getVendor(id);
  }

  @Post('admin/vendors/:id/approve-kyc')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve vendor KYC' })
  approveKyc(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.adminService.approveVendorKyc(id, user.sub);
  }

  @Post('admin/vendors/:id/reject-kyc')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject vendor KYC' })
  rejectKyc(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adminService.rejectVendorKyc(id, user.sub, reason);
  }

  @Post('admin/vendors/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend vendor' })
  suspendVendor(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.adminService.suspendVendor(id, user.sub, reason);
  }

  // ── Disputes ───────────────────────────────────────────────────────────────

  @Get('admin/disputes')
  @ApiOperation({ summary: 'List all disputes' })
  @ApiQuery({ name: 'status', required: false, enum: ['OPEN', 'EVIDENCE_COLLECTION', 'ADMIN_REVIEW', 'DECIDED', 'CLOSED'] })
  listDisputes(@Query() pagination: PaginationDto, @Query('status') status?: string) {
    return this.adminService.listDisputes(pagination, status);
  }

  @Get('admin/disputes/:id')
  @ApiOperation({ summary: 'Get dispute detail (full evidence bundle, BOQ, design)' })
  getDisputeDetail(@Param('id') id: string) {
    return this.adminService.getDisputeDetail(id);
  }

  // ── Audit ──────────────────────────────────────────────────────────────────

  @Get('admin/audit-logs')
  @ApiOperation({ summary: 'Search audit logs' })
  @ApiQuery({ name: 'search', required: false })
  getAuditLogs(@Query() pagination: PaginationDto, @Query('search') search?: string) {
    return this.adminService.getAuditLogs(pagination, search);
  }

  // ── Project Timeline ───────────────────────────────────────────────────────

  @Get('admin/projects/:id/timeline')
  @ApiOperation({ summary: 'Full project timeline (admin view)' })
  getProjectTimeline(@Param('id') id: string) {
    return this.adminService.getProjectTimeline(id);
  }
}
