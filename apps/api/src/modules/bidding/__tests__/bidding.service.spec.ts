import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { BiddingService } from '../bidding.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProjectStateService } from '../../project/project-state.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

const mockPrisma = {
  vendorProfile: { findUniqueOrThrow: jest.fn(), findUnique: jest.fn() },
  customerProfile: { findUniqueOrThrow: jest.fn(), findUnique: jest.fn() },
  project: { findUniqueOrThrow: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn() },
  bid: { findMany: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  negotiationThread: { create: jest.fn() },
  trustTimelineEvent: { create: jest.fn() },
  $transaction: jest.fn(),
};

const mockProjectState = { transition: jest.fn() };
const mockEventEmitter = { emit: jest.fn() };

describe('BiddingService — Anonymity Enforcement', () => {
  let service: BiddingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BiddingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ProjectStateService, useValue: mockProjectState },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<BiddingService>(BiddingService);
    jest.clearAllMocks();
  });

  describe('getBiddingRoom()', () => {
    it('should never return vendorId in bid list', async () => {
      mockPrisma.customerProfile.findUniqueOrThrow.mockResolvedValue({ id: 'cust-1' });
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'proj-1', customerId: 'cust-1', title: 'Test', status: 'BIDDING_OPEN', publishedAt: new Date(), biddingExpiresAt: null });
      mockPrisma.bid.findMany.mockResolvedValue([
        { id: 'bid-1', totalQuotePaise: 120000000, timelineWeeks: 10, scopeAssumptions: 'Test', materialQualityLevel: 'STANDARD', notes: null, status: 'SUBMITTED', submittedAt: new Date() },
      ]);

      const result = await service.getBiddingRoom('proj-1', 'user-1');

      // Critical: vendorId must NOT be in any bid
      result.bids.forEach((bid: Record<string, unknown>) => {
        expect(bid).not.toHaveProperty('vendorId');
        expect(bid).not.toHaveProperty('vendorName');
      });
    });

    it('should assign sequential anonymous labels', async () => {
      mockPrisma.customerProfile.findUniqueOrThrow.mockResolvedValue({ id: 'cust-1' });
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'proj-1', customerId: 'cust-1', title: 'Test', status: 'BIDDING_OPEN', publishedAt: new Date(), biddingExpiresAt: null });
      mockPrisma.bid.findMany.mockResolvedValue([
        { id: 'bid-1', totalQuotePaise: 100000000, timelineWeeks: 10, scopeAssumptions: 'A', materialQualityLevel: 'STANDARD', notes: null, status: 'SUBMITTED', submittedAt: new Date() },
        { id: 'bid-2', totalQuotePaise: 120000000, timelineWeeks: 12, scopeAssumptions: 'B', materialQualityLevel: 'PREMIUM', notes: null, status: 'SUBMITTED', submittedAt: new Date() },
      ]);

      const result = await service.getBiddingRoom('proj-1', 'user-1');
      expect(result.bids[0].anonymousLabel).toBe('Vendor A');
      expect(result.bids[1].anonymousLabel).toBe('Vendor B');
    });
  });

  describe('getVendorProfilePreview()', () => {
    it('should never return phone or email', async () => {
      mockPrisma.customerProfile.findUniqueOrThrow.mockResolvedValue({ id: 'cust-1' });
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({ id: 'proj-1', customerId: 'cust-1' });
      mockPrisma.bid.findUniqueOrThrow.mockResolvedValue({
        id: 'bid-1',
        projectId: 'proj-1',
        totalQuotePaise: 120000000,
        timelineWeeks: 10,
        scopeAssumptions: 'Test',
        materialQualityLevel: 'STANDARD',
        vendor: {
          id: 'vendor-1',
          city: 'Bengaluru',
          categories: ['MODULAR_KITCHEN'],
          portfolioUrls: [],
          averageRating: 4.5,
          totalProjects: 10,
          bio: 'Test bio',
          // phone and email intentionally NOT in mock — they should never be selected
        },
      });
      mockPrisma.bid.findMany.mockResolvedValue([{ id: 'bid-1' }]);
      mockPrisma.project.findUniqueOrThrow.mockResolvedValue({ id: 'proj-1', customerId: 'cust-1' });

      const result = await service.getVendorProfilePreview('proj-1', 'bid-1', 'user-1');

      expect(result).not.toHaveProperty('phone');
      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('websiteUrl');
      expect(result).toHaveProperty('trustSignals');
      expect(result.trustSignals).toHaveLength(5);
    });
  });
});
