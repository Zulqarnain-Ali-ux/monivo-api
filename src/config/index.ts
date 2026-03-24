import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:4000',
  isDev: (process.env.NODE_ENV ?? 'development') === 'development',
}));

export const dbConfig = registerAs('database', () => ({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  name: process.env.DB_NAME ?? 'monivo',
  user: process.env.DB_USER ?? 'monivo',
  password: process.env.DB_PASSWORD ?? 'changeme',
  ssl: process.env.DB_SSL === 'true',
  synchronize: process.env.DB_SYNC === 'true',
}));

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  password: process.env.REDIS_PASSWORD ?? undefined,
}));

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-change-me',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10),
}));

export const awsConfig = registerAs('aws', () => ({
  region: process.env.AWS_REGION ?? 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  kmsKeyId: process.env.AWS_KMS_KEY_ID,
  secretsPrefix: process.env.AWS_SECRETS_MANAGER_PREFIX ?? 'monivo/',
}));

export const plaidConfig = registerAs('plaid', () => ({
  clientId: process.env.PLAID_CLIENT_ID ?? '',
  secret: process.env.PLAID_SECRET ?? '',
  env: process.env.PLAID_ENV ?? 'sandbox',
  webhookUrl: process.env.PLAID_WEBHOOK_URL ?? '',
}));

export const notificationsConfig = registerAs('notifications', () => ({
  fromEmail: process.env.SES_FROM_EMAIL ?? 'noreply@monivo.ai',
  sesRegion: process.env.SES_REGION ?? 'us-east-1',
}));

export const throttleConfig = registerAs('throttle', () => ({
  ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
  limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
}));

export const otelConfig = registerAs('otel', () => ({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'monivo-api',
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
}));
