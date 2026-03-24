import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService }          from './auth.service';
import { AuthController }       from './auth.controller';
import { JwtStrategy }          from './jwt.strategy';
import { JwtRefreshStrategy }   from './jwt-refresh.strategy';
import { PasswordResetService } from './password-reset.service';
import { User }           from '../users/user.entity';
import { Income }         from '../income/income.entity';
import { Streak }         from '../streak/streak.entity';
import { BudgetCategory } from '../budget/budget-category.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Income, Streak, BudgetCategory]),
    PassportModule,
    JwtModule.register({}),
    NotificationsModule,          // needed by PasswordResetService
  ],
  providers: [AuthService, JwtStrategy, JwtRefreshStrategy, PasswordResetService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
