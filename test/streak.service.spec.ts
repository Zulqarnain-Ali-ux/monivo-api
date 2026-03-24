import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StreakService } from '../../src/modules/streak/streak.service';
import { Streak } from '../../src/modules/streak/streak.entity';

const mockRepo = () => ({
  findOne: jest.fn(),
  create:  jest.fn(),
  save:    jest.fn(),
});

describe('StreakService', () => {
  let service: StreakService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StreakService,
        { provide: getRepositoryToken(Streak), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(StreakService);
    repo    = module.get(getRepositoryToken(Streak));
  });

  const TODAY     = '2026-03-15';
  const YESTERDAY = '2026-03-14';
  const TWO_AGO   = '2026-03-13';
  const THREE_AGO = '2026-03-12';

  const makeStreak = (overrides: Partial<Streak> = {}): Streak =>
    ({ userId: 'u1', days: 5, lastLog: YESTERDAY, graceUsed: false, updatedAt: new Date(), ...overrides } as Streak);

  beforeEach(() => {
    repo.save.mockImplementation((s: Streak) => Promise.resolve(s));
    repo.create.mockImplementation((s: Partial<Streak>) => s as Streak);
  });

  describe('update()', () => {
    it('increments streak when logging day after lastLog', async () => {
      repo.findOne.mockResolvedValue(makeStreak({ days: 5, lastLog: YESTERDAY }));
      const result = await service.update('u1', TODAY);
      expect(result.days).toBe(6);
      expect(result.lastLog).toBe(TODAY);
      expect(result.graceUsed).toBe(false);
    });

    it('does not change streak when logging same day twice', async () => {
      repo.findOne.mockResolvedValue(makeStreak({ days: 5, lastLog: TODAY }));
      const result = await service.update('u1', TODAY);
      expect(result.days).toBe(5);
    });

    it('applies grace period when missing one day (no grace used)', async () => {
      repo.findOne.mockResolvedValue(makeStreak({ days: 5, lastLog: TWO_AGO, graceUsed: false }));
      const result = await service.update('u1', TODAY);
      expect(result.days).toBe(6);
      expect(result.graceUsed).toBe(true);
    });

    it('resets to 1 when missing one day but grace already used', async () => {
      repo.findOne.mockResolvedValue(makeStreak({ days: 5, lastLog: TWO_AGO, graceUsed: true }));
      const result = await service.update('u1', TODAY);
      expect(result.days).toBe(1);
    });

    it('resets to 1 after missing 3+ days', async () => {
      repo.findOne.mockResolvedValue(makeStreak({ days: 20, lastLog: THREE_AGO, graceUsed: false }));
      const result = await service.update('u1', TODAY);
      expect(result.days).toBe(1);
    });

    it('starts streak at 1 for first ever log (null lastLog)', async () => {
      repo.findOne.mockResolvedValue(makeStreak({ days: 0, lastLog: null }));
      const result = await service.update('u1', TODAY);
      expect(result.days).toBe(1);
      expect(result.lastLog).toBe(TODAY);
    });

    it('resets grace flag after consecutive log', async () => {
      repo.findOne.mockResolvedValue(makeStreak({ days: 7, lastLog: YESTERDAY, graceUsed: true }));
      const result = await service.update('u1', TODAY);
      expect(result.days).toBe(8);
      expect(result.graceUsed).toBe(false);
    });
  });
});
