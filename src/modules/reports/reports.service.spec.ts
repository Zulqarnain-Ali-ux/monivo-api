import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReportsService } from './reports.service';
import { Entry } from '../entries/entry.entity';
import { BudgetCategory } from '../budget/budget-category.entity';
import { Income } from '../income/income.entity';

const mockRepo = () => ({ find: jest.fn(), findOne: jest.fn() });
const mockDs = () => ({ query: jest.fn() });

describe('ReportsService', () => {
  let service: ReportsService;
  let ds: ReturnType<typeof mockDs>;
  let budgetRepo: ReturnType<typeof mockRepo>;
  let incomeRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: DataSource,                        useFactory: mockDs },
        { provide: getRepositoryToken(Entry),         useFactory: mockRepo },
        { provide: getRepositoryToken(BudgetCategory),useFactory: mockRepo },
        { provide: getRepositoryToken(Income),        useFactory: mockRepo },
      ],
    }).compile();

    service    = module.get(ReportsService);
    ds         = module.get(DataSource);
    budgetRepo = module.get(getRepositoryToken(BudgetCategory));
    incomeRepo = module.get(getRepositoryToken(Income));
  });

  describe('benchmarks()', () => {
    it('correctly flags category as over average at 10% threshold', async () => {
      // $352 dining vs $320 avg: 352 >= 320 * 1.1 = 352 → isOver true
      ds.query.mockResolvedValue([{ category: 'dining', total: '352.00' }]);
      const results = await service.benchmarks('user1');
      const dining = results.find(r => r.category === 'dining');
      expect(dining?.isOver).toBe(true);
    });

    it('flags as below average when under 10% threshold', async () => {
      // $340 dining vs $320 avg: 340 < 352 → isOver false
      ds.query.mockResolvedValue([{ category: 'dining', total: '340.00' }]);
      const results = await service.benchmarks('user1');
      const dining = results.find(r => r.category === 'dining');
      expect(dining?.isOver).toBe(false);
    });

    it('returns zero for categories with no spending', async () => {
      ds.query.mockResolvedValue([]);
      const results = await service.benchmarks('user1');
      results.forEach(r => { expect(r.yours).toBe(0); expect(r.isOver).toBe(false); });
    });
  });

  describe('weeklySummary()', () => {
    it('computes difference and savings opportunity correctly', async () => {
      ds.query.mockResolvedValue([
        { category: 'dining',    total: '200' },
        { category: 'groceries', total: '150' },
      ]);
      budgetRepo.find.mockResolvedValue([
        { groupType: 'variable', amount: 900 }, // $900/mo variable → $210/week
      ]);

      const summary = await service.weeklySummary('u1', '2026-03-09', '2026-03-15');
      expect(summary.totalSpent).toBe(350);
      expect(Math.round(summary.weekBudget)).toBe(210);
      expect(summary.difference).toBeCloseTo(140, 0);
      expect(summary.savingsOpportunity).toBeGreaterThan(0);
    });
  });

  describe('monthlySummary()', () => {
    it('groups rows by month correctly', async () => {
      ds.query.mockResolvedValue([
        { month: '2026-02', category: 'dining',    total: '320', cnt: '8' },
        { month: '2026-02', category: 'groceries', total: '280', cnt: '6' },
        { month: '2026-03', category: 'dining',    total: '200', cnt: '5' },
      ]);

      const results = await service.monthlySummary('u1', 2);
      expect(results).toHaveLength(2);
      const feb = results.find(r => r.month === '2026-02')!;
      expect(feb.total).toBe(600);
      expect(feb.byCategory).toHaveLength(2);
    });
  });
});
