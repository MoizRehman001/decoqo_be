import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CommissionService } from './commission.service';
import {
  CreateCommissionPolicyDto,
  UpdateCommissionPolicyDto,
  SetPriorityDto,
  ToggleActiveDto,
} from './dto/commission-policy.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('commission')
@ApiBearerAuth('access-token')
@Controller({ path: 'admin/commission', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class CommissionController {
  constructor(private readonly commissionService: CommissionService) {}

  // ── Policies ──────────────────────────────────────────────────────────────

  @Post('policies')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create commission policy' })
  create(@Body() dto: CreateCommissionPolicyDto, @CurrentUser() user: JwtPayload) {
    return this.commissionService.createPolicy(dto, user.sub);
  }

  @Get('policies')
  @ApiOperation({ summary: 'List commission policies' })
  @ApiQuery({ name: 'type', required: false, enum: ['PROJECT_COUNT', 'TIME_RANGE', 'AMOUNT_RANGE', 'CUSTOM_OVERRIDE'] })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  list(
    @Query() pagination: PaginationDto,
    @Query('type') type?: string,
    @Query('isActive') isActive?: string,
  ) {
    const active = isActive !== undefined ? isActive === 'true' : undefined;
    return this.commissionService.listPolicies(pagination, type, active);
  }

  @Get('policies/:id')
  @ApiOperation({ summary: 'Get commission policy by ID' })
  getOne(@Param('id') id: string) {
    return this.commissionService.getPolicy(id);
  }

  @Patch('policies/:id')
  @ApiOperation({ summary: 'Update commission policy' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCommissionPolicyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.commissionService.updatePolicy(id, dto, user.sub);
  }

  @Patch('policies/:id/priority')
  @ApiOperation({ summary: 'Set policy priority (higher = evaluated first)' })
  setPriority(
    @Param('id') id: string,
    @Body() dto: SetPriorityDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.commissionService.setPriority(id, dto, user.sub);
  }

  @Patch('policies/:id/active')
  @ApiOperation({ summary: 'Activate or deactivate a policy' })
  toggleActive(
    @Param('id') id: string,
    @Body() dto: ToggleActiveDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.commissionService.toggleActive(id, dto, user.sub);
  }

  @Delete('policies/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete commission policy' })
  delete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.commissionService.deletePolicy(id, user.sub);
  }

  // ── Simulate ──────────────────────────────────────────────────────────────

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Simulate commission for given params — useful for testing policies',
  })
  simulate(
    @Body() body: {
      designerId: string;
      projectAmountPaise: number;
      cityId?: string;
      stateId?: string;
    },
  ) {
    return this.commissionService.getCommission(body);
  }

  // ── Designer Search ───────────────────────────────────────────────────────

  @Get('designers/search')
  @ApiOperation({
    summary: 'Search vendors/designers by name, email, phone, or city — for policy scope assignment',
  })
  @ApiQuery({ name: 'q', required: false, description: 'Search term (name, email, phone, city)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  searchDesigners(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    return this.commissionService.searchDesigners(q, limit ? parseInt(limit, 10) : 20);
  }

  // ── Per-Vendor Overrides ──────────────────────────────────────────────────

  @Get('vendor/:vendorId/override')
  @ApiOperation({ summary: 'Get current per-vendor commission override' })
  getVendorOverride(@Param('vendorId') vendorId: string) {
    return this.commissionService.getVendorOverride(vendorId);
  }

  @Post('vendor/:vendorId/override')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set per-vendor commission override (highest priority)' })
  setVendorOverride(
    @Param('vendorId') vendorId: string,
    @Body() body: { commissionPercent: number; reason: string; expiresAt?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.commissionService.setVendorOverride(vendorId, body, user.sub);
  }

  @Delete('vendor/:vendorId/override')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove per-vendor commission override' })
  removeVendorOverride(
    @Param('vendorId') vendorId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.commissionService.removeVendorOverride(vendorId, user.sub);
  }

  @Get('vendor/:vendorId/summary')
  @ApiOperation({ summary: 'Get vendor commission summary — current policy, history, remaining projects' })
  getVendorSummary(@Param('vendorId') vendorId: string) {
    return this.commissionService.getVendorCommissionSummary(vendorId);
  }

  // ── Commission Applications History ───────────────────────────────────────

  @Get('applications')
  @ApiOperation({ summary: 'List recent commission applications (paginated)' })
  @ApiQuery({ name: 'vendorSearch', required: false, description: 'Filter by vendor name' })
  listApplications(
    @Query() pagination: PaginationDto,
    @Query('vendorSearch') vendorSearch?: string,
  ) {
    return this.commissionService.listCommissionApplications(pagination, vendorSearch);
  }

  // ── Vendor Overrides List ─────────────────────────────────────────────────

  @Get('overrides')
  @ApiOperation({ summary: 'List all active vendor commission overrides' })
  listOverrides() {
    return this.commissionService.listVendorOverrides();
  }
}
