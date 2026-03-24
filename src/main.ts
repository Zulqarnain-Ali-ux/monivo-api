// OTel MUST be the very first import
import './otel';

import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const cfg         = app.get(ConfigService);
  const isDev       = cfg.get<boolean>('app.isDev') ?? true;
  const prefix      = cfg.get<string>('app.apiPrefix') ?? 'api/v1';
  const frontendUrl = cfg.get<string>('app.frontendUrl') ?? 'http://localhost:3000';
  const port        = cfg.get<number>('app.port') ?? 3000;

  // ── Security ──────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: isDev
      ? false
      : {
          directives: {
            defaultSrc:  ["'self'"],
            scriptSrc:   ["'self'", "'unsafe-inline'", 'cdn.plaid.com'],
            styleSrc:    ["'self'", "'unsafe-inline'"],
            imgSrc:      ["'self'", 'data:'],
            connectSrc:  ["'self'", 'https://api.anthropic.com'],
            fontSrc:     ["'self'"],
            objectSrc:   ["'none'"],
            upgradeInsecureRequests: [],
          },
        },
    frameguard: isDev ? false : { action: 'deny' },
  }));

  // ── CORS ──────────────────────────────────────────────────────
  app.enableCors({
    origin: [frontendUrl, 'http://localhost:3000', 'http://localhost:4000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  });

  // ── Cookies ───────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  app.use(require('cookie-parser')());

  // ── Request logging ───────────────────────────────────────────
  if (isDev) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    app.use(require('morgan')(':method :url :status :response-time ms'));
  }

  // ── Global prefix — excludes health probes and static files ───
  app.setGlobalPrefix(prefix, {
    exclude: ['health/live', 'health/ready'],
  });

  // ── Validation ────────────────────────────────────────────────
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // ── Serialisation ─────────────────────────────────────────────
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // ── Swagger (dev only) ────────────────────────────────────────
  if (isDev) {
    const doc = new DocumentBuilder()
      .setTitle('MONIVO API')
      .setDescription('Daily spending intelligence — REST API')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('access_token')
      .build();
    SwaggerModule.setup(`${prefix}/docs`, app, SwaggerModule.createDocument(app, doc), {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // ── Listen ────────────────────────────────────────────────────
  // Bind to 0.0.0.0 so Docker port mapping works
  await app.listen(port, '0.0.0.0');
  logger.log(`MONIVO running at http://localhost:${port}  [${isDev ? 'dev' : 'prod'}]`);
  if (isDev) logger.log(`Swagger:  http://localhost:${port}/${prefix}/docs`);
}

// Start — TypeORM connection errors are logged but don't exit the process.
// Inside Docker, Postgres is healthy before the API starts (see docker-compose.yml).
// TypeORM will retry in the background if the connection drops mid-run.
bootstrap().catch((err: Error) => {
  console.error('[MONIVO] Bootstrap error:', err.message);
  process.exit(1);
});
