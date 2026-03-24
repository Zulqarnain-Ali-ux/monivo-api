import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BudgetService }   from './budget.service';
import { BudgetCategory }  from './budget-category.entity';

const makeCategory = (overrides = {}): BudgetCategory =>
  ({ id: 'cat-1', userId: 'user-1', catId: 'groc', name: 'Groceries',
     groupType: 'variable', amount: 600, isDefault: true, sortOrder: 0,
     icon: '🛒', catKey: 'groceries', updatedAt: new Date(), ...overrides } as BudgetCategory);

const mockRepo = () => ({
  find:    jest.fn(),
  findOne: jest.fn(),
  create:  jest.fn().mockImplementation((d: unknown) => d),
  save:    jest.fn().mockImplementation((d: unknown) =>
    Array.isArray(d) ? Promise.resolve(d) : Promise.resolve({ ...d as object })),
  remove:  jest.fn().mockResolvedValue(undefined),
  count:   jest.fn().mockResolvedValue(5),
});

describe('BudgetService', () => {
  let service: BudgetService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BudgetService,
        { provide: getRepositoryToken(BudgetCategory), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(BudgetService);
    repo    = module.get(getRepositoryToken(BudgetCategory));
  });

  describe('updateOne()', () => {
    it('updates category amount', async () => {
      repo.findOne.mockResolvedValue(makeCategory());
      const result = await service.updateOne('user-1', 'groc', { amount: 500 });
      expect(repo.save).toHaveBeenCalled();
      expect(result.amount).toBe(500);
    });

    it('throws NotFoundException for unknown catId', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.updateOne('user-1', 'ghost', { amount: 100 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeCategory()', () => {
    it('removes a custom (non-default) category', async () => {
      repo.findOne.mockResolvedValue(makeCategory({ isDefault: false, userId: 'user-1' }));
      await service.removeCategory('user-1', 'cat-1');
      expect(repo.remove).toHaveBeenCalled();
    });

    it('throws ForbiddenException for default categories', async () => {
      repo.findOne.mockResolvedValue(makeCategory({ isDefault: true, userId: 'user-1' }));
      await expect(service.removeCategory('user-1', 'cat-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when category belongs to another user', async () => {
      repo.findOne.mockResolvedValue(makeCategory({ isDefault: false, userId: 'other-user' }));
      await expect(service.removeCategory('user-1', 'cat-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when category does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.removeCategory('user-1', 'ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('applyAutopilot()', () => {
    const variableCats = [
      makeCategory({ catId: 'groc', amount: 600, groupType: 'variable' }),
      makeCategory({ catId: 'dining', amount: 350, groupType: 'variable', id: 'cat-2' }),
    ];

    it('reduces variable categories by 20% in aggressive mode', async () => {
      repo.find.mockResolvedValue(variableCats.map(c => ({ ...c })));
      const result = await service.applyAutopilot('user-1', 'aggressive');
      expect(result[0].amount).toBe(480);  // 600 * 0.80
      expect(result[1].amount).toBe(280);  // 350 * 0.80
    });

    it('keeps amounts unchanged in balanced mode', async () => {
      repo.find.mockResolvedValue(variableCats.map(c => ({ ...c })));
      const result = await service.applyAutopilot('user-1', 'balanced');
      expect(result[0].amount).toBe(600);
      expect(result[1].amount).toBe(350);
    });

    it('increases variable categories by 15% in free mode', async () => {
      repo.find.mockResolvedValue(variableCats.map(c => ({ ...c })));
      const result = await service.applyAutopilot('user-1', 'free');
      expect(result[0].amount).toBe(690);  // 600 * 1.15
      expect(result[1].amount).toBe(402.5); // 350 * 1.15
    });
  });

  describe('bulkUpdate()', () => {
    it('updates multiple categories in one call', async () => {
      repo.findOne
        .mockResolvedValueOnce(makeCategory({ catId: 'groc', amount: 600 }))
        .mockResolvedValueOnce(makeCategory({ catId: 'dining', amount: 350, id: 'cat-2' }));
      const updates = [{ catId: 'groc', amount: 500 }, { catId: 'dining', amount: 300 }];
      const result = await service.bulkUpdate('user-1', updates);
      expect(result).toHaveLength(2);
      expect(repo.save).toHaveBeenCalledTimes(2);
    });

    it('silently skips unknown catIds', async () => {
      repo.findOne.mockResolvedValue(null);
      const result = await service.bulkUpdate('user-1', [{ catId: 'ghost', amount: 100 }]);
      expect(result).toHaveLength(0);
    });
  });
});
