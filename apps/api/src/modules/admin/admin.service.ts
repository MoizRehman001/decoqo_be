import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EscrowStateService } from '../payment/escrow-state.service';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escrowState: EscrowStateService,
  ) {}

  // ── Escrow ─────────────────────────────────────────────────────────────────

  async listEscrows(pagination: PaginationDto) {
    const [items, total] = await Promise.all([
      this.prisma.escrowAccount.findMany({
        include: {
          milestone: { select: { name: true, projectId: true, project: { select: { title: true } } } },
          transactions: { orderBy: { createdAt: 'desc' }, take: 3 },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.escrowAccount.count(),
    ]);
    return paginate(items, total, pagination);
  }

  async freezeEscrow(escrowId: string, adminId: string, reason: string) {
    await this.escrowState.hold(escrowId, `admin:${adminId}`);

    await this.prisma.adminAction.create({
      data: {
        adminId,
        actionType: 'FREEZE_ESCROW',
        targetType: 'ESCROW',
        targetId: escrowId,
        reason,
      },
    });

    this.logger.log({ message: 'Escrow frozen by admin', escrowId, adminId });
    return { frozen: true };
  }

  async unfreezeEscrow(escrowId: string, adminId: string, reason: string) {
    const escrow = await this.prisma.escrowAccount.findUnique({ where: { id: escrowId } });
    if (!escrow) throw new NotFoundException('Escrow account not found');

    await this.prisma.escrowAccount.update({
      where: { id: escrowId },
      data: { status: 'FUNDED', heldAt: null },
    });

    await this.prisma.escrowTransaction.create({
      data: {
        escrowAccountId: escrowId,
        type: 'UNHOLD',
        amountPaise: 0,
        idempotencyKey: `unhold:${escrowId}:admin:${adminId}:${Date.now()}`,
        status: 'SUCCESS',
        processedAt: new Date(),
      },
    });

    await this.prisma.adminAction.create({
      data: {
        adminId,
        actionType: 'UNFREEZE_ESCROW',
        targetType: 'ESCROW',
        targetId: escrowId,
        reason,
      },
    });

    this.logger.log({ message: 'Escrow unfrozen by admin', escrowId, adminId });
    return { unfrozen: true };
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  async listUsers(pagination: PaginationDto, search?: string) {
    const where = search
      ? {
          deletedAt: null,
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search } },
            { customerProfile: { displayName: { contains: search, mode: 'insensitive' as const } } },
            { vendorProfile: { displayName: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : { deletedAt: null };

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true, email: true, phone: true, role: true, status: true, createdAt: true,
          customerProfile: { select: { displayName: true, city: true } },
          vendorProfile: { select: { businessName: true, displayName: true, kycStatus: true, isApproved: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(items, total, pagination);
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, phone: true, role: true, status: true,
        emailVerified: true, phoneVerified: true, createdAt: true, updatedAt: true,
        customerProfile: { select: { displayName: true, city: true, avatarUrl: true } },
        vendorProfile: {
          select: {
            businessName: true, displayName: true, city: true,
            kycStatus: true, isApproved: true, averageRating: true, totalProjects: true,
          },
        },
        sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, deviceInfo: true, ipAddress: true, createdAt: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async banUser(userId: string, adminId: string, reason: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'BANNED' } });
    // Revoke all active sessions
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.adminAction.create({
      data: { adminId, actionType: 'BAN_USER', targetType: 'USER', targetId: userId, reason },
    });
    this.logger.log({ message: 'User banned', userId, adminId });
    return { banned: true };
  }

  async suspendUser(userId: string, adminId: string, reason: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
    await this.prisma.adminAction.create({
      data: { adminId, actionType: 'SUSPEND_USER', targetType: 'USER', targetId: userId, reason },
    });
    this.logger.log({ message: 'User suspended', userId, adminId });
    return { suspended: true };
  }

  async reinstateUser(userId: string, adminId: string, reason: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
    await this.prisma.adminAction.create({
      data: { adminId, actionType: 'REINSTATE_USER', targetType: 'USER', targetId: userId, reason },
    });
    this.logger.log({ message: 'User reinstated', userId, adminId });
    return { reinstated: true };
  }

  // ── Vendors ────────────────────────────────────────────────────────────────

  async listVendors(pagination: PaginationDto, kycStatus?: string) {
    const where = kycStatus ? { kycStatus: kycStatus as never } : {};
    const [items, total] = await Promise.all([
      this.prisma.vendorProfile.findMany({
        where,
        include: {
          user: { select: { email: true, phone: true, status: true, createdAt: true } },
          kyc: { select: { kycStatus: true, panVerified: true, bankVerified: true, rejectionReason: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.vendorProfile.count({ where }),
    ]);
    return paginate(items, total, pagination);
  }

  async getVendor(vendorId: string) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorId },
      include: {
        user: { select: { email: true, phone: true, status: true, createdAt: true } },
        kyc: true,
      },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async approveVendorKyc(vendorId: string, adminId: string) {
    await this.prisma.vendorProfile.update({
      where: { id: vendorId },
      data: { kycStatus: 'APPROVED', isApproved: true },
    });
    await this.prisma.vendorKyc.update({
      where: { vendorId },
      data: { kycStatus: 'APPROVED', reviewedBy: adminId, reviewedAt: new Date() },
    });
    await this.prisma.adminAction.create({
      data: { adminId, actionType: 'APPROVE_KYC', targetType: 'VENDOR', targetId: vendorId, reason: 'KYC documents verified' },
    });
    this.logger.log({ message: 'Vendor KYC approved', vendorId, adminId });
    return { approved: true };
  }

  async rejectVendorKyc(vendorId: string, adminId: string, reason: string) {
    await this.prisma.vendorProfile.update({ where: { id: vendorId }, data: { kycStatus: 'REJECTED' } });
    await this.prisma.vendorKyc.update({
      where: { vendorId },
      data: { kycStatus: 'REJECTED', rejectionReason: reason, reviewedBy: adminId, reviewedAt: new Date() },
    });
    await this.prisma.adminAction.create({
      data: { adminId, actionType: 'REJECT_KYC', targetType: 'VENDOR', targetId: vendorId, reason },
    });
    this.logger.log({ message: 'Vendor KYC rejected', vendorId, adminId, reason });
    return { rejected: true };
  }

  async suspendVendor(vendorId: string, adminId: string, reason: string) {
    const vendor = await this.prisma.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });
    await this.prisma.user.update({ where: { id: vendor.userId }, data: { status: 'SUSPENDED' } });
    await this.prisma.adminAction.create({
      data: { adminId, actionType: 'SUSPEND_VENDOR', targetType: 'VENDOR', targetId: vendorId, reason },
    });
    return { suspended: true };
  }

  // ── Disputes ───────────────────────────────────────────────────────────────

  async listDisputes(pagination: PaginationDto, status?: string) {
    const where = status ? { status: status as never } : {};
    const [items, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        include: {
          milestone: { select: { name: true, amountPaise: true, sequence: true } },
          project: { select: { title: true, city: true } },
          evidence: { select: { id: true, fileName: true, uploadedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.dispute.count({ where }),
    ]);
    return paginate(items, total, pagination);
  }

  async getDisputeDetail(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        evidence: true,
        milestone: {
          include: {
            escrowAccount: true,
            evidenceFiles: true,
            boqItems: true,
          },
        },
        project: {
          include: {
            lockedDesign: { select: { generatedImages: true, themeText: true } },
            boqHeaders: {
              where: { status: { in: ['LOCKED', 'APPROVED'] } },
              include: { items: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    return dispute;
  }

  // ── Audit ──────────────────────────────────────────────────────────────────

  async getAuditLogs(pagination: PaginationDto, search?: string) {
    const where = search
      ? {
          OR: [
            { actionType: { contains: search, mode: 'insensitive' as const } },
            { targetType: { contains: search, mode: 'insensitive' as const } },
            { reason: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.adminAction.findMany({
        where,
        include: { admin: { select: { email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.limit,
      }),
      this.prisma.adminAction.count({ where }),
    ]);
    return paginate(items, total, pagination);
  }

  // ── Project Timeline ───────────────────────────────────────────────────────

  async getProjectTimeline(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    return this.prisma.trustTimelineEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
