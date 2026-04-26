import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentService } from './payment.service';
import { WebhookService } from './webhook.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('payments')
@Controller({ path: 'payments', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly webhookService: WebhookService,
  ) {}

  @Post('escrow/fund/:milestoneId')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create payment intent to fund milestone escrow' })
  async fundEscrow(
    @Param('milestoneId') milestoneId: string,
    @CurrentUser() user: JwtPayload,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    if (!idempotencyKey) {
      return { success: false, error: { code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' } };
    }
    return this.paymentService.createMilestoneFundingIntent(milestoneId, user.sub, idempotencyKey);
  }

  @Public()
  @Post('webhook/razorpay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Razorpay webhook receiver (internal)' })
  async razorpayWebhook(
    @Req() req: Request,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    // rawBody is available because we set rawBody: true in NestFactory.create
    const rawBody = (req as Request & { rawBody: Buffer }).rawBody;
    await this.webhookService.processRazorpayWebhook(rawBody, signature);
    return { status: 'ok' };
  }

  @Get('escrow/:milestoneId')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get escrow status for a milestone' })
  getEscrowStatus(@Param('milestoneId') milestoneId: string) {
    return this.paymentService.getEscrowStatus(milestoneId);
  }

  @Get('history')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get payment history' })
  getHistory(@CurrentUser() user: JwtPayload) {
    return this.paymentService.getPaymentHistory(user.sub);
  }
}
