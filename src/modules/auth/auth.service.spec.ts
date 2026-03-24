import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { User }           from '../users/user.entity';
import { Income }         from '../income/income.entity';
import { Streak }         from '../streak/streak.entity';
import { BudgetCategory } from '../budget/budget-category.entity';

const mockRepo = () => ({
  findOne: jest.fn(),
  create:  jest.fn().mockImplementation((d: unknown) => d),
  save:    jest.fn().mockImplementation((d: unknown) => Promise.resolve({ id: 'user-uuid', ...d as object })),
  update:  jest.fn().mockResolvedValue({}),
});

const mockJwt = () => ({
  signAsync: jest.fn().mockResolvedValue('mocked-token'),
});

const mockConfig = () => ({
  get: jest.fn((key: string) => {
    const map: Record<string, unknown> = {
      'jwt.secret':          'test-secret-32-chars-long-at-least',
      'jwt.refreshSecret':   'test-refresh-secret-32-chars-long',
      'jwt.expiresIn':       '15m',
      'jwt.refreshExpiresIn':'30d',
      'jwt.bcryptRounds':    4, // low rounds for test speed
    };
    return map[key];
  }),
});

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User),           useFactory: mockRepo },
        { provide: getRepositoryToken(Income),         useFactory: mockRepo },
        { provide: getRepositoryToken(Streak),         useFactory: mockRepo },
        { provide: getRepositoryToken(BudgetCategory), useFactory: mockRepo },
        { provide: JwtService,                         useFactory: mockJwt },
        { provide: ConfigService,                      useFactory: mockConfig },
      ],
    }).compile();

    service  = module.get(AuthService);
    userRepo = module.get(getRepositoryToken(User));
  });

  // ── signUp ───────────────────────────────────────────────────────
  describe('signUp()', () => {
    const dto = { fname: 'Jane', lname: 'Doe', email: 'jane@test.com', password: 'password123', income: 5000 };

    it('creates a user and returns tokens', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.signUp(dto);
      expect(result.accessToken).toBe('mocked-token');
      expect(result.user.email).toBe('jane@test.com');
      expect(result.user.fname).toBe('Jane');
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('throws ConflictException for duplicate email', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'existing-id', email: dto.email });
      await expect(service.signUp(dto)).rejects.toThrow(ConflictException);
    });

    it('hashes the password before saving', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await service.signUp(dto);
      const savedUser = userRepo.save.mock.calls[0][0] as { passwordHash: string };
      expect(savedUser.passwordHash).toBeDefined();
      expect(savedUser.passwordHash).not.toBe(dto.password);
      const valid = await bcrypt.compare(dto.password, savedUser.passwordHash);
      expect(valid).toBe(true);
    });

    it('derives initials from fname + lname', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await service.signUp(dto);
      const saved = userRepo.save.mock.calls[0][0] as { initials: string };
      expect(saved.initials).toBe('JD');
    });

    it('uses empty initials when lname is missing', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const noLname = { ...dto, lname: undefined };
      await service.signUp(noLname);
      const saved = userRepo.save.mock.calls[0][0] as { initials: string };
      expect(saved.initials).toBe('J');
    });
  });

  // ── signIn ───────────────────────────────────────────────────────
  describe('signIn()', () => {
    const dto = { email: 'jane@test.com', password: 'password123' };

    it('returns tokens for valid credentials', async () => {
      const hash = await bcrypt.hash('password123', 4);
      userRepo.findOne.mockResolvedValue({
        id: 'user-1', email: dto.email,
        fname: 'Jane', lname: 'Doe', initials: 'JD',
        passwordHash: hash, isActive: true,
      });
      const result = await service.signIn(dto);
      expect(result.accessToken).toBe('mocked-token');
      expect(result.user.email).toBe(dto.email);
    });

    it('throws UnauthorizedException for wrong password', async () => {
      const hash = await bcrypt.hash('correct-password', 4);
      userRepo.findOne.mockResolvedValue({ passwordHash: hash, isActive: true });
      await expect(service.signIn({ ...dto, password: 'wrong' })).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for unknown email', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.signIn(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for inactive user', async () => {
      const hash = await bcrypt.hash('password123', 4);
      userRepo.findOne.mockResolvedValue({ passwordHash: hash, isActive: false });
      // findOne with isActive:true filter returns null
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.signIn(dto)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── signOut ──────────────────────────────────────────────────────
  describe('signOut()', () => {
    it('clears refreshTokenHash on signout', async () => {
      await service.signOut('user-1');
      expect(userRepo.update).toHaveBeenCalledWith('user-1', { refreshTokenHash: null });
    });
  });

  // ── validateRefreshToken ─────────────────────────────────────────
  describe('validateRefreshToken()', () => {
    it('returns user when token matches hash', async () => {
      const token = 'my-refresh-token';
      const hash  = await bcrypt.hash(token, 4);
      const user  = { id: 'u1', refreshTokenHash: hash, isActive: true };
      userRepo.findOne.mockResolvedValue(user);
      const result = await service.validateRefreshToken('u1', token);
      expect(result).not.toBeNull();
      expect(result?.id).toBe('u1');
    });

    it('returns null when token does not match', async () => {
      const hash = await bcrypt.hash('correct-token', 4);
      userRepo.findOne.mockResolvedValue({ id: 'u1', refreshTokenHash: hash, isActive: true });
      const result = await service.validateRefreshToken('u1', 'wrong-token');
      expect(result).toBeNull();
    });

    it('returns null when user has no refresh token', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', refreshTokenHash: null, isActive: true });
      const result = await service.validateRefreshToken('u1', 'any-token');
      expect(result).toBeNull();
    });
  });
});
