import { Controller, Get, Patch, Post, Body, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { VendorService } from './vendor.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('vendors')
@ApiBearerAuth('access-token')
@Controller({ path: 'vendors', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class VendorController {
  constructor(private readonly vendorService: VendorService) {}

  @Get('me')
  @Roles(UserRole.VENDOR)
  getProfile(@CurrentUser() user: JwtPayload) {
    return this.vendorService.getProfile(user.sub);
  }

  @Patch('me')
  @Roles(UserRole.VENDOR)
  updateProfile(@CurrentUser() user: JwtPayload, @Body() body: { bio?: string; serviceAreas?: string[]; categories?: string[] }) {
    return this.vendorService.updateProfile(user.sub, body);
  }

  @Post('kyc')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.OK)
  submitKyc(@CurrentUser() user: JwtPayload, @Body() body: { panNumber: string; bankAccountNumber: string; bankIfsc: string; businessProofUrl?: string }) {
    return this.vendorService.submitKyc(user.sub, body);
  }

  @Get('kyc/status')
  @Roles(UserRole.VENDOR)
  getKycStatus(@CurrentUser() user: JwtPayload) {
    return this.vendorService.getKycStatus(user.sub);
  }

  @Post('me/portfolio')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.CREATED)
  addPortfolio(@CurrentUser() user: JwtPayload, @Body('fileUrl') fileUrl: string) {
    return this.vendorService.addPortfolioItem(user.sub, fileUrl);
  }

  @Post('me/portfolio/remove')
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove portfolio item by URL' })
  removePortfolio(@CurrentUser() user: JwtPayload, @Body('fileUrl') fileUrl: string) {
    return this.vendorService.removePortfolioItem(user.sub, fileUrl);
  }

  @Get(':id/public')
  @ApiOperation({ summary: 'Get public vendor profile (post-selection)' })
  getPublicProfile(@Param('id') id: string) {
    return this.vendorService.getPublicProfile(id);
  }
}
