import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BiddingService } from './bidding.service';
import { SubmitBidDto } from './dto/submit-bid.dto';
import { BrowseProjectsDto } from './dto/browse-projects.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('bidding')
@ApiBearerAuth('access-token')
@Controller({ version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class BiddingController {
  constructor(private readonly biddingService: BiddingService) {}

  // ── Vendor endpoints ───────────────────────────────────────────────────────

  @Get('projects/available')
  @Roles(UserRole.VENDOR)
  @ApiOperation({ summary: 'Browse published projects (vendor)' })
  getAvailableProjects(
    @CurrentUser() user: JwtPayload,
    @Query() filters: BrowseProjectsDto,
    @Query() pagination: PaginationDto,
  ) {
    return this.biddingService.getAvailableProjects(user.sub, filters, pagination);
  }

  @Post('bids')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit anonymous bid' })
  submitBid(@Body() dto: SubmitBidDto, @CurrentUser() user: JwtPayload) {
    return this.biddingService.submitBid(dto, user.sub);
  }

  @Get('bids/mine')
  @Roles(UserRole.VENDOR)
  @ApiOperation({ summary: 'List own bids' })
  getMyBids(@CurrentUser() user: JwtPayload, @Query() pagination: PaginationDto) {
    return this.biddingService.getMyBids(user.sub, pagination);
  }

  @Delete('bids/:id')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw bid (before selection)' })
  withdrawBid(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.biddingService.withdrawBid(id, user.sub);
  }

  // ── Customer endpoints — Bidding Room ─────────────────────────────────────

  @Get('projects/:id/bidding-room')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Get full bidding room state (anonymized bids)' })
  getBiddingRoom(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.biddingService.getBiddingRoom(id, user.sub);
  }

  @Get('projects/:id/bids/:bidId/vendor-preview')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Get vendor profile card (safe fields only, no contact info)' })
  getVendorPreview(
    @Param('id') id: string,
    @Param('bidId') bidId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.biddingService.getVendorProfilePreview(id, bidId, user.sub);
  }

  @Post('projects/:id/bids/:bidId/shortlist')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Shortlist a bid' })
  shortlistBid(
    @Param('id') id: string,
    @Param('bidId') bidId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.biddingService.shortlistBid(id, bidId, user.sub);
  }

  @Post('projects/:id/bids/:bidId/select')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Select vendor — reveals vendor identity' })
  selectVendor(
    @Param('id') id: string,
    @Param('bidId') bidId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.biddingService.selectVendor(id, bidId, user.sub);
  }
}
