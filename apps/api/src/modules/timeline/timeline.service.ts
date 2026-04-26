import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma, TimelineEventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * TimelineService — append-only trust timeline.
 * Listens to all domain events and writes immutable records.
 * No updates or deletes are ever performed on trust_timeline_events.
 */
@Injectable()
export class TimelineService {
  private readonly logger = new Logger(TimelineService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Public query ───────────────────────────────────────────────────────────

  async getProjectTimeline(projectId: string) {
    return this.prisma.trustTimelineEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Project events ─────────────────────────────────────────────────────────

  @OnEvent('project.design_locked')
  async onDesignLocked(payload: { projectId: string; actorId: string; designId: string }) {
    await this.write(payload.projectId, TimelineEventType.DESIGN_LOCKED, payload.actorId, {
      designId: payload.designId,
    });
  }

  @OnEvent('project.published')
  async onProjectPublished(payload: { projectId: string; actorId: string }) {
    await this.write(payload.projectId, TimelineEventType.PROJECT_PUBLISHED, payload.actorId);
  }

  @OnEvent('project.completed')
  async onProjectCompleted(payload: { projectId: string; actorId: string }) {
    await this.write(payload.projectId, TimelineEventType.PROJECT_COMPLETED, payload.actorId);
  }

  // ── Bidding events ─────────────────────────────────────────────────────────

  @OnEvent('bid.submitted')
  async onBidSubmitted(payload: { bidId: string; projectId: string }) {
    // actorId intentionally omitted — anonymity preserved
    await this.write(payload.projectId, TimelineEventType.BID_SUBMITTED, undefined, {
      bidId: payload.bidId,
    });
  }

  @OnEvent('vendor.selected')
  async onVendorSelected(payload: { projectId: string; bidId: string; vendorId: string }) {
    // Timeline event written in BiddingService transaction — this is a no-op listener
    // to avoid duplicate writes. The service writes it directly for atomicity.
    this.logger.debug({ message: 'Timeline: vendor.selected (written in service)', ...payload });
  }

  // ── Negotiation events ─────────────────────────────────────────────────────

  @OnEvent('negotiation.confirmed')
  async onNegotiationConfirmed(payload: { projectId: string }) {
    const project = await this.prisma.project.findUnique({ where: { id: payload.projectId } });
    if (!project) return;
    await this.write(payload.projectId, TimelineEventType.MILESTONES_LOCKED);
  }

  // ── BOQ events ─────────────────────────────────────────────────────────────

  @OnEvent('boq.submitted')
  async onBoqSubmitted(payload: { boqId: string; projectId: string }) {
    // Written in BoqService transaction — no-op here
    this.logger.debug({ message: 'Timeline: boq.submitted (written in service)', ...payload });
  }

  @OnEvent('boq.approved')
  async onBoqApproved(payload: { boqId: string; projectId: string }) {
    // Written in BoqService transaction — no-op here
    this.logger.debug({ message: 'Timeline: boq.approved (written in service)', ...payload });
  }

  @OnEvent('boq.locked')
  async onBoqLocked(payload: { boqId: string; projectId: string }) {
    // Written in BoqService transaction — no-op here
    this.logger.debug({ message: 'Timeline: boq.locked (written in service)', ...payload });
  }

  @OnEvent('boq.variation.raised')
  async onVariationRaised(payload: { variationId: string; boqId: string }) {
    // Written in BoqService transaction — no-op here
    this.logger.debug({ message: 'Timeline: variation.raised (written in service)', ...payload });
  }

  @OnEvent('boq.variation.approved')
  async onVariationApproved(payload: { variationId: string; boqId: string }) {
    // Written in BoqService transaction — no-op here
    this.logger.debug({ message: 'Timeline: variation.approved (written in service)', ...payload });
  }

  // ── Milestone events ───────────────────────────────────────────────────────

  @OnEvent('milestone.started')
  async onMilestoneStarted(payload: { milestoneId: string; projectId: string }) {
    // Written in MilestoneService transaction — no-op here
    this.logger.debug({ message: 'Timeline: milestone.started (written in service)', ...payload });
  }

  @OnEvent('milestone.submitted')
  async onMilestoneSubmitted(payload: { milestoneId: string; projectId: string }) {
    // Written in MilestoneService transaction — no-op here
    this.logger.debug({ message: 'Timeline: milestone.submitted (written in service)', ...payload });
  }

  @OnEvent('milestone.approved')
  async onMilestoneApproved(payload: { milestoneId: string; projectId: string }) {
    // Written in MilestoneService transaction — no-op here
    this.logger.debug({ message: 'Timeline: milestone.approved (written in service)', ...payload });
  }

  @OnEvent('milestone.changes_requested')
  async onMilestoneChangesRequested(payload: { milestoneId: string; projectId: string; notes: string }) {
    await this.write(payload.projectId, TimelineEventType.MILESTONE_SUBMITTED, undefined, {
      milestoneId: payload.milestoneId,
      action: 'CHANGES_REQUESTED',
    });
  }

  // ── Escrow events ──────────────────────────────────────────────────────────

  @OnEvent('escrow.funded')
  async onEscrowFunded(payload: { escrowId: string }) {
    // Written in EscrowStateService transaction — no-op here
    this.logger.debug({ message: 'Timeline: escrow.funded (written in service)', ...payload });
  }

  @OnEvent('escrow.release.queued')
  async onEscrowReleaseQueued(payload: { escrowId: string; amountPaise: number; idempotencyKey: string }) {
    // Written in EscrowStateService transaction — no-op here
    this.logger.debug({ message: 'Timeline: escrow.release.queued (written in service)', ...payload });
  }

  @OnEvent('escrow.refund.queued')
  async onEscrowRefundQueued(payload: { escrowId: string; amountPaise: number; idempotencyKey: string }) {
    // Written in EscrowStateService transaction — no-op here
    this.logger.debug({ message: 'Timeline: escrow.refund.queued (written in service)', ...payload });
  }

  // ── Dispute events ─────────────────────────────────────────────────────────

  @OnEvent('dispute.opened')
  async onDisputeOpened(payload: { disputeId: string; projectId: string }) {
    // Written in DisputeService transaction — no-op here
    this.logger.debug({ message: 'Timeline: dispute.opened (written in service)', ...payload });
  }

  @OnEvent('dispute.decided')
  async onDisputeDecided(payload: { disputeId: string; decision: string }) {
    // Written in DisputeService transaction — no-op here
    this.logger.debug({ message: 'Timeline: dispute.decided (written in service)', ...payload });
  }

  // ── Rating events ──────────────────────────────────────────────────────────

  @OnEvent('rating.submitted')
  async onRatingSubmitted(payload: { projectId: string; raterId: string }) {
    await this.write(payload.projectId, TimelineEventType.PROJECT_COMPLETED, payload.raterId, {
      action: 'RATING_SUBMITTED',
    });
  }

  // ── Private helper ─────────────────────────────────────────────────────────

  private async write(
    projectId: string,
    eventType: TimelineEventType,
    actorId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.trustTimelineEvent.create({
        data: { projectId, eventType, actorId, metadata: metadata as Prisma.InputJsonValue },
      });
    } catch (error) {
      // Never throw from timeline — it's observational, not transactional
      this.logger.error({
        message: 'Failed to write timeline event',
        projectId,
        eventType,
        error: (error as Error).message,
      });
    }
  }
}
