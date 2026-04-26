import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MilestoneStatus, TimelineEventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EscrowStateService } from '../payment/escrow-state.service';
import { MilestoneStateException, MilestonePercentageException } from '../../common/exceptions/business.exceptions';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { SubmitMilestoneDto } from './dto/submit-milestone.dto';

@Injectable()
export class MilestoneService {
  private readonly logger = new Logger(MilestoneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escrowState: EscrowStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(projectId: string, dto: CreateMilestoneDto, userId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });

    if (!['VENDOR_SELECTED', 'MILESTONES_LOCKED'].includes(project.status)) {
      throw new BadRequestException('Milestones can only be created after vendor selection');
    }

    const existing = await this.prisma.milestone.findMany({ where: { projectId } });
    const sequence = existing.length + 1;

    return this.prisma.milestone.create({
      data: { projectId, ...dto, sequence },
    });
  }

  async findAll(projectId: string) {
    return this.prisma.milestone.findMany({
      where: { projectId },
      include: { escrowAccount: true },
      orderBy: { sequence: 'asc' },
    });
  }

  async lockAll(projectId: string, userId: string) {
    const milestones = await this.prisma.milestone.findMany({ where: { projectId } });

    const total = milestones.reduce((sum, m) => sum + m.percentage, 0);
    if (total !== 100) throw new MilestonePercentageException(total);

    // Transition to PENDING_FUNDING — awaiting customer escrow funding
    // Cast required until `prisma generate` picks up the new enum value
    await this.prisma.milestone.updateMany({
      where: { projectId },
      data: { status: 'PENDING_FUNDING' as MilestoneStatus, lockedAt: new Date() },
    });

    await this.prisma.trustTimelineEvent.create({
      data: {
        projectId,
        eventType: TimelineEventType.MILESTONES_LOCKED,
        actorId: userId,
      },
    });

    return { locked: true, count: milestones.length };
  }

  async start(milestoneId: string, vendorUserId: string) {
    const milestone = await this.prisma.milestone.findUniqueOrThrow({
      where: { id: milestoneId },
      include: { escrowAccount: true },
    });

    if (milestone.status !== MilestoneStatus.FUNDED) {
      throw new MilestoneStateException(milestone.status, MilestoneStatus.FUNDED);
    }

    if (milestone.escrowAccount?.status !== 'FUNDED') {
      throw new BadRequestException('Escrow must be FUNDED before starting milestone');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.milestone.update({
        where: { id: milestoneId },
        data: { status: MilestoneStatus.IN_PROGRESS, startedAt: new Date() },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: milestone.projectId,
          eventType: TimelineEventType.MILESTONE_STARTED,
          actorId: vendorUserId,
          metadata: { milestoneId },
        },
      });

      return result;
    });

    this.eventEmitter.emit('milestone.started', { milestoneId, projectId: milestone.projectId });
    return updated;
  }

  async requestChanges(milestoneId: string, notes: string, customerUserId: string) {    const milestone = await this.prisma.milestone.findUniqueOrThrow({ where: { id: milestoneId } });

    if (milestone.status !== MilestoneStatus.SUBMITTED) {
      throw new MilestoneStateException(milestone.status, MilestoneStatus.SUBMITTED);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.milestone.update({
        where: { id: milestoneId },
        data: { status: MilestoneStatus.IN_PROGRESS },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: milestone.projectId,
          eventType: TimelineEventType.MILESTONE_SUBMITTED, // reuse — no dedicated event type
          actorId: customerUserId,
          metadata: { milestoneId, action: 'CHANGES_REQUESTED', notes },
        },
      });

      return result;
    });

    this.eventEmitter.emit('milestone.changes_requested', { milestoneId, projectId: milestone.projectId, notes });
    return updated;
  }

  async uploadEvidence(
    milestoneId: string,
    data: { fileUrl: string; fileName: string; fileSizeKb: number; mimeType: string; description?: string },
    uploadedBy: string,
  ) {
    const milestone = await this.prisma.milestone.findUniqueOrThrow({ where: { id: milestoneId } });

    if (!['IN_PROGRESS', 'SUBMITTED', 'CHANGES_REQUESTED'].includes(milestone.status)) {
      throw new BadRequestException('Evidence can only be uploaded when milestone is in progress or submitted');
    }

    return this.prisma.milestoneEvidence.create({
      data: {
        milestoneId,
        fileUrl: data.fileUrl,
        fileName: data.fileName,
        fileSizeKb: data.fileSizeKb,
        mimeType: data.mimeType,
        description: data.description,
        uploadedBy,
      },
    });
  }

  async submit(milestoneId: string, dto: SubmitMilestoneDto, vendorUserId: string) {
    const milestone = await this.prisma.milestone.findUniqueOrThrow({ where: { id: milestoneId } });

    if (milestone.status !== MilestoneStatus.IN_PROGRESS) {
      throw new MilestoneStateException(milestone.status, MilestoneStatus.IN_PROGRESS);
    }

    if (!dto.evidenceIds || dto.evidenceIds.length === 0) {
      throw new BadRequestException('At least one evidence file is required');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.milestone.update({
        where: { id: milestoneId },
        data: { status: MilestoneStatus.SUBMITTED, submittedAt: new Date() },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: milestone.projectId,
          eventType: TimelineEventType.MILESTONE_SUBMITTED,
          actorId: vendorUserId,
          metadata: { milestoneId, evidenceCount: dto.evidenceIds.length },
        },
      });

      return result;
    });

    this.eventEmitter.emit('milestone.submitted', { milestoneId, projectId: milestone.projectId });
    return updated;
  }

  async approve(milestoneId: string, customerUserId: string) {
    const milestone = await this.prisma.milestone.findUniqueOrThrow({
      where: { id: milestoneId },
      include: { escrowAccount: true, project: { include: { selectedBid: { include: { vendor: true } } } } },
    });

    if (milestone.status !== MilestoneStatus.SUBMITTED) {
      throw new MilestoneStateException(milestone.status, MilestoneStatus.SUBMITTED);
    }

    if (!milestone.escrowAccount) {
      throw new BadRequestException('No escrow account found');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.milestone.update({
        where: { id: milestoneId },
        data: { status: MilestoneStatus.APPROVED, approvedAt: new Date() },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: milestone.projectId,
          eventType: TimelineEventType.MILESTONE_APPROVED,
          actorId: customerUserId,
          metadata: { milestoneId },
        },
      });

      return result;
    });

    // Queue escrow release (outbox pattern)
    const idempotencyKey = `release:${milestoneId}:${milestone.escrowAccount.id}`;
    await this.escrowState.queueRelease(
      milestone.escrowAccount.id,
      milestone.escrowAccount.amountPaise,
      idempotencyKey,
    );

    this.eventEmitter.emit('milestone.approved', { milestoneId, projectId: milestone.projectId });
    return updated;
  }
}
