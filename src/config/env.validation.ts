import * as Joi from '@hapi/joi';

/**
 * Validated at startup — the app refuses to boot if any required
 * env var is missing or the wrong type. Prevents silent misconfigs.
 */
export const envValidationSchema = Joi.object({
  // App
  NODE_ENV:     Joi.string().valid('development', 'production', 'test').default('development'),
  PORT:         Joi.number().integer().min(1024).max(65535).default(3000),
  API_PREFIX:   Joi.string().default('api/v1'),
  FRONTEND_URL: Joi.string().uri().default('http://localhost:4000'),

  // Database
  DB_HOST:     Joi.string().default('localhost'),
  DB_PORT:     Joi.number().integer().default(5432),
  DB_NAME:     Joi.string().default('monivo'),
  DB_USER:     Joi.string().default('monivo'),
  DB_PASSWORD: Joi.string().required(),
  DB_SSL:      Joi.boolean().default(false),
  DB_SYNC:     Joi.boolean().default(false),

  // Redis
  REDIS_HOST:     Joi.string().default('localhost'),
  REDIS_PORT:     Joi.number().integer().default(6379),
  REDIS_PASSWORD: Joi.string().optional().allow(''),

  // Auth
  JWT_SECRET:          Joi.string().min(32).required(),
  JWT_EXPIRES_IN:      Joi.string().default('15m'),
  JWT_REFRESH_SECRET:  Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
  BCRYPT_ROUNDS:       Joi.number().integer().min(10).max(14).default(12),

  // AWS (optional in dev, required in prod)
  AWS_REGION:              Joi.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID:       Joi.string().optional().allow(''),
  AWS_SECRET_ACCESS_KEY:   Joi.string().optional().allow(''),
  AWS_KMS_KEY_ID:          Joi.string().optional().allow(''),
  AWS_SECRETS_MANAGER_PREFIX: Joi.string().default('monivo/'),

  // Plaid
  PLAID_CLIENT_ID:  Joi.string().optional().allow(''),
  PLAID_SECRET:     Joi.string().optional().allow(''),
  PLAID_ENV:        Joi.string().valid('sandbox', 'development', 'production').default('sandbox'),
  PLAID_WEBHOOK_URL:Joi.string().uri().optional().allow(''),

  // Notifications
  SES_FROM_EMAIL: Joi.string().email().default('noreply@monivo.ai'),
  SES_REGION:     Joi.string().default('us-east-1'),

  // Rate limiting
  THROTTLE_TTL:   Joi.number().integer().default(60),
  THROTTLE_LIMIT: Joi.number().integer().default(100),

  // OTel
  OTEL_SERVICE_NAME:               Joi.string().default('monivo-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT:     Joi.string().uri().default('http://localhost:4318'),
});
