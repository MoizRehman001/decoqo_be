import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProjectStatus, TimelineEventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectStateService } from '../project/project-state.service';
import { SubmitBidDto } from './dto/submit-bid.dto';
import { DuplicateBidException } from '../../common/exceptions/business.exceptions';
import { inrToPaise, paiseToInr } from '../../common/utils/money.util';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

const TRUST_SIGNALS = [
  'Secure escrow — pay only after work approval',
  'Locked BOQ & design protects your scope',
  'Dispute resolution with full evidence trail',
  'Anonymous & safe negotiation — no spam calls',
  'Trust Timeline — every step is recorded',
];

@Injectable()
export class BiddingService {
  private readonly logger = new Logger(BiddingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectStateService: ProjectStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Vendor: Browse available projects ─────────────────────────────────────

  async getAvailableProjects(
    vendorUserId: string,
    filters: { city?: string; budgetMin?: number; budgetMax?: number; category?: string },
    pagination: PaginationDto,
  ) {
    const vendor = await this.prisma.vendorProfile.findUniqueOrThrow({
      where: { userId: vendorUserId },
    });

    if (!vendor.isApproved) {
      throw new ForbiddenException('Vendor KYC must be approved to browse projects');
    }

    const where = {
      status: ProjectStatus.BIDDING_OPEN,
      deletedAt: null,
      ...(filters.city && { city: { contains: filters.city, mode: 'insensitive' as const } }),
      ...(filters.budgetMin && { budgetMax: { gte: filters.budgetMin } }),
      ...(filters.budgetMax && { budgetMin: { lte: filters.budgetMax } }),
    };

    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        select: {
          id: true,
          title: true,
          city: true,
          spaceType: true,
          projectType: true,
          budgetMin: true,
          budgetMax: true,
          timelineWeeks: true,
          publishedAt: true,
          biddingExpiresAt: true,
          rooms: { select: { name: true, lengthCm: true, widthCm: true } },
          lockedDesign: { select: { generatedImages: true } },
          floorPlans: { select: { fileUrl: true } },
          _count: { select: { bids: true } },
          // NEVER include customer identity
        },
        orderBy: { publishedAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.project.count({ where }),
    ]);

    return paginate(items, total, pagination);
  }

  // ── Vendor: Submit bid ─────────────────────────────────────────────────────

