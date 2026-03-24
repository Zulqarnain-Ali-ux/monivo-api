import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';

// ── DTOs ───────────────────────────────────────────────────────────
export class ForgotPasswordDto {
  @IsEmail()
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}

// ── Service ────────────────────────────────────────────────────────
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly RESET_EXPIRY_MINUTES = 30;

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Issue a signed reset token and email a link to the user.
   * Always responds with 200 regardless of whether the email exists
   * to prevent user enumeration attacks.
   */
  async requestReset(email: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { email, isActive: true } });
    if (!user) {
      // Silent no-op — do not leak that the email is unregistered
      this.logger.debug(`Password reset requested for unknown email: ${email}`);
      return;
    }

    const secret  = this.configService.get<string>('jwt.secret') ?? 'dev';
    const token   = await this.jwtService.signAsync(
      { sub: user.id, purpose: 'password-reset' },
      { secret, expiresIn: `${this.RESET_EXPIRY_MINUTES}m` },
    );

    const frontendUrl = this.configService.get<string>('app.frontendUrl') ?? 'http://localhost:4000';
    const resetUrl    = `${frontendUrl}/reset-password?token=${token}`;

    await this.notificationsService.queuePasswordReset(user.email, user.fname, resetUrl);
    this.logger.log(`Password reset queued for user ${user.id}`);
  }

  /**
   * Verify the reset token and set the new password.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const secret = this.configService.get<string>('jwt.secret') ?? 'dev';

    let payload: { sub: string; purpose: string };
    try {
      payload = await this.jwtService.verifyAsync(dto.token, { secret });
    } catch {
      throw new BadRequestException('Reset link has expired or is invalid');
    }

    if (payload.purpose !== 'password-reset') {
      throw new BadRequestException('Invalid token type');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub, isActive: true } });
    if (!user) throw new NotFoundException('Account not found');

    const rounds = this.configService.get<number>('jwt.bcryptRounds') ?? 12;
    user.passwordHash     = await bcrypt.hash(dto.newPassword, rounds);
    user.refreshTokenHash = null; // invalidate all existing sessions
    await this.userRepo.save(user);

    this.logger.log(`Password reset completed for user ${user.id}`);
  }
}
