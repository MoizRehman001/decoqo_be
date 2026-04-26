import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProjectStatus, TimelineEventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectStateException, MilestonePercentageException } from '../../common/exceptions/business.exceptions';

const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  DRAFT: [ProjectStatus.AI_GENERATED, ProjectStatus.BIDDING_OPEN, ProjectStatus.CANCELLED],
  AI_GENERATED: [ProjectStatus.DESIGN_LOCKED],
  DESIGN_LOCKED: [ProjectStatus.BIDDING_OPEN],
  BIDDING_OPEN: [ProjectStatus.VENDOR_SELECTED],
  VENDOR_SELECTED: [ProjectStatus.MILESTONES_LOCKED],
  MILESTONES_LOCKED: [ProjectStatus.EXECUTION_ACTIVE],
  EXECUTION_ACTIVE: [ProjectStatus.COMPLETED],
  COMPLETED: [ProjectStatus.CLOSED],
  CLOSED: [],
  CANCELLED: [],
};

const STATUS_TO_TIMELINE_EVENT: Partial<Record<ProjectStatus, TimelineEventType>> = {
  [ProjectStatus.BIDDING_OPEN]: TimelineEventType.PROJECT_PUBLISHED,
  [ProjectStatus.VENDOR_SELECTED]: TimelineEventType.VENDOR_SELECTED,
  [ProjectStatus.MILESTONES_LOCKED]: TimelineEventType.MILESTONES_LOCKED,
  [ProjectStatus.COMPLETED]: TimelineEventType.PROJECT_COMPLETED,
  [ProjectStatus.CLOSED]: TimelineEventType.PROJECT_CLOSED,
};

@Injectable()
export class ProjectStateService {
  private readonly logger = new Logger(ProjectStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async transition(
    projectId: string,
    targetStatus: ProjectStatus,
    actorId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });

      const allowed = VALID_TRANSITIONS[project.status];
      if (!allowed.includes(targetStatus)) {
        throw new ProjectStateException(project.status, targetStatus);
      }

      await this.validateGuards(tx, project, targetStatus);

      await tx.project.update({
        where: { id: projectId },
        data: {
          status: targetStatus,
          ...(targetStatus === ProjectStatus.BIDDING_OPEN && {
            publishedAt: new Date(),
            biddingExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          }),
          ...(targetStatus === ProjectStatus.COMPLETED && { completedAt: new Date() }),
          ...(targetStatus === ProjectStatus.CLOSED && { closedAt: new Date() }),
        },
      });

      const eventType = STATUS_TO_TIMELINE_EVENT[targetStatus];
      if (eventType) {
        await tx.trustTimelineEvent.create({
          data: { projectId, eventType, actorId, metadata: metadata as object ?? undefined },
        });
      }
    });

    this.eventEmitter.emit(`project.${targetStatus.toLowerCase()}`, {
      projectId,
      actorId,
      metadata,
    });

    this.logger.log({
      message: 'Project state transition',
      projectId,
      targetStatus,
      actorId,
    });
  }

  private async validateGuards(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    project: { id: string; budgetMin: number | null; budgetMax: number | null; timelineWeeks: number | null; spaceType: string | null; description: string | null },
    targetStatus: ProjectStatus,
  ): Promise<void> {
    switch (targetStatus) {
      case ProjectStatus.BIDDING_OPEN: {
        if (!project.budgetMin || !project.budgetMax || !project.timelineWeeks) {
          throw new BadRequestException('Budget range and timeline must be set before publishing');
        }

        // Path B (bidding-only) additional guards
        if (!project.spaceType) {
          throw new BadRequestException('Space type is required');
        }
        if (!project.description || project.description.length < 50) {
          throw new BadRequestException('Description must be at least 50 characters');
        }

        const [rooms, floorPlans, aiDesigns] = await Promise.all([
          tx.room.count({ where: { projectId: project.id } }),
          tx.floorPlan.count({ where: { projectId: project.id } }),
          tx.aiDesign.count({ where: { projectId: project.id } }),
        ]);

        if (rooms === 0 && floorPlans === 0 && aiDesigns === 0) {
          throw new BadRequestException(
            'At least one reference is required: room dimensions, floor plan, or AI design',
          );
        }
        break;
      }

      case ProjectStatus.MILESTONES_LOCKED: {
        const milestones = await tx.milestone.findMany({ where: { projectId: project.id } });
        const total = milestones.reduce((sum, m) => sum + m.percentage, 0);
        if (total !== 100) {
          throw new MilestonePercentageException(total);
        }
        if (milestones.length === 0) {
          throw new BadRequestException('At least one milestone is required');
        }
        break;
      }

      case ProjectStatus.EXECUTION_ACTIVE: {
        const lockedBoq = await tx.boqHeader.findFirst({
          where: { projectId: project.id, status: 'LOCKED' },
        });
        if (!lockedBoq) {
          throw new BadRequestException('BOQ must be locked before execution can start');
        }
        break;
      }
    }
  }
}
