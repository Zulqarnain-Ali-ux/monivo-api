import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import {
  appConfig, dbConfig, redisConfig, jwtConfig,
  awsConfig, plaidConfig, notificationsConfig,
  throttleConfig, otelConfig,
} from './config';
import { envValidationSchema } from './config/env.validation';

import { JwtAuthGuard }         from './common/guards/jwt-auth.guard';
import { AllExceptionsFilter }   from './common/filters/http-exception.filter';
import { TransformInterceptor }  from './common/interceptors/transform.interceptor';
import { RequestIdMiddleware }   from './common/middleware/request-id.middleware';

import { AuthModule }          from './modules/auth/auth.module';
import { UsersModule }         from './modules/users/users.module';
import { EntriesModule }       from './modules/entries/entries.module';
import { BudgetModule }        from './modules/budget/budget.module';
import { IncomeModule }        from './modules/income/income.module';
import { StreakModule }        from './modules/streak/streak.module';
import { GoalsModule }         from './modules/goals/goals.module';
import { ReportsModule }       from './modules/reports/reports.module';
import { PlaidModule }         from './modules/plaid/plaid.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SchedulerModule }     from './modules/scheduler/scheduler.module';
import { HealthModule }        from './modules/health/health.module';

import { User }           from './modules/users/user.entity';
import { Entry }          from './modules/entries/entry.entity';
import { BudgetCategory } from './modules/budget/budget-category.entity';
import { Income }         from './modules/income/income.entity';
import { Streak }         from './modules/streak/streak.entity';
import { Goal }           from './modules/goals/goal.entity';
import { PlaidItem }      from './modules/plaid/plaid-item.entity';

@Module({
  imports: [
    // ── Config ─────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
      load: [
        appConfig, dbConfig, redisConfig, jwtConfig,
        awsConfig, plaidConfig, notificationsConfig,
        throttleConfig, otelConfig,
      ],
    }),

    // ── Static file serving — serves public/ at root / ─────────
    // API routes under /api/v1 take priority; this is the fallback
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/(.*)'],          // never intercept API routes
      serveStaticOptions: {
        index: 'index.html',
        fallthrough: true,
      },
    }),

    // ── Database ────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host:     cfg.get('database.host'),
        port:     cfg.get('database.port'),
        database: cfg.get('database.name'),
        username: cfg.get('database.user'),
        password: cfg.get('database.password'),
        ssl:      cfg.get('database.ssl') ? { rejectUnauthorized: false } : false,
        entities: [User, Entry, BudgetCategory, Income, Streak, Goal, PlaidItem],
        synchronize: cfg.get('database.synchronize'),
        logging:  cfg.get('app.isDev') ? ['error'] : ['error'],
        connectTimeoutMS: 5000,   // 5s per connection attempt
        retryAttempts: 5,          // retry up to 5x (10s window)
        retryDelay: 2000,          // 2s between retries
        migrations: ['dist/database/migrations/*.js'],
        migrationsRun: false,
      }),
    }),

    // ── Rate limiting ───────────────────────────────────────────
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        throttlers: [{
          ttl:   (cfg.get<number>('throttle.ttl') ?? 60) * 1000,
          limit: cfg.get('throttle.limit') ?? 100,
        }],
      }),
    }),

    // ── Bull / Redis ────────────────────────────────────────────
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        redis: {
          host:             cfg.get('redis.host'),
          port:             cfg.get('redis.port'),
          password:         cfg.get('redis.password') || undefined,
          // Prevents Bull from crashing the process on Redis connection errors
          // The app starts and retries the connection in the background
          maxRetriesPerRequest: null,
          enableReadyCheck:     false,
          retryStrategy: (times: number) => Math.min(times * 200, 5000),
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      }),
    }),

    // ── Cron scheduler — registered once here only ──────────────
    ScheduleModule.forRoot(),

    // ── Feature modules ─────────────────────────────────────────
    AuthModule,
    UsersModule,
    EntriesModule,
    BudgetModule,
    IncomeModule,
    StreakModule,
    GoalsModule,
    ReportsModule,
    PlaidModule,
    NotificationsModule,
    SchedulerModule,
    HealthModule,
  ],

  providers: [
    { provide: APP_GUARD,       useClass: JwtAuthGuard },
    { provide: APP_FILTER,      useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
