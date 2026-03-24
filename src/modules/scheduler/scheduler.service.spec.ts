import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken }   from '@nestjs/typeorm';
import { SchedulerService }     from './scheduler.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReportsService }       from '../reports/reports.service';
import { User }   from '../users/user.entity';
import { Streak } from '../streak/streak.entity';

const mockUserRepo = () => ({
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
});
const mockStreakRepo = () => ({
  find: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue({
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  }),
});
const mockReports = () => ({
  weeklySummary:         jest.fn(),
  currentMonthBreakdown: jest.fn(),
});
const mockNotifications = () => ({
  queueWeeklyReport: jest.fn().mockResolvedValue(undefined),
  queueStreakAlert:  jest.fn().mockResolvedValue(undefined),
  queueOverBudget:   jest.fn().mockResolvedValue(undefined),
});

const makeUser = (id = 'u1') =>
  ({ id, email: `${id}@test.com`, fname: 'Test',
     isActive: true, emailVerified: true }) as User;

describe('SchedulerService', () => {
  let service: SchedulerService;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let streakRepo: ReturnType<typeof mockStreakRepo>;
  let reports: ReturnType<typeof mockReports>;
  let notifications: ReturnType<typeof mockNotifications>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        { provide: getRepositoryToken(User),   useFactory: mockUserRepo },
        { provide: getRepositoryToken(Streak), useFactory: mockStreakRepo },
        { provide: ReportsService,             useFactory: mockReports },
        { provide: NotificationsService,       useFactory: mockNotifications },
      ],
    }).compile();

    service       = module.get(SchedulerService);
    userRepo      = module.get(getRepositoryToken(User));
    streakRepo    = module.get(getRepositoryToken(Streak));
    reports       = module.get(ReportsService);
    notifications = module.get(NotificationsService);
  });

  // ── Weekly reports ────────────────────────────────────────────────
  describe('sendWeeklyReports()', () => {
    const activeSummary = {
      weekStart: '2026-03-09', weekEnd: '2026-03-15',
      totalSpent: 420, weekBudget: 350, difference: 70,
      topCategories: [{ category: 'dining', total: 200 }],
      savingsOpportunity: 35,
    };

    it('queues weekly report for each active user with spending', async () => {
      userRepo.find.mockResolvedValue([makeUser('u1'), makeUser('u2')]);
      reports.weeklySummary.mockResolvedValue(activeSummary);

      await service.sendWeeklyReports();
      expect(notifications.queueWeeklyReport).toHaveBeenCalledTimes(2);
    });

    it('skips users with zero spending this week', async () => {
      userRepo.find.mockResolvedValue([makeUser('u1')]);
      reports.weeklySummary.mockResolvedValue({ ...activeSummary, totalSpent: 0 });

      await service.sendWeeklyReports();
      expect(notifications.queueWeeklyReport).not.toHaveBeenCalled();
    });

    it('continues when one user fails — does not throw', async () => {
      userRepo.find.mockResolvedValue([makeUser('u1'), makeUser('u2')]);
      reports.weeklySummary
        .mockRejectedValueOnce(new Error('DB timeout'))
        .mockResolvedValueOnce(activeSummary);

      await expect(service.sendWeeklyReports()).resolves.not.toThrow();
      expect(notifications.queueWeeklyReport).toHaveBeenCalledTimes(1);
    });

    it('no-ops on empty user list', async () => {
      userRepo.find.mockResolvedValue([]);
      await expect(service.sendWeeklyReports()).resolves.not.toThrow();
      expect(notifications.queueWeeklyReport).not.toHaveBeenCalled();
    });
  });

  // ── Streak alerts ─────────────────────────────────────────────────
  describe('sendStreakAlerts()', () => {
    it('queues alert for at-risk users returned by query builder', async () => {
      const qb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { userId: 'u1', days: 7, user: makeUser('u1') },
        ]),
      };
      streakRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.sendStreakAlerts();
      expect(notifications.queueStreakAlert).toHaveBeenCalledTimes(1);
      expect(notifications.queueStreakAlert).toHaveBeenCalledWith('u1@test.com', 'Test', 7);
    });

    it('sends no alerts when no at-risk users', async () => {
      const qb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      streakRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      await service.sendStreakAlerts();
      expect(notifications.queueStreakAlert).not.toHaveBeenCalled();
    });
  });

  // ── Over-budget alerts ────────────────────────────────────────────
  describe('sendOverBudgetAlerts()', () => {
    beforeEach(() => {
      // Pin to March 15 (16 days left — above 5-day threshold)
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    const budgetSummary = {
      total: 350,
      byCategory: [{ category: 'dining', total: 350, count: 8 }],
      budget: [{ catId: 'dining', name: 'Dining', amount: 300, groupType: 'variable' }],
      income: { total: 5000, savingsGoal: 600 },
      dailyAllowance: 45, daysInMonth: 31, dayOfMonth: 15,
    };

    it('queues alert when category is >20% over prorated budget', async () => {
      // prorated = 300 * (15/31) = 145.16, actual = 350 → ratio 2.41 → triggers
      userRepo.find.mockResolvedValue([makeUser('u1')]);
      reports.currentMonthBreakdown.mockResolvedValue(budgetSummary);

      await service.sendOverBudgetAlerts();
      expect(notifications.queueOverBudget).toHaveBeenCalledTimes(1);
    });

    it('does not alert when within prorated budget', async () => {
      // actual = 80, prorated = 145.16 → fine
      userRepo.find.mockResolvedValue([makeUser('u1')]);
      reports.currentMonthBreakdown.mockResolvedValue({
        ...budgetSummary,
        byCategory: [{ category: 'dining', total: 80, count: 3 }],
      });

      await service.sendOverBudgetAlerts();
      expect(notifications.queueOverBudget).not.toHaveBeenCalled();
    });

    it('sends only one alert per user per day even if multiple categories over', async () => {
      userRepo.find.mockResolvedValue([makeUser('u1')]);
      reports.currentMonthBreakdown.mockResolvedValue({
        ...budgetSummary,
        byCategory: [
          { category: 'dining',    total: 400, count: 10 },
          { category: 'groceries', total: 300, count: 8  },
        ],
        budget: [
          { catId: 'dining',    name: 'Dining',    amount: 200, groupType: 'variable' },
          { catId: 'groceries', name: 'Groceries', amount: 150, groupType: 'variable' },
        ],
      });

      await service.sendOverBudgetAlerts();
      expect(notifications.queueOverBudget).toHaveBeenCalledTimes(1);
    });
  });
});
