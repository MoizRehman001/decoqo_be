import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BoqStatus, TimelineEventType } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { BoqStateException } from '../../common/exceptions/business.exceptions';
import { calculateBoqItemAmount, inrToPaise, paiseToInr } from '../../common/utils/money.util';
import { CreateBoqDto } from './dto/create-boq.dto';
import { AddBoqItemDto } from './dto/add-boq-item.dto';
import { RaiseVariationDto } from './dto/raise-variation.dto';

@Injectable()
export class BoqService {
  private readonly logger = new Logger(BoqService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue('pdf-export') private readonly pdfQueue: Queue,
  ) {}

  async create(projectId: string, vendorUserId: string) {
    const vendor = await this.prisma.vendorProfile.findUniqueOrThrow({
      where: { userId: vendorUserId },
    });

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });

    if (!['VENDOR_SELECTED', 'MILESTONES_LOCKED', 'EXECUTION_ACTIVE'].includes(project.status)) {
      throw new BadRequestException('BOQ can only be created after vendor selection');
    }

    const existing = await this.prisma.boqHeader.findUnique({
      where: { projectId_vendorId: { projectId, vendorId: vendor.id } },
    });
    if (existing) throw new BadRequestException('BOQ already exists for this project');

    return this.prisma.boqHeader.create({
      data: { projectId, vendorId: vendor.id },
    });
  }

  async getByProject(projectId: string) {
    return this.prisma.boqHeader.findFirst({
      where: { projectId, status: { not: BoqStatus.ARCHIVED } },
      include: {
        items: { orderBy: [{ room: 'asc' }, { sortOrder: 'asc' }] },
        variations: { where: { status: 'PENDING' } },
      },
    });
  }

  async addItem(boqId: string, dto: AddBoqItemDto, vendorUserId: string) {
    const boq = await this.assertVendorOwnsBoq(boqId, vendorUserId);

    if (boq.status !== BoqStatus.DRAFT) {
      throw new BoqStateException(boq.status, BoqStatus.DRAFT);
    }

    const amountPaise = calculateBoqItemAmount(dto.quantity, inrToPaise(dto.rateInr));

    const item = await this.prisma.$transaction(async (tx) => {
      const newItem = await tx.boqItem.create({
        data: {
          boqId,
          milestoneId: dto.milestoneId,
          room: dto.room,
          category: dto.category,
          description: dto.description,
          material: dto.material,
          brand: dto.brand,
          quantity: dto.quantity,
          unit: dto.unit,
          ratePaise: inrToPaise(dto.rateInr),
          amountPaise,
          notes: dto.notes,
          sortOrder: dto.sortOrder ?? 0,
        },
      });

      // Recalculate grand total
      const allItems = await tx.boqItem.findMany({ where: { boqId } });
      const grandTotal = allItems.reduce((sum, i) => sum + i.amountPaise, 0);

      await tx.boqHeader.update({
        where: { id: boqId },
        data: { grandTotalPaise: grandTotal },
      });

      return { ...newItem, boqGrandTotalInr: paiseToInr(grandTotal) };
    });

    return item;
  }

  async updateItem(boqId: string, itemId: string, dto: Partial<AddBoqItemDto>, vendorUserId: string) {
    const boq = await this.assertVendorOwnsBoq(boqId, vendorUserId);
    if (boq.status !== BoqStatus.DRAFT) throw new BoqStateException(boq.status, BoqStatus.DRAFT);

    const updateData: Record<string, unknown> = { ...dto };
    if (dto.rateInr !== undefined) {
      updateData['ratePaise'] = inrToPaise(dto.rateInr);
      delete updateData['rateInr'];
    }

    const item = await this.prisma.boqItem.findUniqueOrThrow({ where: { id: itemId, boqId } });
    const newRate = updateData['ratePaise'] as number ?? item.ratePaise;
    const newQty = dto.quantity ?? item.quantity;
    updateData['amountPaise'] = calculateBoqItemAmount(newQty, newRate);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.boqItem.update({ where: { id: itemId }, data: updateData });
      const allItems = await tx.boqItem.findMany({ where: { boqId } });
      const grandTotal = allItems.reduce((sum, i) => sum + i.amountPaise, 0);
      await tx.boqHeader.update({ where: { id: boqId }, data: { grandTotalPaise: grandTotal } });
      return updated;
    });
  }

  async removeItem(boqId: string, itemId: string, vendorUserId: string) {
    const boq = await this.assertVendorOwnsBoq(boqId, vendorUserId);
    if (boq.status !== BoqStatus.DRAFT) throw new BoqStateException(boq.status, BoqStatus.DRAFT);

    await this.prisma.$transaction(async (tx) => {
      await tx.boqItem.delete({ where: { id: itemId, boqId } });
      const allItems = await tx.boqItem.findMany({ where: { boqId } });
      const grandTotal = allItems.reduce((sum, i) => sum + i.amountPaise, 0);
      await tx.boqHeader.update({ where: { id: boqId }, data: { grandTotalPaise: grandTotal } });
    });

    return { deleted: true };
  }

  async submit(boqId: string, vendorUserId: string) {
    const boq = await this.assertVendorOwnsBoq(boqId, vendorUserId);
    if (boq.status !== BoqStatus.DRAFT) throw new BoqStateException(boq.status, BoqStatus.DRAFT);

    const itemCount = await this.prisma.boqItem.count({ where: { boqId } });
    if (itemCount === 0) throw new BadRequestException('BOQ must have at least one item');
    if (boq.grandTotalPaise <= 0) throw new BadRequestException('BOQ grand total must be greater than 0');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.boqHeader.update({
        where: { id: boqId },
        data: { status: BoqStatus.SUBMITTED, submittedAt: new Date() },
      });

      // Create version snapshot
      const items = await tx.boqItem.findMany({ where: { boqId } });
      await tx.boqVersion.create({
        data: {
          boqId,
          versionNumber: result.currentVersion,
          snapshotJson: { items, grandTotalPaise: result.grandTotalPaise },
          createdBy: vendorUserId,
        },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: result.projectId,
          eventType: TimelineEventType.BOQ_SUBMITTED,
          actorId: vendorUserId,
          metadata: { boqId, grandTotalPaise: result.grandTotalPaise },
        },
      });

      return result;
    });

    this.eventEmitter.emit('boq.submitted', { boqId, projectId: updated.projectId });
    return updated;
  }

  async approve(boqId: string, customerUserId: string) {
    const boq = await this.assertCustomerOwnsBoq(boqId, customerUserId);
    if (boq.status !== BoqStatus.SUBMITTED) throw new BoqStateException(boq.status, BoqStatus.SUBMITTED);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.boqHeader.update({
        where: { id: boqId },
        data: { status: BoqStatus.APPROVED, approvedAt: new Date() },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: result.projectId,
          eventType: TimelineEventType.BOQ_APPROVED,
          actorId: customerUserId,
          metadata: { boqId },
        },
      });

      return result;
    });

    this.eventEmitter.emit('boq.approved', { boqId, projectId: updated.projectId });
    return updated;
  }

  async requestChanges(boqId: string, customerUserId: string, reason: string) {
    const boq = await this.assertCustomerOwnsBoq(boqId, customerUserId);
    if (boq.status !== BoqStatus.SUBMITTED) throw new BoqStateException(boq.status, BoqStatus.SUBMITTED);

    return this.prisma.boqHeader.update({
      where: { id: boqId },
      data: { status: BoqStatus.DRAFT },
    });
  }

  async lock(boqId: string, vendorUserId: string) {
    const boq = await this.assertVendorOwnsBoq(boqId, vendorUserId);
    if (boq.status !== BoqStatus.APPROVED) throw new BoqStateException(boq.status, BoqStatus.APPROVED);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.boqHeader.update({
        where: { id: boqId },
        data: { status: BoqStatus.LOCKED, lockedAt: new Date() },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: result.projectId,
          eventType: TimelineEventType.BOQ_LOCKED,
          actorId: vendorUserId,
          metadata: { boqId },
        },
      });

      return result;
    });

    this.eventEmitter.emit('boq.locked', { boqId, projectId: updated.projectId });
    return updated;
  }

  async raiseVariation(boqId: string, dto: RaiseVariationDto, vendorUserId: string) {
    const boq = await this.assertVendorOwnsBoq(boqId, vendorUserId);
    if (boq.status !== BoqStatus.LOCKED) throw new BoqStateException(boq.status, BoqStatus.LOCKED);

    const deltaAmountPaise = inrToPaise(dto.deltaAmountInr);

    const variation = await this.prisma.$transaction(async (tx) => {
      const newVariation = await tx.boqVariation.create({
        data: {
          boqId,
          type: dto.type,
          reason: dto.reason,
          deltaAmountPaise,
          affectedItems: dto.affectedItems,
          raisedBy: vendorUserId,
        },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: boq.projectId,
          eventType: TimelineEventType.VARIATION_RAISED,
          actorId: vendorUserId,
          metadata: { variationId: newVariation.id, deltaAmountPaise },
        },
      });

      return newVariation;
    });

    this.eventEmitter.emit('boq.variation.raised', { variationId: variation.id, boqId });
    return variation;
  }

  async approveVariation(boqId: string, variationId: string, customerUserId: string) {
    const boq = await this.assertCustomerOwnsBoq(boqId, customerUserId);

    const variation = await this.prisma.boqVariation.findUniqueOrThrow({
      where: { id: variationId, boqId },
    });

    if (variation.status !== 'PENDING') {
      throw new BadRequestException('Variation is not in PENDING state');
    }

    await this.prisma.$transaction(async (tx) => {
      // Archive current locked BOQ
      await tx.boqHeader.update({ where: { id: boqId }, data: { status: BoqStatus.ARCHIVED } });

      // Create new version with updated grand total
      const newGrandTotal = boq.grandTotalPaise + variation.deltaAmountPaise;
      const newBoq = await tx.boqHeader.create({
        data: {
          projectId: boq.projectId,
          vendorId: boq.vendorId,
          currentVersion: boq.currentVersion + 1,
          status: BoqStatus.LOCKED,
          grandTotalPaise: newGrandTotal,
          lockedAt: new Date(),
        },
      });

      // Copy items from old BOQ
      const items = await tx.boqItem.findMany({ where: { boqId } });
      if (items.length > 0) {
        await tx.boqItem.createMany({
          data: items.map(({ id: _, boqId: __, ...item }) => ({ ...item, boqId: newBoq.id })),
        });
      }

      // Update variation status
      await tx.boqVariation.update({
        where: { id: variationId },
        data: { status: 'APPROVED', reviewedBy: customerUserId, reviewedAt: new Date(), newVersionId: newBoq.id },
      });

      await tx.trustTimelineEvent.create({
        data: {
          projectId: boq.projectId,
          eventType: TimelineEventType.VARIATION_APPROVED,
          actorId: customerUserId,
          metadata: { variationId, newBoqId: newBoq.id, deltaAmountPaise: variation.deltaAmountPaise },
        },
      });
    });

    this.eventEmitter.emit('boq.variation.approved', { variationId, boqId });
    return { approved: true };
  }

  async rejectVariation(boqId: string, variationId: string, customerUserId: string, reason: string) {
    await this.assertCustomerOwnsBoq(boqId, customerUserId);

    await this.prisma.boqVariation.update({
      where: { id: variationId, boqId },
      data: { status: 'REJECTED', reviewedBy: customerUserId, reviewedAt: new Date(), rejectionReason: reason },
    });

    return { rejected: true };
  }

  async generatePdf(boqId: string, requestedBy: string) {
    const boq = await this.prisma.boqHeader.findUnique({ where: { id: boqId } });
    if (!boq) throw new NotFoundException('BOQ not found');

    const job = await this.pdfQueue.add('generate-boq-pdf', {
      boqId,
      projectId: boq.projectId,
      requestedBy,
    });

    return { jobId: job.id, status: 'QUEUED', message: 'PDF generation queued. Check back in a few seconds.' };
  }

  async getVersions(boqId: string) {
    return this.prisma.boqVersion.findMany({
      where: { boqId },
      orderBy: { versionNumber: 'desc' },
    });
  }

  async getVariations(boqId: string) {
    return this.prisma.boqVariation.findMany({
      where: { boqId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async assertVendorOwnsBoq(boqId: string, vendorUserId: string) {
    const vendor = await this.prisma.vendorProfile.findUniqueOrThrow({ where: { userId: vendorUserId } });
    const boq = await this.prisma.boqHeader.findUnique({ where: { id: boqId } });
    if (!boq) throw new NotFoundException('BOQ not found');
    if (boq.vendorId !== vendor.id) throw new ForbiddenException();
    return boq;
  }

  private async assertCustomerOwnsBoq(boqId: string, customerUserId: string) {
    const customer = await this.prisma.customerProfile.findUniqueOrThrow({ where: { userId: customerUserId } });
    const boq = await this.prisma.boqHeader.findUnique({ where: { id: boqId } });
    if (!boq) throw new NotFoundException('BOQ not found');
    const project = await this.prisma.project.findUnique({ where: { id: boq.projectId } });
    if (project?.customerId !== customer.id) throw new ForbiddenException();
    return boq;
  }

  // ── BOQ PDF Settings (admin-controlled) ───────────────────────────────────

  async getPdfSettings() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.prisma as any;
    const settings = await db.boqPdfSettings?.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (settings) return settings;

    return db.boqPdfSettings.create({
      data: {
        watermarkText: 'DECOQO CONFIDENTIAL',
        watermarkOpacity: 0.08,
        watermarkAngle: -45,
        showClientName: true,
        showTimestamp: true,
        isActive: true,
      },
    });
  }

  async updatePdfSettings(
    dto: {
      watermarkText?: string;
      watermarkOpacity?: number;
      watermarkAngle?: number;
      showClientName?: boolean;
      showTimestamp?: boolean;
    },
    adminId: string,
  ) {
    const existing = await this.getPdfSettings();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.prisma as any).boqPdfSettings.update({
      where: { id: existing.id },
      data: { ...dto, updatedBy: adminId },
    });
  }
}
