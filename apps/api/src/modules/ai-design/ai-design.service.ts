import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TimelineEventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiGenerationJobData } from './ai-design.processor';
import { DesignPromptParams } from './prompt-builder.service';
import { randomUUID } from 'crypto';

@Injectable()
export class AiDesignService {
  private readonly logger = new Logger(AiDesignService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue('ai-generation') private readonly aiQueue: Queue<AiGenerationJobData>,
  ) {}

  async generateDesigns(
    projectId: string,
    customerId: string,
    params: {
      themeText: string;
      filters: {
        style: string;
        colorPalette: string[];
        material: string[];
        lighting: string;
        usage: string;
      };
      referenceImageUrls?: string[];
    },
  ) {
    const project = await this.assertCustomerOwns(projectId, customerId);

    if (!['DRAFT', 'AI_GENERATED'].includes(project.status)) {
      throw new BadRequestException('AI designs can only be generated in DRAFT or AI_GENERATED state');
    }

    // Enforce max 2 generation attempts
    const existingCount = await this.prisma.aiDesign.count({ where: { projectId } });
    if (existingCount >= 2) {
      throw new BadRequestException(
        'Maximum regenerations reached. Please lock one of the existing designs.',
      );
    }

    const rooms = await this.prisma.room.findMany({ where: { projectId } });
    const roomDimensions =
      rooms.length > 0
        ? rooms.map((r) => `${r.name}: ${r.lengthCm}cm × ${r.widthCm}cm × ${r.heightCm}cm`).join('; ')
        : 'Not specified';

    const design = await this.prisma.aiDesign.create({
      data: {
        projectId,
        themeText: params.themeText,
        styleFilters: params.filters,
        referenceUrls: params.referenceImageUrls ?? [],
        generatedImages: [],
        status: 'GENERATED',
      },
    });

    const jobData: AiGenerationJobData = {
      projectId,
      designId: design.id,
      promptParams: {
        themeText: params.themeText,
        style: params.filters.style,
        colorPalette: params.filters.colorPalette,
        material: params.filters.material,
        lighting: params.filters.lighting,
        usage: params.filters.usage,
        roomDimensions,
        city: project.city,
      },
    };

    const job = await this.aiQueue.add('generate', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    this.logger.log({ message: 'AI generation queued', designId: design.id, jobId: job.id });

    return {
      jobId: job.id,
      designId: design.id,
      estimatedSeconds: 25,
      status: 'QUEUED',
    };
  }

  async listDesigns(projectId: string) {
    return this.prisma.aiDesign.findMany({
      where: { projectId },
      select: {
        id: true,
        status: true,
        generatedImages: true,
        themeText: true,
        styleFilters: true,
        createdAt: true,
        lockedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async lockDesign(projectId: string, designId: string, customerId: string) {
    const project = await this.assertCustomerOwns(projectId, customerId);

    if (project.status !== 'AI_GENERATED' && project.status !== 'DRAFT') {
      throw new BadRequestException('Project must be in DRAFT or AI_GENERATED state to lock design');
    }

    const design = await this.prisma.aiDesign.findUnique({ where: { id: designId } });
    if (!design || design.projectId !== projectId) {
      throw new BadRequestException('Design not found for this project');
    }
    if (design.status === 'LOCKED') {
      throw new ConflictException('Design is already locked');
    }
    if (design.generatedImages.length === 0) {
      throw new BadRequestException('Design has no generated images yet');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.aiDesign.update({
        where: { id: designId },
        data: { status: 'LOCKED', lockedAt: new Date() },
      });

      await tx.project.update({
        where: { id: projectId },
        data: { status: 'AI_GENERATED', lockedDesignId: designId },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId,
          eventType: TimelineEventType.DESIGN_LOCKED,
          actorId: customerId,
          metadata: { designId, lockedAt: new Date().toISOString() },
        },
      });
    });

    this.eventEmitter.emit('project.design_locked', { projectId, designId, actorId: customerId });
    this.logger.log({ message: 'Design locked', designId, projectId });

    return {
      designId,
      lockedAt: new Date(),
      projectStatus: 'AI_GENERATED',
    };
  }

  private async assertCustomerOwns(projectId: string, customerId: string) {
    const customer = await this.prisma.customerProfile.findUniqueOrThrow({
      where: { userId: customerId },
    });
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    if (project.customerId !== customer.id) throw new ForbiddenException();
    return project;
  }
}
