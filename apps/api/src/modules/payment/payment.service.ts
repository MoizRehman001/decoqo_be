import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RazorpayService } from './razorpay.service';
import { EscrowStateService } from './escrow-state.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
    private readonly escrowState: EscrowStateService,
    private readonly configService: ConfigService,
  ) {}

  async createMilestoneFundingIntent(
    milestoneId: string,
    customerId: string,
    idempotencyKey: string,
  ) {
    const milestone = await this.prisma.milestone.findUniqueOrThrow({
      where: { id: milestoneId },
      include: { project: true },
    });

    if (milestone.status !== 'LOCKED') {
      throw new BadRequestException('Milestone must be LOCKED to fund');
    }

    const customer = await this.prisma.customerProfile.findUnique({ where: { userId: customerId } });
    if (!customer || milestone.project.customerId !== customer.id) {
      throw new ForbiddenException();
    }

    if (!milestone.amountPaise || milestone.amountPaise <= 0) {
      throw new BadRequestException('Milestone amount not set');
    }

    // Idempotency check
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing?.razorpayOrderId) {
      return {
        razorpayOrderId: existing.razorpayOrderId,
        amountPaise: existing.amountPaise,
        currency: 'INR',
        keyId: this.configService.get<string>('razorpay.keyId'),
      };
    }

    const order = await this.razorpay.createOrder({
      amountPaise: milestone.amountPaise,
      currency: 'INR',
      receipt: `milestone_${milestoneId}`,
      notes: { milestoneId, projectId: milestone.projectId, customerId },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          milestoneId,
          projectId: milestone.projectId,
          userId: customerId,
          amountPaise: milestone.amountPaise!,
          currency: 'INR',
          status: 'CREATED',
          razorpayOrderId: order.id,
          idempotencyKey,
        },
      });

      await tx.escrowAccount.upsert({
        where: { milestoneId },
        create: {
          milestoneId,
          amountPaise: milestone.amountPaise!,
          status: 'PENDING_FUNDING',
          razorpayOrderId: order.id,
        },
        update: { razorpayOrderId: order.id },
      });
    });

    this.logger.log({
      message: 'Milestone funding intent created',
      milestoneId,
      amountPaise: milestone.amountPaise,
      orderId: order.id,
    });

    return {
      razorpayOrderId: order.id,
      amountPaise: milestone.amountPaise,
      currency: 'INR',
      keyId: this.configService.get<string>('razorpay.keyId'),
    };
  }

  async getEscrowStatus(milestoneId: string) {
    return this.prisma.escrowAccount.findUnique({
      where: { milestoneId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
  }

  async getPaymentHistory(userId: string) {
    return this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
