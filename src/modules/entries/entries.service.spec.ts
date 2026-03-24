import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntriesService } from './entries.service';
import { Entry }          from './entry.entity';
import { StreakService }  from '../streak/streak.service';

const mockRepo = () => ({
  find:    jest.fn(),
  findOne: jest.fn(),
  create:  jest.fn().mockImplementation((d: unknown) => d),
  save:    jest.fn().mockImplementation((d: unknown) => Promise.resolve({ id: 'entry-uuid', ...d as object })),
  remove:  jest.fn().mockResolvedValue(undefined),
});

const mockStreak = () => ({
  update: jest.fn().mockResolvedValue({ days: 1, lastLog: '2026-03-15', graceUsed: false }),
});

describe('EntriesService', () => {
  let service: EntriesService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntriesService,
        { provide: getRepositoryToken(Entry), useFactory: mockRepo },
        { provide: StreakService,              useFactory: mockStreak },
      ],
    }).compile();

    service = module.get(EntriesService);
    repo    = module.get(getRepositoryToken(Entry));
  });

  describe('create()', () => {
    const dto = { amount: 25.50, category: 'dining', entryDate: '2026-03-15', entryTs: 1741996800000, note: 'Lunch' };

    it('saves entry and returns it with id', async () => {
      const result = await service.create('user-1', dto);
      expect(result.id).toBe('entry-uuid');
      expect(repo.save).toHaveBeenCalled();
    });

    it('calls streak.update with the entry date', async () => {
      const streakService = module.get(StreakService);
      await service.create('user-1', dto);
      expect(streakService.update).toHaveBeenCalledWith('user-1', '2026-03-15');
    });

    it('sets note to empty string when not provided', async () => {
      await service.create('user-1', { ...dto, note: undefined });
      const saved = repo.save.mock.calls[0][0] as { note: string };
      expect(saved.note).toBe('');
    });

    // Capture module reference
    let module: TestingModule;
    beforeEach(async () => {
      module = await Test.createTestingModule({
        providers: [
          EntriesService,
          { provide: getRepositoryToken(Entry), useFactory: mockRepo },
          { provide: StreakService,              useFactory: mockStreak },
        ],
      }).compile();
      service = module.get(EntriesService);
      repo    = module.get(getRepositoryToken(Entry));
    });
  });

  describe('remove()', () => {
    it('deletes entry that belongs to user', async () => {
      repo.findOne.mockResolvedValue({ id: 'entry-1', userId: 'user-1' });
      await service.remove('user-1', 'entry-1');
      expect(repo.remove).toHaveBeenCalled();
    });

    it('throws NotFoundException when entry does not exist', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.remove('user-1', 'ghost-id')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when entry belongs to another user', async () => {
      repo.findOne.mockResolvedValue({ id: 'entry-1', userId: 'other-user' });
      await expect(service.remove('user-1', 'entry-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findToday()', () => {
    it('filters by current UTC date', async () => {
      const today = new Date().toISOString().slice(0, 10);
      repo.find.mockResolvedValue([]);
      await service.findToday('user-1');
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ entryDate: today }) }),
      );
    });
  });
});
