import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { RazorpayService } from './razorpay.service';
import { EscrowStateService } from './escrow-state.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ReconciliationProcessor {
  private readonly logger = new Logger(ReconciliationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
    private readonly escrowState: EscrowStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async runReconciliation(): Promise<void> {
    this.logger.debug('Running payment reconciliation');

    await Promise.all([
      this.reconcilePendingEscrows(),
      this.alertStalePendingTransactions(),
    ]);
  }

  private async reconcilePendingEscrows(): Promise<void> {
    // Find escrows that should be FUNDED but are still PENDING_FUNDING (> 30 min old)
    const staleEscrows = await this.prisma.escrowAccount.findMany({
      where: {
        status: 'PENDING_FUNDING',
        createdAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
        razorpayOrderId: { not: null },
      },
      take: 50,
    });

    for (const escrow of staleEscrows) {
      try {
        const order = await this.razorpay.getOrder(escrow.razorpayOrderId!);
        if (order.status === 'paid') {
          this.logger.warn({
            message: 'Reconciliation: Escrow should be FUNDED — webhook missed',
            escrowId: escrow.id,
            orderId: escrow.razorpayOrderId,
          });

          // Emit alert for admin
          this.eventEmitter.emit('reconciliation.escrow.missed', {
            escrowId: escrow.id,
            orderId: escrow.razorpayOrderId,
          });
        }
      } catch (error) {
        this.logger.error({
          message: 'Reconciliation check failed',
          escrowId: escrow.id,
          error: (error as Error).message,
        });
      }
    }
  }

  private async alertStalePendingTransactions(): Promise<void> {
    // Find PENDING escrow transactions older than 10 minutes
    const staleTransactions = await this.prisma.escrowTransaction.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
      },
      take: 20,
    });

    for (const tx of staleTransactions) {
      this.logger.warn({
        message: 'Stale PENDING escrow transaction detected',
        transactionId: tx.id,
        type: tx.type,
        idempotencyKey: tx.idempotencyKey,
      });

      this.eventEmitter.emit('reconciliation.transaction.stale', { transactionId: tx.id });
    }
  }
}
