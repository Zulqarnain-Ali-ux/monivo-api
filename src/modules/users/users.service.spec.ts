import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './user.entity';

const makeUser = (overrides = {}): User =>
  ({ id: 'u1', fname: 'Jane', lname: 'Doe', email: 'jane@test.com',
     initials: 'JD', isActive: true, refreshTokenHash: 'hash', ...overrides }) as User;

const mockRepo = () => ({
  findOne: jest.fn(),
  save:    jest.fn().mockImplementation((u: User) => Promise.resolve(u)),
});

describe('UsersService', () => {
  let service: UsersService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(UsersService);
    repo    = module.get(getRepositoryToken(User));
  });

  describe('update()', () => {
    it('updates fname and recalculates initials', async () => {
      repo.findOne.mockResolvedValueOnce(makeUser());
      const result = await service.update('u1', { fname: 'Alice' });
      expect(result.fname).toBe('Alice');
      expect(result.initials).toBe('AD');
    });

    it('updates email if not taken', async () => {
      repo.findOne
        .mockResolvedValueOnce(makeUser())        // findOne for user
        .mockResolvedValueOnce(null);             // findOne for email conflict
      const result = await service.update('u1', { email: 'new@test.com' });
      expect(result.email).toBe('new@test.com');
    });

    it('throws ConflictException if new email is taken', async () => {
      repo.findOne
        .mockResolvedValueOnce(makeUser())
        .mockResolvedValueOnce(makeUser({ id: 'other-user', email: 'new@test.com' }));
      await expect(service.update('u1', { email: 'new@test.com' })).rejects.toThrow(ConflictException);
    });

    it('does not check email conflict when email is unchanged', async () => {
      repo.findOne.mockResolvedValueOnce(makeUser());
      await service.update('u1', { email: 'jane@test.com' });
      expect(repo.findOne).toHaveBeenCalledTimes(1); // no second lookup
    });

    it('throws NotFoundException for unknown user', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.update('ghost', { fname: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivate()', () => {
    it('sets isActive to false and clears refresh token', async () => {
      const user = makeUser();
      repo.findOne.mockResolvedValue(user);
      await service.deactivate('u1');
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false, refreshTokenHash: null }),
      );
    });

    it('throws NotFoundException for unknown user', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.deactivate('ghost')).rejects.toThrow(NotFoundException);
    });
  });
});
