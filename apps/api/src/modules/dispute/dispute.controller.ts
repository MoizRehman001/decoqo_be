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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { DisputeService } from './dispute.service';
import { RaiseDisputeDto } from './dto/raise-dispute.dto';
import { IssueDecisionDto } from './dto/issue-decision.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('disputes')
@ApiBearerAuth('access-token')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class DisputeController {
  constructor(private readonly disputeService: DisputeService) {}

  @Post('disputes')
  @Roles(UserRole.CUSTOMER, UserRole.VENDOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Raise a dispute on a milestone' })
  raise(@Body() dto: RaiseDisputeDto, @CurrentUser() user: JwtPayload) {
    return this.disputeService.raise(dto, user.sub, user.role as UserRole);
  }

  @Get('disputes/:id')
  @ApiOperation({ summary: 'Get dispute detail' })
  findById(@Param('id') id: string) {
    return this.disputeService.findById(id);
  }

  @Post('disputes/:id/evidence')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload evidence for dispute' })
  uploadEvidence(
    @Param('id') id: string,
    @Body() body: { fileUrl: string; fileName: string; description?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.disputeService.uploadEvidence(id, body.fileUrl, body.fileName, body.description ?? '', user.sub);
  }

  @Get('disputes/:id/evidence')
  @ApiOperation({ summary: 'List evidence for dispute' })
  listEvidence(@Param('id') id: string) {
    return this.disputeService.listEvidence(id);
  }

  // ── Admin endpoints ────────────────────────────────────────────────────────

  @Get('admin/disputes')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Admin: List all disputes' })
  listAll(@Query() pagination: PaginationDto, @Query('status') status?: string) {
    return this.disputeService.listAll(pagination, status);
  }

  @Get('admin/disputes/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Admin: Get dispute with full context' })
  adminFindById(@Param('id') id: string) {
    return this.disputeService.findById(id);
  }

  @Post('admin/disputes/:id/decision')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: Issue dispute decision' })
  issueDecision(
    @Param('id') id: string,
    @Body() dto: IssueDecisionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.disputeService.issueDecision(id, dto, user.sub);
  }
}
