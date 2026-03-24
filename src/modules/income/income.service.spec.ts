import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IncomeService } from './income.service';
import { Income }        from './income.entity';

const makeIncome = (overrides = {}): Income =>
  ({ id: 'i1', userId: 'u1', salary: 5000, side: 500, passive: 200,
     savingsGoal: 600, investGoal: 300, updatedAt: new Date(), ...overrides }) as Income;

const mockRepo = () => ({
  findOne: jest.fn(),
  create:  jest.fn().mockImplementation((d: unknown) => d),
  save:    jest.fn().mockImplementation((d: unknown) => Promise.resolve({ id: 'i1', ...d as object })),
});

describe('IncomeService', () => {
  let service: IncomeService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IncomeService,
        { provide: getRepositoryToken(Income), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(IncomeService);
    repo    = module.get(getRepositoryToken(Income));
  });

  describe('get()', () => {
    it('returns existing income record', async () => {
      repo.findOne.mockResolvedValue(makeIncome());
      const result = await service.get('u1');
      expect(result.salary).toBe(5000);
    });

    it('creates and returns default record when none exists', async () => {
      repo.findOne.mockResolvedValue(null);
      await service.get('u1');
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('update()', () => {
    it('updates salary', async () => {
      repo.findOne.mockResolvedValue(makeIncome());
      const result = await service.update('u1', { salary: 7000 });
      expect(result.salary).toBe(7000);
    });

    it('updates multiple fields at once', async () => {
      repo.findOne.mockResolvedValue(makeIncome());
      await service.update('u1', { salary: 6000, side: 800, savingsGoal: 900 });
      const saved = (repo.save as jest.Mock).mock.calls[0][0] as Income;
      expect(saved.salary).toBe(6000);
      expect(saved.side).toBe(800);
      expect(saved.savingsGoal).toBe(900);
    });

    it('does not change unspecified fields', async () => {
      repo.findOne.mockResolvedValue(makeIncome({ passive: 200 }));
      await service.update('u1', { salary: 6000 });
      const saved = (repo.save as jest.Mock).mock.calls[0][0] as Income;
      expect(saved.passive).toBe(200);
    });
  });

  describe('totalMonthly()', () => {
    it('sums salary + side + passive correctly', () => {
      const income = makeIncome({ salary: 5000, side: 500, passive: 200 });
      expect(service.totalMonthly(income)).toBe(5700);
    });

    it('returns 0 for all-zero income', () => {
      const income = makeIncome({ salary: 0, side: 0, passive: 0 });
      expect(service.totalMonthly(income)).toBe(0);
    });

    it('handles string-typed numbers from DB (TypeORM returns strings for NUMERIC)', () => {
      const income = makeIncome({ salary: '5000' as unknown as number, side: '500' as unknown as number, passive: '200' as unknown as number });
      expect(service.totalMonthly(income)).toBe(5700);
    });
  });
});
