/**
 * Smoke e2e tests — verifies the app boots and core routing works.
 * Full integration tests require a live DB; these run without one
 * by testing only public endpoints and bootstrap behaviour.
 *
 * Run with a real DB via:
 *   DB_SYNC=true npx jest --config ./test/jest-e2e.json
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  appConfig, jwtConfig, throttleConfig,
} from '../src/config';

// Lightweight app without DB — tests routing and middleware only
import { AuthModule }   from '../src/modules/auth/auth.module';
import { HealthModule } from '../src/modules/health/health.module';

describe('App bootstrap smoke tests', () => {
  let app: INestApplication;

  // Use a minimal module setup to avoid needing a real DB
  // Full e2e tests that need DB are in auth.e2e-spec.ts
  beforeAll(async () => {
    // We test only health endpoints here — they need no DB
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [appConfig, jwtConfig, throttleConfig],
          // Bypass env validation for smoke tests
          validationSchema: undefined,
        }),
        ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] }),
      ],
      controllers: [],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('server starts without errors', () => {
    expect(app).toBeDefined();
  });

  it('unknown routes return 404', async () => {
    return request(app.getHttpServer())
      .get('/nonexistent')
      .expect(404);
  });

  it('protected routes return 401 without a token', async () => {
    return request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401);
  });

  it('validation rejects malformed signup body', async () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ email: 'notanemail', password: 'short' })  // invalid email + too short
      .expect(400);
  });

  it('forgot-password returns 200 even for unknown email', async () => {
    // Always 200 — prevents enumeration
    return request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@test.com' })
      .expect(200);
  });
});
