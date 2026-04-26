import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProjectStatus, TimelineEventType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProjectStateService } from './project-state.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AddRoomDto } from './dto/add-room.dto';
import { SetBudgetDto } from './dto/set-budget.dto';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stateService: ProjectStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(dto: CreateProjectDto, customerId: string) {
    const customer = await this.prisma.customerProfile.findUniqueOrThrow({
      where: { userId: customerId },
    });

    const project = await this.prisma.$transaction(async (tx) => {
      const newProject = await tx.project.create({
        data: {
          customerId: customer.id,
          title: dto.title,
          city: dto.city,
          pincode: dto.pincode,
          projectType: dto.projectType ?? 'RESIDENTIAL',
          spaceType: dto.spaceType,
          description: dto.description,
          notes: dto.notes,
        },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: newProject.id,
          eventType: TimelineEventType.PROJECT_CREATED,
          actorId: customerId,
        },
      });

      return newProject;
    });

    this.logger.log({ message: 'Project created', projectId: project.id, customerId });
    return project;
  }

  async findAll(customerId: string, pagination: PaginationDto) {
    const customer = await this.prisma.customerProfile.findUniqueOrThrow({
      where: { userId: customerId },
    });

    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where: { customerId: customer.id, deletedAt: null },
        include: {
          rooms: true,
          _count: { select: { bids: true, milestones: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.project.count({ where: { customerId: customer.id, deletedAt: null } }),
    ]);

    return paginate(items, total, pagination);
  }

  async findAvailable(vendorUserId: string, pagination: PaginationDto) {
    // Only show projects in cities the vendor serves
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId: vendorUserId },
      select: { serviceAreas: true, city: true, isApproved: true },
    });

    if (!vendor?.isApproved) {
      // Unapproved vendors see nothing
      return paginate([], 0, pagination);
    }

    // Match project city against vendor's serviceAreas (case-insensitive)
    // serviceAreas is an array of city strings set by the vendor
    const vendorCities = [
      ...(vendor.serviceAreas ?? []),
      vendor.city,
    ].filter(Boolean).map((c) => c.toLowerCase());

    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where: { status: ProjectStatus.BIDDING_OPEN, deletedAt: null },
        include: {
          rooms: true,
          _count: { select: { bids: true } },
        },
        orderBy: { publishedAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.project.count({
        where: { status: ProjectStatus.BIDDING_OPEN, deletedAt: null },
      }),
    ]);

    // Filter in-memory by city match (Prisma doesn't support array-contains-insensitive natively)
    const filtered = items.filter((p) =>
      vendorCities.some((vc) => p.city.toLowerCase().includes(vc) || vc.includes(p.city.toLowerCase())),
    );

    const mapped = filtered.map(({ _count, ...rest }) => ({
      ...rest,
      bidsCount: _count.bids,
    }));

    return paginate(mapped, filtered.length, pagination);
  }

  async findById(projectId: string, userId: string, userRole: UserRole) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
      include: {
        rooms: true,
        floorPlans: true,
        aiDesigns: { select: { id: true, status: true, generatedImages: true, createdAt: true } },
        lockedDesign: true,
        milestones: { orderBy: { sequence: 'asc' } },
        _count: { select: { bids: true } },
      },
    });

    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    await this.assertAccess(project, userId, userRole);

    // Vendors browsing BIDDING_OPEN projects see only work-relevant fields — no customer PII.
    // Full details are revealed only after the vendor is selected AND initial payment is made.
    if (userRole === UserRole.VENDOR) {
      const isSelectedVendor = await this.isSelectedVendorWithPayment(project, userId);
      if (!isSelectedVendor) {
        // Return anonymised project — work scope only, no customer identity
        return {
          id: project.id,
          title: project.title,
          city: project.city,
          pincode: project.pincode,
          spaceType: project.spaceType,
          projectType: project.projectType,
          status: project.status,
          description: project.description,
          budgetMin: project.budgetMin,
          budgetMax: project.budgetMax,
          budgetFlexibility: project.budgetFlexibility,
          timelineWeeks: project.timelineWeeks,
          priorityMode: project.priorityMode,
          publishedAt: project.publishedAt,
          biddingExpiresAt: project.biddingExpiresAt,
          rooms: project.rooms,
          floorPlans: project.floorPlans,
          aiDesigns: project.aiDesigns,
          lockedDesign: project.lockedDesign,
          bidsCount: project._count.bids,
          // NEVER include: customerId, customer profile, notes (may contain PII), selectedBidId
        };
      }
    }

    return { ...project, bidsCount: project._count.bids };
  }

  /**
   * Returns true only when:
   * 1. The vendor's bid was selected on this project, AND
   * 2. At least one milestone escrow has been funded (initial payment made)
   */
  private async isSelectedVendorWithPayment(
    project: { id: string; selectedBidId: string | null },
    userId: string,
  ): Promise<boolean> {
    if (!project.selectedBidId) return false;

    const vendor = await this.prisma.vendorProfile.findUnique({ where: { userId } });
    if (!vendor) return false;

    const bid = await this.prisma.bid.findUnique({ where: { id: project.selectedBidId } });
    if (bid?.vendorId !== vendor.id) return false;

    // Check initial payment — at least one funded escrow on this project
    const fundedEscrow = await this.prisma.escrowAccount.findFirst({
      where: {
        milestone: { projectId: project.id },
        status: { in: ['FUNDED', 'HELD', 'RELEASED'] },
      },
    });

    return fundedEscrow !== null;
  }
  async update(projectId: string, dto: UpdateProjectDto, userId: string) {
    const project = await this.assertOwnerAndDraft(projectId, userId);

    return this.prisma.project.update({
      where: { id: project.id },
      data: {
        title: dto.title,
        city: dto.city,
        pincode: dto.pincode,
        spaceType: dto.spaceType,
        description: dto.description,
        notes: dto.notes,
      },
    });
  }

  async cancel(projectId: string, userId: string) {
    const project = await this.assertOwnerAndDraft(projectId, userId);

    const hasBids = await this.prisma.bid.count({ where: { projectId: project.id } });
    if (hasBids > 0) {
      throw new BadRequestException('Cannot cancel a project that has received bids');
    }

    await this.stateService.transition(project.id, ProjectStatus.CANCELLED, userId);
    return { cancelled: true };
  }

  async addRoom(projectId: string, dto: AddRoomDto, userId: string) {
    await this.assertOwnerAndDraft(projectId, userId);
    const { unit, ...rest } = dto;
    const toCm = (val: number): number => {
      if (unit === 'ft') return Math.round(val * 30.48);
      if (unit === 'm') return Math.round(val * 100);
      return val; // already cm
    };
    return this.prisma.room.create({
      data: {
        projectId,
        name: rest.name,
        notes: rest.notes,
        lengthCm: toCm(rest.lengthCm),
        widthCm: toCm(rest.widthCm),
        heightCm: toCm(rest.heightCm),
      },
    });
  }

  async updateRoom(projectId: string, roomId: string, dto: AddRoomDto, userId: string) {
    await this.assertOwnerAndDraft(projectId, userId);
    const { unit, ...rest } = dto;
    const toCm = (val: number): number => {
      if (unit === 'ft') return Math.round(val * 30.48);
      if (unit === 'm') return Math.round(val * 100);
      return val;
    };
    return this.prisma.room.update({
      where: { id: roomId, projectId },
      data: {
        name: rest.name,
        notes: rest.notes,
        lengthCm: toCm(rest.lengthCm),
        widthCm: toCm(rest.widthCm),
        heightCm: toCm(rest.heightCm),
      },
    });
  }

  async removeRoom(projectId: string, roomId: string, userId: string) {
    await this.assertOwnerAndDraft(projectId, userId);
    await this.prisma.room.delete({ where: { id: roomId, projectId } });
    return { deleted: true };
  }

  async setBudget(projectId: string, dto: SetBudgetDto, userId: string) {
    const project = await this.assertOwner(projectId, userId);

    if (project.status !== ProjectStatus.DRAFT && project.status !== ProjectStatus.DESIGN_LOCKED) {
      throw new BadRequestException('Budget can only be set in DRAFT or DESIGN_LOCKED state');
    }

    if (dto.budgetMax <= dto.budgetMin) {
      throw new BadRequestException('Maximum budget must be greater than minimum budget');
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        budgetMin: dto.budgetMin,
        budgetMax: dto.budgetMax,
        budgetFlexibility: dto.budgetFlexibility,
        timelineWeeks: dto.timelineWeeks,
        priorityMode: dto.priorityMode,
      },
    });
  }

  async publish(projectId: string, userId: string) {
    const project = await this.assertOwner(projectId, userId);

    if (
      project.status !== ProjectStatus.DRAFT &&
      project.status !== ProjectStatus.DESIGN_LOCKED
    ) {
      throw new BadRequestException('Project must be in DRAFT or DESIGN_LOCKED state to publish');
    }

    await this.stateService.transition(project.id, ProjectStatus.BIDDING_OPEN, userId);
    return { published: true, status: ProjectStatus.BIDDING_OPEN };
  }

  async getTimeline(projectId: string, userId: string, userRole: UserRole) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    await this.assertAccess(project, userId, userRole);

    return this.prisma.trustTimelineEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async assertOwner(projectId: string, userId: string) {
    const customer = await this.prisma.customerProfile.findUnique({ where: { userId } });
    if (!customer) throw new ForbiddenException();

    const project = await this.prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
    if (project.customerId !== customer.id) throw new ForbiddenException();

    return project;
  }

  private async assertOwnerAndDraft(projectId: string, userId: string) {
    const project = await this.assertOwner(projectId, userId);
    if (project.status !== ProjectStatus.DRAFT) {
      throw new BadRequestException('This action is only allowed on DRAFT projects');
    }
    return project;
  }

  private async assertAccess(
    project: { customerId: string; selectedBidId: string | null; status: string },
    userId: string,
    userRole: UserRole,
  ): Promise<void> {
    if (userRole === UserRole.ADMIN || userRole === UserRole.SUPER_ADMIN) return;

    if (userRole === UserRole.CUSTOMER) {
      const customer = await this.prisma.customerProfile.findUnique({ where: { userId } });
      if (customer?.id !== project.customerId) throw new ForbiddenException();
      return;
    }

    if (userRole === UserRole.VENDOR) {
      // Any vendor can view a project that is open for bidding
      if (project.status === ProjectStatus.BIDDING_OPEN) return;

      // After selection, only the winning vendor can view
      if (project.selectedBidId) {
        const bid = await this.prisma.bid.findUnique({ where: { id: project.selectedBidId } });
        const vendor = await this.prisma.vendorProfile.findUnique({ where: { userId } });
        if (bid?.vendorId === vendor?.id) return;
      }

      throw new ForbiddenException();
    }

    throw new ForbiddenException();
  }
}
