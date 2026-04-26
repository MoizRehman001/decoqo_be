import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RatingService {
  private readonly logger = new Logger(RatingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async submitRating(
    projectId: string,
    raterId: string,
    ratedId: string,
    score: number,
    comment?: string,
  ) {
    if (score < 1 || score > 5) {
      throw new BadRequestException('Score must be between 1 and 5');
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });

    if (project.status !== 'CLOSED' && project.status !== 'COMPLETED') {
      throw new BadRequestException('Ratings can only be submitted after project completion');
    }

    const existing = await this.prisma.rating.findUnique({
      where: { projectId_raterId: { projectId, raterId } },
    });
    if (existing) throw new BadRequestException('You have already rated this project');

    const rating = await this.prisma.rating.create({
      data: { projectId, raterId, ratedId, score, comment },
    });

    // Update vendor average rating if the rated user is a vendor
    const vendorProfile = await this.prisma.vendorProfile.findUnique({
      where: { userId: ratedId },
    });

    if (vendorProfile) {
      const allRatings = await this.prisma.rating.findMany({
        where: { ratedId },
        select: { score: true },
      });
      const avg = allRatings.reduce((sum, r) => sum + r.score, 0) / allRatings.length;

      await this.prisma.vendorProfile.update({
        where: { id: vendorProfile.id },
        data: {
          averageRating: Math.round(avg * 10) / 10,
          totalProjects: { increment: 1 },
        },
      });
    }

    this.eventEmitter.emit('rating.submitted', { projectId, raterId });
    this.logger.log({ message: 'Rating submitted', projectId, raterId, score });

    return rating;
  }

  async getProjectRatings(projectId: string) {
    return this.prisma.rating.findMany({
      where: { projectId },
      select: {
        id: true,
        score: true,
        comment: true,
        createdAt: true,
        rater: { select: { role: true } },
      },
    });
  }

  async getVendorRatings(vendorUserId: string) {
    return this.prisma.rating.findMany({
      where: { ratedId: vendorUserId },
      select: {
        id: true,
        score: true,
        comment: true,
        createdAt: true,
        project: { select: { title: true, city: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
