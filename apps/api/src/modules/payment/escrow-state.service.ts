import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EscrowStatus, TimelineEventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EscrowStateException } from '../../common/exceptions/business.exceptions';

@Injectable()
export class EscrowStateService {
  private readonly logger = new Logger(EscrowStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Fund escrow — called after Razorpay payment.captured webhook.
   * Idempotent: safe to call multiple times with same idempotencyKey.
   */
  async fund(
    escrowId: string,
    razorpayPaymentId: string,
    amountPaise: number,
    idempotencyKey: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Idempotency check
      const existing = await tx.escrowTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        this.logger.debug({ message: 'Escrow fund already processed', idempotencyKey });
        return;
      }

      // Lock row to prevent race conditions
      const escrow = await tx.$queryRaw<Array<{ id: string; status: string; milestone_id: string }>>`
        SELECT id, status, milestone_id FROM escrow_accounts WHERE id = ${escrowId} FOR UPDATE
      `;

      if (!escrow[0]) throw new Error(`Escrow ${escrowId} not found`);
      if (escrow[0].status !== EscrowStatus.PENDING_FUNDING) {
        this.logger.warn({ message: 'Escrow already funded', escrowId, status: escrow[0].status });
        return; // Idempotent
      }

      await tx.escrowAccount.update({
        where: { id: escrowId },
        data: { status: EscrowStatus.FUNDED, razorpayPaymentId, fundedAt: new Date() },
      });

      await tx.milestone.update({
        where: { id: escrow[0].milestone_id },
        data: { status: 'FUNDED', fundedAt: new Date() },
      });      await tx.escrowTransaction.create({
        data: {
          escrowAccountId: escrowId,
          type: 'FUND',
          amountPaise,
          idempotencyKey,
          status: 'SUCCESS',
          processedAt: new Date(),
        },
      });

      const milestone = await tx.milestone.findUnique({ where: { id: escrow[0].milestone_id } });
      if (milestone) {
        await tx.trustTimelineEvent.create({
          data: {
            projectId: milestone.projectId,
            eventType: TimelineEventType.ESCROW_FUNDED,
            metadata: { escrowId, milestoneId: milestone.id, amountPaise },
          },
        });
      }
    });

    this.eventEmitter.emit('escrow.funded', { escrowId });
    this.logger.log({ message: 'Escrow funded', escrowId, amountPaise });
  }

  /**
   * Hold escrow — called immediately when dispute is raised.
   */
  async hold(escrowId: string, disputeId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const escrow = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM escrow_accounts WHERE id = ${escrowId} FOR UPDATE
      `;

      if (!escrow[0]) throw new Error(`Escrow ${escrowId} not found`);
      if (escrow[0].status === EscrowStatus.HELD) return; // Already held

      if (escrow[0].status !== EscrowStatus.FUNDED) {
        throw new EscrowStateException(escrow[0].status, EscrowStatus.FUNDED);
      }

      await tx.escrowAccount.update({
        where: { id: escrowId },
        data: { status: EscrowStatus.HELD, heldAt: new Date() },
      });

      await tx.escrowTransaction.create({
        data: {
          escrowAccountId: escrowId,
          type: 'HOLD',
          amountPaise: 0,
          idempotencyKey: `hold:${escrowId}:${disputeId}`,
          status: 'SUCCESS',
          processedAt: new Date(),
        },
      });
    });

    this.logger.log({ message: 'Escrow held', escrowId, disputeId });
  }

  /**
   * Queue release — outbox pattern. Writes PENDING transaction, worker calls Razorpay.
   */
  async queueRelease(
    escrowId: string,
    amountPaise: number,
    idempotencyKey: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.escrowTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) return;

      const escrow = await tx.$queryRaw<Array<{ id: string; status: string; milestone_id: string }>>`
        SELECT id, status, milestone_id FROM escrow_accounts WHERE id = ${escrowId} FOR UPDATE
      `;

      if (!escrow[0]) throw new Error(`Escrow ${escrowId} not found`);

      const validStates: string[] = ['FUNDED', 'HELD'];
      if (!validStates.includes(escrow[0].status as string)) {
        throw new EscrowStateException(escrow[0].status, 'FUNDED or HELD');
      }

      // Write outbox record — worker picks this up and calls Razorpay
      await tx.escrowTransaction.create({
        data: {
          escrowAccountId: escrowId,
          type: 'RELEASE',
          amountPaise,
          idempotencyKey,
          status: 'PENDING',
        },
      });

      await tx.escrowAccount.update({
        where: { id: escrowId },
        data: { status: EscrowStatus.RELEASED, releasedAt: new Date() },
      });

      await tx.milestone.update({
        where: { id: escrow[0].milestone_id },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });

      const milestone = await tx.milestone.findUnique({ where: { id: escrow[0].milestone_id } });
      if (milestone) {
        await tx.trustTimelineEvent.create({
          data: {
            projectId: milestone.projectId,
            eventType: TimelineEventType.ESCROW_RELEASED,
            metadata: { escrowId, milestoneId: milestone.id, amountPaise },
          },
        });
      }
    });

    this.eventEmitter.emit('escrow.release.queued', { escrowId, amountPaise, idempotencyKey });
    this.logger.log({ message: 'Escrow release queued', escrowId, amountPaise });
  }

  /**
   * Queue refund — outbox pattern.
   */
  async queueRefund(
    escrowId: string,
    amountPaise: number,
    idempotencyKey: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.escrowTransaction.findUnique({ where: { idempotencyKey } });
      if (existing) return;

      const escrow = await tx.$queryRaw<Array<{ id: string; status: string; milestone_id: string }>>`
        SELECT id, status, milestone_id FROM escrow_accounts WHERE id = ${escrowId} FOR UPDATE
      `;

      if (!escrow[0]) throw new Error(`Escrow ${escrowId} not found`);

      await tx.escrowTransaction.create({
        data: {
          escrowAccountId: escrowId,
          type: 'REFUND',
          amountPaise,
          idempotencyKey,
          status: 'PENDING',
        },
      });

      await tx.escrowAccount.update({
        where: { id: escrowId },
        data: { status: EscrowStatus.REFUNDED, refundedAt: new Date() },
      });

      await tx.milestone.update({
        where: { id: escrow[0].milestone_id },
        data: { status: 'REFUNDED' },
      });

      const milestone = await tx.milestone.findUnique({ where: { id: escrow[0].milestone_id } });
      if (milestone) {
        await tx.trustTimelineEvent.create({
          data: {
            projectId: milestone.projectId,
            eventType: TimelineEventType.ESCROW_REFUNDED,
            metadata: { escrowId, milestoneId: milestone.id, amountPaise },
          },
        });
      }
    });

    this.eventEmitter.emit('escrow.refund.queued', { escrowId, amountPaise, idempotencyKey });
    this.logger.log({ message: 'Escrow refund queued', escrowId, amountPaise });
  }
}
