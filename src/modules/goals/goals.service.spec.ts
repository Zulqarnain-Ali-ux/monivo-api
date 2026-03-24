import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GoalsService } from './goals.service';
import { Goal }         from './goal.entity';

const makeGoal = (overrides = {}): Goal =>
  ({ id: 'g1', userId: 'u1', name: 'Emergency Fund',
     target: 5000, saved: 1200, goalType: 'emergency',
     createdAt: new Date(), updatedAt: new Date(), ...overrides }) as Goal;

const mockRepo = () => ({
  find:    jest.fn(),
  findOne: jest.fn(),
  create:  jest.fn().mockImplementation((d: unknown) => d),
  save:    jest.fn().mockImplementation((d: unknown) => Promise.resolve({ id: 'g-new', ...d as object })),
  remove:  jest.fn().mockResolvedValue(undefined),
});

describe('GoalsService', () => {
  let service: GoalsService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalsService,
        { provide: getRepositoryToken(Goal), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(GoalsService);
    repo    = module.get(getRepositoryToken(Goal));
  });

  describe('create()', () => {
    it('creates a goal with correct fields', async () => {
      const result = await service.create('u1', {
        name: 'Vacation', target: 3000, saved: 500, goalType: 'vacation',
      });
      expect(result.name).toBe('Vacation');
      expect(result.target).toBe(3000);
      expect(repo.save).toHaveBeenCalled();
    });

    it('defaults saved to 0 when not provided', async () => {
      await service.create('u1', { name: 'House', target: 50000 });
      const saved = (repo.save as jest.Mock).mock.calls[0][0] as { saved: number };
      expect(saved.saved).toBe(0);
    });

    it('defaults goalType to other when not provided', async () => {
      await service.create('u1', { name: 'Misc', target: 100 });
      const saved = (repo.save as jest.Mock).mock.calls[0][0] as { goalType: string };
      expect(saved.goalType).toBe('other');
    });
  });

  describe('update()', () => {
    it('updates saved amount', async () => {
      repo.findOne.mockResolvedValue(makeGoal());
      await service.update('u1', 'g1', { saved: 2000 });
      const saved = (repo.save as jest.Mock).mock.calls[0][0] as { saved: number };
      expect(saved.saved).toBe(2000);
    });

    it('throws NotFoundException for unknown goal', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.update('u1', 'ghost', { saved: 100 }))
        .rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when goal belongs to another user', async () => {
      repo.findOne.mockResolvedValue(makeGoal({ userId: 'other-user' }));
      await expect(service.update('u1', 'g1', { saved: 100 }))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove()', () => {
    it('deletes own goal', async () => {
      repo.findOne.mockResolvedValue(makeGoal());
      await service.remove('u1', 'g1');
      expect(repo.remove).toHaveBeenCalled();
    });

    it('throws NotFoundException for unknown goal', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.remove('u1', 'ghost')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException cross-user', async () => {
      repo.findOne.mockResolvedValue(makeGoal({ userId: 'other' }));
      await expect(service.remove('u1', 'g1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAll()', () => {
    it('returns all goals ordered by createdAt', async () => {
      repo.find.mockResolvedValue([makeGoal()]);
      const result = await service.findAll('u1');
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
      expect(result).toHaveLength(1);
    });
  });
});
