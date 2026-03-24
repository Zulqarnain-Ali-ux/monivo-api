import {
  Injectable, ConflictException, UnauthorizedException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User } from '../users/user.entity';
import { Income } from '../income/income.entity';
import { Streak } from '../streak/streak.entity';
import { BudgetCategory } from '../budget/budget-category.entity';
import { SignUpDto, SignInDto, AuthResponseDto } from './auth.dto';
import { JwtPayload } from './jwt.strategy';
import { defaultBudgetCategories } from '../budget/budget.defaults';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Income) private incomeRepo: Repository<Income>,
    @InjectRepository(Streak) private streakRepo: Repository<Streak>,
    @InjectRepository(BudgetCategory) private budgetRepo: Repository<BudgetCategory>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async signUp(dto: SignUpDto): Promise<AuthResponseDto> {
    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');

    const rounds = this.configService.get<number>('jwt.bcryptRounds') ?? 12;
    const passwordHash = await bcrypt.hash(dto.password, rounds);
    const initials = ((dto.fname[0] ?? '') + (dto.lname?.[0] ?? '')).toUpperCase();

    const user = this.userRepo.create({
      email: dto.email, passwordHash, fname: dto.fname,
      lname: dto.lname ?? null, initials: initials || null,
    });
    await this.userRepo.save(user);

    await Promise.all([
      this.seedIncome(user.id, dto.income ?? 0),
      this.seedStreak(user.id),
      this.seedDefaultBudget(user.id, dto.income ?? 0),
    ]);

    this.logger.log(`New user: ${user.id}`);
    return this.generateTokens(user);
  }

  async signIn(dto: SignInDto): Promise<AuthResponseDto> {
    const user = await this.userRepo.findOne({ where: { email: dto.email, isActive: true } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    return this.generateTokens(user);
  }

  async refreshTokens(userId: string): Promise<AuthResponseDto> {
    const user = await this.userRepo.findOne({ where: { id: userId, isActive: true } });
    if (!user) throw new UnauthorizedException();
    return this.generateTokens(user);
  }

  async validateRefreshToken(userId: string, refreshToken: string): Promise<User | null> {
    const user = await this.userRepo.findOne({ where: { id: userId, isActive: true } });
    if (!user?.refreshTokenHash) return null;
    const valid = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    return valid ? user : null;
  }

  async signOut(userId: string): Promise<void> {
    await this.userRepo.update(userId, { refreshTokenHash: null });
  }

  private async generateTokens(user: User): Promise<AuthResponseDto> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const secret        = this.configService.get<string>('jwt.secret') ?? 'dev';
    const refreshSecret = this.configService.get<string>('jwt.refreshSecret') ?? 'dev-refresh';
    const expiresIn        = this.configService.get<string>('jwt.expiresIn') ?? '15m';
    const refreshExpiresIn = this.configService.get<string>('jwt.refreshExpiresIn') ?? '30d';

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, { secret, expiresIn: expiresIn as unknown as import("ms").StringValue }),
      this.jwtService.signAsync(payload, { secret: refreshSecret, expiresIn: refreshExpiresIn as unknown as import("ms").StringValue }),
    ]);

    const rounds = this.configService.get<number>('jwt.bcryptRounds') ?? 12;
    await this.userRepo.update(user.id, {
      refreshTokenHash: await bcrypt.hash(refreshToken, rounds),
    });

    return {
      accessToken, refreshToken,
      user: { id: user.id, email: user.email, fname: user.fname, lname: user.lname, initials: user.initials },
    };
  }

  private async seedIncome(userId: string, salary: number): Promise<void> {
    await this.incomeRepo.save(this.incomeRepo.create({
      userId, salary, side: 0, passive: 0,
      savingsGoal: Math.round(salary * 0.1),
      investGoal:  Math.round(salary * 0.05),
    }));
  }

  private async seedStreak(userId: string): Promise<void> {
    await this.streakRepo.save(
      this.streakRepo.create({ userId, days: 0, lastLog: null, graceUsed: false }),
    );
  }

  private async seedDefaultBudget(userId: string, income: number): Promise<void> {
    const cats = defaultBudgetCategories(income).map((c, i) =>
      this.budgetRepo.create({ ...c, userId, sortOrder: i }),
    );
    await this.budgetRepo.save(cats);
  }
}
