import { Test, TestingModule } from '@nestjs/testing';
import { EscrowStateService } from '../escrow-state.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EscrowStateException } from '../../../common/exceptions/business.exceptions';

const mockPrisma = {
  $transaction: jest.fn(),
  escrowAccount: { update: jest.fn() },
  escrowTransaction: { findUnique: jest.fn(), create: jest.fn() },
  milestone: { findUnique: jest.fn(), update: jest.fn() },
  trustTimelineEvent: { create: jest.fn() },
  $queryRaw: jest.fn(),
};

const mockEventEmitter = { emit: jest.fn() };

describe('EscrowStateService', () => {
  let service: EscrowStateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowStateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<EscrowStateService>(EscrowStateService);
    jest.clearAllMocks();
  });

  describe('fund()', () => {
    it('should be idempotent — skip if already processed', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.escrowTransaction.findUnique.mockResolvedValue({ id: 'existing' });
        return fn(mockPrisma);
      });

      await service.fund('escrow-1', 'pay-1', 100000, 'idem-key-1');
      expect(mockPrisma.escrowAccount.update).not.toHaveBeenCalled();
    });

    it('should emit escrow.funded event on success', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.escrowTransaction.findUnique.mockResolvedValue(null);
        mockPrisma.$queryRaw.mockResolvedValue([{ id: 'escrow-1', status: 'PENDING_FUNDING', milestone_id: 'ms-1' }]);
        mockPrisma.escrowAccount.update.mockResolvedValue({});
        mockPrisma.milestone.update.mockResolvedValue({});
        mockPrisma.escrowTransaction.create.mockResolvedValue({});
        mockPrisma.milestone.findUnique.mockResolvedValue({ projectId: 'proj-1', id: 'ms-1' });
        mockPrisma.trustTimelineEvent.create.mockResolvedValue({});
        return fn(mockPrisma);
      });

      await service.fund('escrow-1', 'pay-1', 100000, 'idem-key-2');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('escrow.funded', { escrowId: 'escrow-1' });
    });
  });

  describe('hold()', () => {
    it('should be idempotent — skip if already HELD', async () => {
      mockPrisma.$transaction.mockImplementation(async (fn: Function) => {
        mockPrisma.$queryRaw.mockResolvedValue([{ id: 'escrow-1', status: 'HELD' }]);
        return fn(mockPrisma);
      });

      await service.hold('escrow-1', 'dispute-1');
      expect(mockPrisma.escrowAccount.update).not.toHaveBeenCalled();
    });
  });
});
