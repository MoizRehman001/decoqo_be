import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ModerationService } from '../chat/moderation.service';
import { inrToPaise } from '../../common/utils/money.util';

@Injectable()
export class NegotiationService {
  private readonly logger = new Logger(NegotiationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getThread(projectId: string, userId: string) {
    await this.assertAccess(projectId, userId);

    return this.prisma.negotiationThread.findUniqueOrThrow({
      where: { projectId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        proposals: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async sendMessage(
    projectId: string,
    content: string,
    senderId: string,
    senderRole: UserRole,
  ) {
    const thread = await this.prisma.negotiationThread.findUniqueOrThrow({
      where: { projectId },
    });

    if (thread.status !== 'OPEN') {
      throw new BadRequestException('Negotiation is not open');
    }

    // Moderate — mask contact info before storing
    const { flagged, masked } = await this.moderation.moderateMessage(content, senderId);

    const message = await this.prisma.negotiationMessage.create({
      data: {
        threadId: thread.id,
        senderId,
        senderRole,
        content: masked, // original never stored
        flagged,
      },
    });

    if (flagged) {
      this.logger.warn({
        message: 'Contact info detected in negotiation message',
        projectId,
        senderId,
        messageId: message.id,
      });
    }

    this.eventEmitter.emit('negotiation.message_sent', {
      projectId,
      messageId: message.id,
      flagged,
    });

    return message;
  }

  async submitProposal(
    projectId: string,
    vendorUserId: string,
    proposal: {
      totalQuoteInr: number;
      timelineWeeks: number;
      materialLevel: string;
      notes?: string;
    },
  ) {
    const thread = await this.prisma.negotiationThread.findUniqueOrThrow({
      where: { projectId },
    });

    if (thread.status !== 'OPEN') {
      throw new BadRequestException('Negotiation is not open');
    }

    const vendor = await this.prisma.vendorProfile.findUniqueOrThrow({
      where: { userId: vendorUserId },
    });

    return this.prisma.negotiationProposal.create({
      data: {
        threadId: thread.id,
        submittedBy: vendor.id,
        totalQuotePaise: inrToPaise(proposal.totalQuoteInr),
        timelineWeeks: proposal.timelineWeeks,
        materialLevel: proposal.materialLevel,
        notes: proposal.notes,
        status: 'PENDING',
      },
    });
  }

  async acceptProposal(projectId: string, proposalId: string, customerUserId: string) {
    const thread = await this.prisma.negotiationThread.findUniqueOrThrow({
      where: { projectId },
    });

    await this.prisma.negotiationProposal.update({
      where: { id: proposalId, threadId: thread.id },
      data: { status: 'ACCEPTED' },
    });

    return { accepted: true };
  }

  async confirm(projectId: string, userId: string, userRole: UserRole) {
    const thread = await this.prisma.negotiationThread.findUniqueOrThrow({
      where: { projectId },
    });

    if (thread.status !== 'OPEN') {
      throw new BadRequestException('Negotiation is already confirmed or closed');
    }

    const updateData =
      userRole === UserRole.CUSTOMER
        ? { customerConfirmed: true }
        : { vendorConfirmed: true };

    const updated = await this.prisma.negotiationThread.update({
      where: { id: thread.id },
      data: updateData,
    });

    // If both confirmed, close negotiation
    if (updated.customerConfirmed && updated.vendorConfirmed) {
      await this.prisma.negotiationThread.update({
        where: { id: thread.id },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      });

      this.eventEmitter.emit('negotiation.confirmed', { projectId });
      this.logger.log({ message: 'Negotiation confirmed by both parties', projectId });
    }

    return { confirmed: updated.customerConfirmed && updated.vendorConfirmed };
  }

  private async assertAccess(projectId: string, userId: string): Promise<void> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });

    const customer = await this.prisma.customerProfile.findUnique({ where: { userId } });
    if (customer?.id === project.customerId) return;

    const vendor = await this.prisma.vendorProfile.findUnique({ where: { userId } });
    if (project.selectedBidId) {
      const bid = await this.prisma.bid.findUnique({ where: { id: project.selectedBidId } });
      if (bid?.vendorId === vendor?.id) return;
    }

    throw new ForbiddenException('Access denied to this negotiation');
  }
}
