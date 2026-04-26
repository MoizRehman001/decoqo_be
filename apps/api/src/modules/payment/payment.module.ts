import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { WebhookService } from './webhook.service';
import { RazorpayService } from './razorpay.service';
import { EscrowStateService } from './escrow-state.service';
import { ReconciliationProcessor } from './reconciliation.processor';

@Module({
  controllers: [PaymentController],
  providers: [
    PaymentService,
    WebhookService,
    RazorpayService,
    EscrowStateService,
    ReconciliationProcessor,
  ],
  exports: [PaymentService, EscrowStateService, RazorpayService],
})
export class PaymentModule {}
