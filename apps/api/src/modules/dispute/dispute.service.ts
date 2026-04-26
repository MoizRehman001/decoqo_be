import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DisputeDecision, TimelineEventType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EscrowStateService } from '../payment/escrow-state.service';
import { RaiseDisputeDto } from './dto/raise-dispute.dto';
import { IssueDecisionDto } from './dto/issue-decision.dto';
import { inrToPaise } from '../../common/utils/money.util';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escrowState: EscrowStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async raise(dto: RaiseDisputeDto, userId: string, userRole: UserRole) {
    const milestone = await this.prisma.milestone.findUniqueOrThrow({
      where: { id: dto.milestoneId },
      include: { project: true, escrowAccount: true },
    });

    if (!['SUBMITTED', 'IN_PROGRESS'].includes(milestone.status)) {
      throw new BadRequestException('Dispute can only be raised on SUBMITTED or IN_PROGRESS milestones');
    }

    const existingDispute = await this.prisma.dispute.findUnique({
      where: { milestoneId: dto.milestoneId },
    });
    if (existingDispute) throw new BadRequestException('A dispute already exists for this milestone');

    const dispute = await this.prisma.$transaction(async (tx) => {
      const newDispute = await tx.dispute.create({
        data: {
          projectId: milestone.projectId,
          milestoneId: dto.milestoneId,
          raisedBy: userId,
          raisedByRole: userRole,
          reason: dto.reason,
          description: dto.description,
          status: 'OPEN',
        },
      });

      // Immediately hold escrow
      if (milestone.escrowAccount) {
        await tx.escrowAccount.update({
          where: { id: milestone.escrowAccount.id },
          data: { status: 'HELD', heldAt: new Date() },
        });

        await tx.escrowTransaction.create({
          data: {
            escrowAccountId: milestone.escrowAccount.id,
            type: 'HOLD',
            amountPaise: 0,
            idempotencyKey: `hold:${milestone.escrowAccount.id}:${newDispute.id}`,
            status: 'SUCCESS',
            processedAt: new Date(),
          },
        });
      }

      // Update milestone status
      await tx.milestone.update({
        where: { id: dto.milestoneId },
        data: { status: 'DISPUTED' },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: milestone.projectId,
          eventType: TimelineEventType.DISPUTE_OPENED,
          actorId: userId,
          metadata: { disputeId: newDispute.id, reason: dto.reason },
        },
      });

      return newDispute;
    });

    this.eventEmitter.emit('dispute.opened', { disputeId: dispute.id, projectId: milestone.projectId });
    this.logger.log({ message: 'Dispute raised', disputeId: dispute.id, milestoneId: dto.milestoneId });

    return {
      disputeId: dispute.id,
      status: dispute.status,
      escrowStatus: 'HELD',
      createdAt: dispute.createdAt,
    };
  }

  async findById(disputeId: string) {
    return this.prisma.dispute.findUniqueOrThrow({
      where: { id: disputeId },
      include: {
        evidence: true,
        milestone: {
          include: {
            escrowAccount: true,
            boqItems: true,
          },
        },
        project: {
          include: {
            lockedDesign: { select: { generatedImages: true } },
          },
        },
      },
    });
  }

  async uploadEvidence(disputeId: string, fileUrl: string, fileName: string, description: string, userId: string) {
    return this.prisma.disputeEvidence.create({
      data: { disputeId, uploadedBy: userId, fileUrl, fileName, description },
    });
  }

  async listEvidence(disputeId: string) {
    return this.prisma.disputeEvidence.findMany({
      where: { disputeId },
      orderBy: { uploadedAt: 'asc' },
    });
  }

  // ── Admin: Issue decision ──────────────────────────────────────────────────

  async issueDecision(disputeId: string, dto: IssueDecisionDto, adminUserId: string) {
    const dispute = await this.prisma.dispute.findUniqueOrThrow({
      where: { id: disputeId },
      include: { milestone: { include: { escrowAccount: true } } },
    });

    if (!['OPEN', 'EVIDENCE_COLLECTION', 'ADMIN_REVIEW'].includes(dispute.status)) {
      throw new BadRequestException('Dispute is not in a decidable state');
    }

    const escrow = dispute.milestone.escrowAccount;
    if (!escrow) throw new BadRequestException('No escrow account found for this milestone');

    const idempotencyKey = `decision:${disputeId}:${dto.decision}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: 'DECIDED',
          decision: dto.decision,
          decisionReason: dto.reason,
          decidedBy: adminUserId,
          decidedAt: new Date(),
          ...(dto.decision === DisputeDecision.PARTIAL_RELEASE && {
            releasePaise: inrToPaise(dto.releaseAmountInr ?? 0),
          }),
        },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: dispute.projectId,
          eventType: TimelineEventType.DISPUTE_DECIDED,
          actorId: adminUserId,
          metadata: { disputeId, decision: dto.decision, reason: dto.reason },
        },
      });
    });

    // Execute financial action based on decision
    switch (dto.decision) {
      case DisputeDecision.FULL_RELEASE:
        await this.escrowState.queueRelease(escrow.id, escrow.amountPaise, idempotencyKey);
        break;

      case DisputeDecision.PARTIAL_RELEASE: {
        const releaseAmount = inrToPaise(dto.releaseAmountInr ?? 0);
        const refundAmount = escrow.amountPaise - releaseAmount;
        await this.escrowState.queueRelease(escrow.id, releaseAmount, `${idempotencyKey}:release`);
        if (refundAmount > 0) {
          await this.escrowState.queueRefund(escrow.id, refundAmount, `${idempotencyKey}:refund`);
        }
        break;
      }

      case DisputeDecision.FULL_REFUND:
        await this.escrowState.queueRefund(escrow.id, escrow.amountPaise, idempotencyKey);
        break;
    }

    this.eventEmitter.emit('dispute.decided', { disputeId, decision: dto.decision });
    this.logger.log({ message: 'Dispute decided', disputeId, decision: dto.decision, adminUserId });

    return {
      disputeId,
      status: 'DECIDED',
      decision: dto.decision,
      decidedAt: new Date(),
    };
  }

  async listAll(pagination: PaginationDto, status?: string) {
    const where = status ? { status: status as never } : {};
    const [items, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        include: {
          milestone: { select: { name: true, amountPaise: true } },
          project: { select: { title: true, city: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.dispute.count({ where }),
    ]);

    return paginate(items, total, pagination);
  }
}
