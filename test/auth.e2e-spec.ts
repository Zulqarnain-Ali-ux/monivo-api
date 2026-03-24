import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuthModule } from '../../src/modules/auth/auth.module';
import { User }   from '../../src/modules/users/user.entity';
import { Income } from '../../src/modules/income/income.entity';
import { Streak } from '../../src/modules/streak/streak.entity';
import { BudgetCategory } from '../../src/modules/budget/budget-category.entity';
import {
  appConfig, dbConfig, jwtConfig, redisConfig,
  awsConfig, plaidConfig, notificationsConfig, throttleConfig, otelConfig,
} from '../../src/config';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let userRepo: Repository<User>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [appConfig, dbConfig, jwtConfig, redisConfig, awsConfig,
                 plaidConfig, notificationsConfig, throttleConfig, otelConfig],
        }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST ?? 'localhost',
          port: parseInt(process.env.DB_PORT ?? '5432', 10),
          database: process.env.DB_NAME ?? 'monivo_test',
          username: process.env.DB_USER ?? 'monivo',
          password: process.env.DB_PASSWORD ?? 'test',
          entities: [User, Income, Streak, BudgetCategory],
          synchronize: true,
          dropSchema: true, // fresh schema per test run
        }),
        AuthModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    userRepo = moduleFixture.get(getRepositoryToken(User));
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await userRepo.delete({});
  });

  // ── Sign Up ──────────────────────────────────────────────────────
  describe('POST /auth/signup', () => {
    it('creates account and returns user', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ fname: 'Jane', lname: 'Doe', email: 'jane@test.com', password: 'password123', income: 5000 })
        .expect(201);

      expect(res.body.data.user).toMatchObject({
        fname: 'Jane', email: 'jane@test.com',
      });
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('rejects duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ fname: 'Jane', email: 'jane@test.com', password: 'password123' });
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ fname: 'Jane', email: 'jane@test.com', password: 'password123' })
        .expect(409);
    });

    it('rejects short password', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ fname: 'Jane', email: 'jane@test.com', password: 'short' })
        .expect(400);
    });

    it('rejects invalid email', async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ fname: 'Jane', email: 'notanemail', password: 'password123' })
        .expect(400);
    });
  });

  // ── Sign In ──────────────────────────────────────────────────────
  describe('POST /auth/signin', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ fname: 'Jane', email: 'jane@test.com', password: 'password123' });
    });

    it('signs in with correct credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email: 'jane@test.com', password: 'password123' })
        .expect(200);

      expect(res.body.data.user.email).toBe('jane@test.com');
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('rejects wrong password', async () => {
      await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email: 'jane@test.com', password: 'wrongpassword' })
        .expect(401);
    });

    it('rejects unknown email', async () => {
      await request(app.getHttpServer())
        .post('/auth/signin')
        .send({ email: 'nobody@test.com', password: 'password123' })
        .expect(401);
    });
  });

  // ── Auth/me ──────────────────────────────────────────────────────
  describe('GET /auth/me', () => {
    it('returns user for valid cookie', async () => {
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ fname: 'Jane', email: 'jane@test.com', password: 'password123' });

      const cookie = signup.headers['set-cookie'] as string[];
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.email).toBe('jane@test.com');
    });

    it('returns 401 without cookie', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });
  });

  // ── Sign Out ─────────────────────────────────────────────────────
  describe('POST /auth/signout', () => {
    it('clears cookies on signout', async () => {
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({ fname: 'Jane', email: 'jane@test.com', password: 'password123' });

      const cookie = signup.headers['set-cookie'] as string[];
      const res = await request(app.getHttpServer())
        .post('/auth/signout')
        .set('Cookie', cookie)
        .expect(204);

      const setCookies = res.headers['set-cookie'] as string[];
      expect(setCookies.some((c: string) => c.includes('access_token=;'))).toBe(true);
    });
  });
});