  async submitBid(dto: SubmitBidDto, vendorUserId: string) {
    const vendor = await this.prisma.vendorProfile.findUniqueOrThrow({
      where: { userId: vendorUserId },
    });

    if (!vendor.isApproved) {
      throw new ForbiddenException('Vendor KYC must be approved to submit bids');
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: dto.projectId },
    });

    if (project.status !== ProjectStatus.BIDDING_OPEN) {
      throw new BadRequestException('Project is not open for bidding');
    }

    if (project.biddingExpiresAt && project.biddingExpiresAt < new Date()) {
      throw new BadRequestException('Bidding period has expired');
    }

    if (!dto.boqItems || dto.boqItems.length === 0) {
      throw new BadRequestException('At least one BOQ line item is required');
    }

    // Check for duplicate bid
    const existingBid = await this.prisma.bid.findUnique({
      where: { projectId_vendorId: { projectId: dto.projectId, vendorId: vendor.id } },
    });
    if (existingBid) throw new DuplicateBidException();

    // Compute grand total from BOQ items
    const totalQuotePaise = inrToPaise(
      dto.boqItems.reduce((sum, item) => sum + item.quantity * item.rateInr, 0),
    );

    const bid = await this.prisma.$transaction(async (tx) => {
      const newBid = await tx.bid.create({
        data: {
          projectId: dto.projectId,
          vendorId: vendor.id,
          totalQuotePaise,
          timelineWeeks: dto.timelineWeeks,
          scopeAssumptions: dto.scopeExclusions ?? '',
          materialQualityLevel: dto.materialQualityLevel,
          notes: dto.notes,
        },
      });

      // Store BOQ items in the BoqHeader/BoqItem tables linked to this bid
      const boqHeader = await tx.boqHeader.create({
        data: {
          projectId: dto.projectId,
          vendorId: vendor.id,
          grandTotalPaise: totalQuotePaise,
          status: 'DRAFT',
          items: {
            create: dto.boqItems.map((item, idx) => ({
              room: item.room,
              category: item.category,
              description: item.description,
              material: item.material,
              brand: item.brand,
              quantity: item.quantity,
              unit: item.unit,
              ratePaise: inrToPaise(item.rateInr),
              amountPaise: inrToPaise(item.quantity * item.rateInr),
              notes: item.notes,
              sortOrder: idx,
            })),
          },
        },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: dto.projectId,
          eventType: TimelineEventType.BID_SUBMITTED,
          metadata: { bidId: newBid.id, boqId: boqHeader.id },
          // actorId intentionally omitted — anonymity
        },
      });

      return newBid;
    });

    this.eventEmitter.emit('bid.submitted', { bidId: bid.id, projectId: dto.projectId });
    this.logger.log({ message: 'Bid submitted', bidId: bid.id, projectId: dto.projectId });

    return { bidId: bid.id, status: bid.status, submittedAt: bid.submittedAt };
  }

  // ── Vendor: List own bids ──────────────────────────────────────────────────

  async getMyBids(vendorUserId: string, pagination: PaginationDto) {
    const vendor = await this.prisma.vendorProfile.findUniqueOrThrow({
      where: { userId: vendorUserId },
    });

    const [items, total] = await Promise.all([
      this.prisma.bid.findMany({
        where: { vendorId: vendor.id },
        include: {
          project: {
            select: { id: true, title: true, city: true, status: true },
          },
        },
        orderBy: { submittedAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.bid.count({ where: { vendorId: vendor.id } }),
    ]);

    return paginate(items, total, pagination);
  }

  // ── Vendor: Withdraw bid ───────────────────────────────────────────────────

  async withdrawBid(bidId: string, vendorUserId: string) {
    const vendor = await this.prisma.vendorProfile.findUniqueOrThrow({
      where: { userId: vendorUserId },
    });

    const bid = await this.prisma.bid.findUniqueOrThrow({ where: { id: bidId } });

    if (bid.vendorId !== vendor.id) throw new ForbiddenException();
    if (bid.status !== 'SUBMITTED') {
      throw new BadRequestException('Only SUBMITTED bids can be withdrawn');
    }

    await this.prisma.bid.update({
      where: { id: bidId },
      data: { status: 'WITHDRAWN' },
    });

    return { withdrawn: true };
  }

  // ── Customer: Bidding Room ─────────────────────────────────────────────────

  async getBiddingRoom(projectId: string, customerUserId: string) {
    const project = await this.assertCustomerOwnsProject(projectId, customerUserId);

    const bids = await this.prisma.bid.findMany({
      where: { projectId, status: { in: ['SUBMITTED', 'SHORTLISTED'] } },
      select: {
        id: true,
        totalQuotePaise: true,
        timelineWeeks: true,
        scopeAssumptions: true,
        materialQualityLevel: true,
        notes: true,
        status: true,
        submittedAt: true,
        // vendorId NEVER included
      },
      orderBy: { submittedAt: 'asc' },
    });

    // Fetch BOQ items for each bid (via BoqHeader linked to same project+vendor)
    const boqHeaders = await this.prisma.boqHeader.findMany({
      where: { projectId },
      include: {
        items: {
          orderBy: [{ room: 'asc' }, { sortOrder: 'asc' }],
        },
      },
    });

    // Map boqHeader by vendorId — we'll match by bid order (no vendorId exposed)
    // We use bid submission order index to assign anonymous labels
    return {
      projectId: project.id,
      projectTitle: project.title,
      status: project.status,
      publishedAt: project.publishedAt,
      expiresAt: project.biddingExpiresAt,
      totalBids: bids.length,
      bids: bids.map((bid, index) => {
        // Find the BOQ for this bid's vendor — matched by position (anonymity preserved)
        const boq = boqHeaders[index];
        return {
          bidId: bid.id,
          anonymousLabel: `Vendor ${String.fromCharCode(65 + index)}`,
          totalQuoteInr: paiseToInr(bid.totalQuotePaise),
          timelineWeeks: bid.timelineWeeks,
          materialQualityLevel: bid.materialQualityLevel,
          scopeExclusions: bid.scopeAssumptions,
          notes: bid.notes,
          status: bid.status,
          submittedAt: bid.submittedAt,
          boqItems: boq
            ? boq.items.map((item) => ({
                room: item.room,
                category: item.category,
                description: item.description,
                material: item.material,
                brand: item.brand,
                quantity: item.quantity,
                unit: item.unit,
                rateInr: paiseToInr(item.ratePaise),
                amountInr: paiseToInr(item.amountPaise),
                notes: item.notes,
              }))
            : [],
        };
      }),
    };
  }

  // ── Customer: Vendor Profile Preview (safe fields only) ───────────────────

  async getVendorProfilePreview(projectId: string, bidId: string, customerUserId: string) {
    await this.assertCustomerOwnsProject(projectId, customerUserId);

    const bid = await this.prisma.bid.findUniqueOrThrow({
      where: { id: bidId, projectId },
      include: {
        vendor: {
          select: {
            id: true,
            businessName: true,
            city: true,
            serviceAreas: true,
            categories: true,
            portfolioUrls: true,
            averageRating: true,
            totalProjects: true,
            bio: true,
            isApproved: true,
            kycStatus: true,
            createdAt: true,
            // NEVER include: phone, email, websiteUrl, userId, bankAccount, displayName
          },
        },
      },
    });

    // Get anonymous label
    const allBids = await this.prisma.bid.findMany({
      where: { projectId, status: { in: ['SUBMITTED', 'SHORTLISTED'] } },
      select: { id: true },
      orderBy: { submittedAt: 'asc' },
    });
    const index = allBids.findIndex((b) => b.id === bidId);
    const anonymousLabel = `Vendor ${String.fromCharCode(65 + Math.max(0, index))}`;

    // Fetch ratings/reviews for this vendor's user account
    const vendorUser = await this.prisma.vendorProfile.findUnique({
      where: { id: bid.vendor.id },
      select: { userId: true },
    });

    const ratings = vendorUser
      ? await this.prisma.rating.findMany({
          where: { ratedId: vendorUser.userId },
          select: { score: true, comment: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        })
      : [];

    const yearsExperience = Math.max(
      1,
      new Date().getFullYear() - new Date(bid.vendor.createdAt).getFullYear(),
    );

    return {
      anonymousLabel,
      // Company info — safe to show
      city: bid.vendor.city,
      serviceAreas: bid.vendor.serviceAreas,
      categories: bid.vendor.categories,
      portfolioUrls: bid.vendor.portfolioUrls,
      bio: bid.vendor.bio,
      // Trust signals
      isVerified: bid.vendor.kycStatus === 'APPROVED' && bid.vendor.isApproved,
      averageRating: bid.vendor.averageRating,
      totalProjects: bid.vendor.totalProjects,
      yearsExperience,
      recentReviews: ratings.map((r) => ({
        score: r.score,
        comment: r.comment,
        date: r.createdAt,
      })),
      platformTrustSignals: TRUST_SIGNALS,
      // Bid details
      bidDetails: {
        totalQuoteInr: paiseToInr(bid.totalQuotePaise),
        timelineWeeks: bid.timelineWeeks,
        materialQualityLevel: bid.materialQualityLevel,
        scopeExclusions: bid.scopeAssumptions,
        notes: bid.notes,
      },
    };
  }

  // ── Customer: Shortlist bid ────────────────────────────────────────────────

  async shortlistBid(projectId: string, bidId: string, customerUserId: string) {
    await this.assertCustomerOwnsProject(projectId, customerUserId);

    await this.prisma.bid.update({
      where: { id: bidId, projectId },
      data: { status: 'SHORTLISTED' },
    });

    this.eventEmitter.emit('bid.shortlisted', { bidId, projectId });

    return { shortlisted: true };
  }

  // ── Customer: Select vendor (reveals identity) ─────────────────────────────

  async selectVendor(projectId: string, bidId: string, customerUserId: string) {
    const project = await this.assertCustomerOwnsProject(projectId, customerUserId);

    if (project.status !== ProjectStatus.BIDDING_OPEN) {
      throw new BadRequestException('Project is not in BIDDING_OPEN state');
    }

    const bid = await this.prisma.bid.findUniqueOrThrow({
      where: { id: bidId, projectId },
      include: {
        vendor: {
          include: { user: { select: { email: true, phone: true } } },
        },
      },
    });

    if (!['SUBMITTED', 'SHORTLISTED'].includes(bid.status)) {
      throw new BadRequestException('Bid is not in a selectable state');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Update bid status
      await tx.bid.update({ where: { id: bidId }, data: { status: 'SELECTED', selectedAt: new Date() } });

      // Reject all other bids
      await tx.bid.updateMany({
        where: { projectId, id: { not: bidId }, status: { in: ['SUBMITTED', 'SHORTLISTED'] } },
        data: { status: 'REJECTED', rejectedAt: new Date() },
      });

      // Update project
      await tx.project.update({
        where: { id: projectId },
        data: { selectedBidId: bidId },
      });

      // Create negotiation thread
      const negotiationThread = await tx.negotiationThread.create({
        data: { projectId },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId,
          eventType: TimelineEventType.VENDOR_SELECTED,
          actorId: customerUserId,
          metadata: { bidId, vendorId: bid.vendorId },
        },
      });

      return negotiationThread;
    });

    // Transition project state
    await this.projectStateService.transition(
      projectId,
      ProjectStatus.VENDOR_SELECTED,
      customerUserId,
      { bidId },
    );

    this.eventEmitter.emit('vendor.selected', { projectId, bidId, vendorId: bid.vendorId });
    this.logger.log({ message: 'Vendor selected', projectId, bidId });

    // Reveal vendor identity to customer
    return {
      bidId,
      projectStatus: ProjectStatus.VENDOR_SELECTED,
      vendor: {
        id: bid.vendor.id,
        businessName: bid.vendor.businessName,
        displayName: bid.vendor.displayName,
        city: bid.vendor.city,
        phone: bid.vendor.user.phone,
        email: bid.vendor.user.email,
      },
      negotiationThreadId: result.id,
      selectedAt: new Date(),
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async assertCustomerOwnsProject(projectId: string, customerUserId: string) {
    const customer = await this.prisma.customerProfile.findUniqueOrThrow({
      where: { userId: customerUserId },
    });

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.customerId !== customer.id) throw new ForbiddenException();

    return project;
  }
}
