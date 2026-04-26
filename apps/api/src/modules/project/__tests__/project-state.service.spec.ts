import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ProjectStateService } from '../project-state.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProjectStatus } from '@prisma/client';

const mockPrisma = {
  $transaction: jest.fn(),
  project: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
  milestone: { findMany: jest.fn() },
  room: { count: jest.fn() },
  floorPlan: { count: jest.fn() },
  aiDesign: { count: jest.fn() },
  boqHeader: { findFirst: jest.fn() },
  trustTimelineEvent: { create: jest.fn() },
};

const mockEventEmitter = { emit: jest.fn() };

describe('ProjectStateService', () => {
  let service: ProjectStateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectStateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<ProjectStateService>(ProjectStateService);
    jest.clearAllMocks();
  });

  describe('DRAFT → BIDDING_OPEN (Path B)', () => {
    it('should throw when description is under 50 chars', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
          id: 'proj-1',
          status: ProjectStatus.DRAFT,
          spaceType: 'RESIDENTIAL',
          description: 'Too short',
          budgetMin: 500000,
          budgetMax: 1500000,
          timelineWeeks: 12,
        });
        return fn(mockPrisma);
      });

      await expect(
        service.transition('proj-1', ProjectStatus.BIDDING_OPEN, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when no reference exists', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
          id: 'proj-1',
          status: ProjectStatus.DRAFT,
          spaceType: 'RESIDENTIAL',
          description: 'A'.repeat(60),
          budgetMin: 500000,
          budgetMax: 1500000,
          timelineWeeks: 12,
        });
        mockPrisma.room.count.mockResolvedValue(0);
        mockPrisma.floorPlan.count.mockResolvedValue(0);
        mockPrisma.aiDesign.count.mockResolvedValue(0);
        return fn(mockPrisma);
      });

      await expect(
        service.transition('proj-1', ProjectStatus.BIDDING_OPEN, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('VENDOR_SELECTED → MILESTONES_LOCKED', () => {
    it('should throw when milestone percentages do not total 100%', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
          id: 'proj-1',
          status: ProjectStatus.VENDOR_SELECTED,
        });
        mockPrisma.milestone.findMany.mockResolvedValue([
          { percentage: 30 }, { percentage: 30 },
        ]);
        return fn(mockPrisma);
      });

      await expect(
        service.transition('proj-1', ProjectStatus.MILESTONES_LOCKED, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Invalid transitions', () => {
    it('should throw on invalid state jump', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.project.findUniqueOrThrow.mockResolvedValue({
          id: 'proj-1',
          status: ProjectStatus.DRAFT,
        });
        return fn(mockPrisma);
      });

      await expect(
        service.transition('proj-1', ProjectStatus.COMPLETED, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
