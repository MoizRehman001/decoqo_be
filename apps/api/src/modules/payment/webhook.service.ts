import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { RazorpayService } from './razorpay.service';
import { EscrowStateService } from './escrow-state.service';

interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  amount: number;
  method: string;
}

interface RazorpayTransferEntity {
  id: string;
  source: string;
  amount: number;
}

interface RazorpayRefundEntity {
  id: string;
  payment_id: string;
  amount: number;
}

interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
    transfer?: { entity: RazorpayTransferEntity };
    refund?: { entity: RazorpayRefundEntity };
  };
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
    private readonly escrowState: EscrowStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async processRazorpayWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const bodyString = rawBody.toString();

    // 1. Verify signature
    if (!this.razorpay.verifyWebhookSignature(bodyString, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const payload = JSON.parse(bodyString) as RazorpayWebhookPayload;
    const entityId =
      payload.payload.payment?.entity?.id ??
      payload.payload.transfer?.entity?.id ??
      payload.payload.refund?.entity?.id ??
      'unknown';

    const idempotencyKey = `razorpay:${payload.event}:${entityId}`;

    // 2. Idempotency check
    const existing = await this.prisma.webhookEvent.findUnique({ where: { idempotencyKey } });
    if (existing?.processed) {
      this.logger.debug({ message: 'Webhook already processed', idempotencyKey });
      return;
    }

    // 3. Store webhook event
    const webhookEvent = await this.prisma.webhookEvent.upsert({
      where: { idempotencyKey },
      create: {
        source: 'RAZORPAY',
        eventType: payload.event,
        payload: payload as object,
        signature,
        verified: true,
        idempotencyKey,
      },
      update: {},
    });

    // 4. Process event
    try {
      await this.handleEvent(payload);

      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processed: true, processedAt: new Date() },
      });
    } catch (error) {
      await this.prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { error: (error as Error).message },
      });
      throw error;
    }
  }

  private async handleEvent(payload: RazorpayWebhookPayload): Promise<void> {
    switch (payload.event) {
      case 'payment.captured':
        await this.handlePaymentCaptured(payload.payload.payment!.entity);
        break;
      case 'payment.failed':
        await this.handlePaymentFailed(payload.payload.payment!.entity);
        break;
      case 'transfer.processed':
        await this.handleTransferProcessed(payload.payload.transfer!.entity);
        break;
      case 'transfer.failed':
        await this.handleTransferFailed(payload.payload.transfer!.entity);
        break;
      case 'refund.processed':
        await this.handleRefundProcessed(payload.payload.refund!.entity);
        break;
      default:
        this.logger.warn({ message: 'Unhandled webhook event', event: payload.event });
    }
  }

  private async handlePaymentCaptured(payment: RazorpayPaymentEntity): Promise<void> {
    const paymentRecord = await this.prisma.payment.findUnique({
      where: { razorpayOrderId: payment.order_id },
    });

    if (!paymentRecord) {
      this.logger.error({ message: 'Payment record not found', orderId: payment.order_id });
      return;
    }

    await this.prisma.payment.update({
      where: { id: paymentRecord.id },
      data: { status: 'CAPTURED', razorpayPaymentId: payment.id, method: payment.method },
    });

    const escrow = await this.prisma.escrowAccount.findUnique({
      where: { razorpayOrderId: payment.order_id },
    });

    if (escrow) {
      await this.escrowState.fund(
        escrow.id,
        payment.id,
        payment.amount,
        `fund:${payment.id}`,
      );
    }

    this.eventEmitter.emit('payment.captured', { paymentId: payment.id, orderId: payment.order_id });
    this.logger.log({ message: 'Payment captured', paymentId: payment.id });
  }

  private async handlePaymentFailed(payment: RazorpayPaymentEntity): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { razorpayOrderId: payment.order_id },
      data: { status: 'FAILED' },
    });

    this.eventEmitter.emit('payment.failed', { orderId: payment.order_id });
    this.logger.warn({ message: 'Payment failed', orderId: payment.order_id });
  }

  private async handleTransferProcessed(transfer: RazorpayTransferEntity): Promise<void> {
    await this.prisma.escrowTransaction.updateMany({
      where: { type: 'RELEASE', status: 'PENDING' },
      data: { status: 'SUCCESS', razorpayTransferId: transfer.id, processedAt: new Date() },
    });

    this.eventEmitter.emit('transfer.processed', { transferId: transfer.id });
    this.logger.log({ message: 'Transfer processed', transferId: transfer.id });
  }

  private async handleTransferFailed(transfer: RazorpayTransferEntity): Promise<void> {
    await this.prisma.escrowTransaction.updateMany({
      where: { type: 'RELEASE', status: 'PENDING' },
      data: { status: 'FAILED' },
    });

    this.eventEmitter.emit('transfer.failed', { transferId: transfer.id });
    this.logger.error({ message: 'Transfer FAILED — admin intervention required', transferId: transfer.id });
  }

  private async handleRefundProcessed(refund: RazorpayRefundEntity): Promise<void> {
    await this.prisma.escrowTransaction.updateMany({
      where: { type: 'REFUND', status: 'PENDING' },
      data: { status: 'SUCCESS', razorpayRefundId: refund.id, processedAt: new Date() },
    });

    this.eventEmitter.emit('refund.processed', { refundId: refund.id });
    this.logger.log({ message: 'Refund processed', refundId: refund.id });
  }
}
