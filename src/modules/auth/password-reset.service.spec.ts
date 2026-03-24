import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService }    from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PasswordResetService } from './password-reset.service';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/user.entity';

const makeUser = (overrides = {}): User =>
  ({ id: 'u1', email: 'jane@test.com', fname: 'Jane',
     passwordHash: 'hash', isActive: true, refreshTokenHash: 'rtoken',
     ...overrides }) as User;

const mockRepo = () => ({
  findOne: jest.fn(),
  save:    jest.fn().mockImplementation((u: User) => Promise.resolve(u)),
});
const mockJwt = () => ({
  signAsync:   jest.fn().mockResolvedValue('signed-reset-token'),
  verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', purpose: 'password-reset' }),
});
const mockConfig = () => ({
  get: jest.fn((key: string) => {
    const map: Record<string, unknown> = {
      'jwt.secret':        'test-secret-at-least-32-chars-ok',
      'jwt.bcryptRounds':  4,
      'app.frontendUrl':   'http://localhost:4000',
    };
    return map[key];
  }),
});
const mockNotifications = () => ({
  queuePasswordReset: jest.fn().mockResolvedValue(undefined),
});

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let userRepo: ReturnType<typeof mockRepo>;
  let jwtService: ReturnType<typeof mockJwt>;
  let notifications: ReturnType<typeof mockNotifications>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: getRepositoryToken(User), useFactory: mockRepo },
        { provide: JwtService,              useFactory: mockJwt },
        { provide: ConfigService,           useFactory: mockConfig },
        { provide: NotificationsService,    useFactory: mockNotifications },
      ],
    }).compile();

    service       = module.get(PasswordResetService);
    userRepo      = module.get(getRepositoryToken(User));
    jwtService    = module.get(JwtService);
    notifications = module.get(NotificationsService);
  });

  // ── requestReset ─────────────────────────────────────────────────
  describe('requestReset()', () => {
    it('signs a JWT and queues a reset email', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      await service.requestReset('jane@test.com');
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: 'u1', purpose: 'password-reset' },
        expect.objectContaining({ expiresIn: '30m' }),
      );
      expect(notifications.queuePasswordReset).toHaveBeenCalledWith(
        'jane@test.com', 'Jane',
        expect.stringContaining('signed-reset-token'),
      );
    });

    it('silently no-ops for unknown email (prevents enumeration)', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.requestReset('nobody@test.com')).resolves.not.toThrow();
      expect(notifications.queuePasswordReset).not.toHaveBeenCalled();
    });

    it('silently no-ops for inactive user', async () => {
      userRepo.findOne.mockResolvedValue(null); // query includes isActive:true so returns null
      await expect(service.requestReset('jane@test.com')).resolves.not.toThrow();
      expect(notifications.queuePasswordReset).not.toHaveBeenCalled();
    });

    it('includes frontend URL in the reset link', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      await service.requestReset('jane@test.com');
      const callArgs = (notifications.queuePasswordReset as jest.Mock).mock.calls[0];
      expect(callArgs[2]).toContain('http://localhost:4000/reset-password');
    });
  });

  // ── resetPassword ─────────────────────────────────────────────────
  describe('resetPassword()', () => {
    it('hashes the new password and saves it', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      await service.resetPassword({ token: 'valid-token', newPassword: 'NewPassword1!' });
      const saved = (userRepo.save as jest.Mock).mock.calls[0][0] as { passwordHash: string };
      expect(saved.passwordHash).toBeDefined();
      expect(saved.passwordHash).not.toBe('NewPassword1!');
      const valid = await bcrypt.compare('NewPassword1!', saved.passwordHash);
      expect(valid).toBe(true);
    });

    it('clears refreshTokenHash to invalidate all sessions', async () => {
      userRepo.findOne.mockResolvedValue(makeUser());
      await service.resetPassword({ token: 'valid-token', newPassword: 'NewPassword1!' });
      const saved = (userRepo.save as jest.Mock).mock.calls[0][0] as { refreshTokenHash: null };
      expect(saved.refreshTokenHash).toBeNull();
    });

    it('throws BadRequestException for expired token', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
      await expect(service.resetPassword({ token: 'expired', newPassword: 'pass' }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for wrong token purpose', async () => {
      jwtService.verifyAsync.mockResolvedValue({ sub: 'u1', purpose: 'access' });
      await expect(service.resetPassword({ token: 'wrong', newPassword: 'pass' }))
        .rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when user no longer exists', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.resetPassword({ token: 'valid', newPassword: 'pass' }))
        .rejects.toThrow(NotFoundException);
    });
  });
});
