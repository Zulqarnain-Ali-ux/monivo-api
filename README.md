# MONIVO API

NestJS + TypeScript REST API for MONIVO — a daily spending intelligence application.

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 11 + TypeScript |
| Database | PostgreSQL 16 via TypeORM |
| Cache / Queues | Redis 7 + Bull |
| Auth | JWT (httpOnly cookies) + bcrypt |
| Bank sync | Plaid Transactions API |
| Email | AWS SES via Bull queue |
| Encryption | AWS KMS (Plaid access tokens) |
| Observability | OpenTelemetry (traces + metrics) |
| Infrastructure | AWS ECS Fargate + Terraform |

## Quick start (local)

```bash
# 1. Clone and install
git clone https://github.com/your-org/monivo-api
cd monivo-api && npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set DB_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET

# 3. Start the stack (API + Postgres + Redis)
docker-compose up

# 4. (Optional) Seed the demo account
npm run seed:demo

# Swagger UI available at:
# http://localhost:3000/api/v1/docs
```

## Project structure

```
src/
├── config/                  # All env config namespaces + Joi validation schema
├── common/
│   ├── decorators/          # @Public(), @CurrentUser()
│   ├── filters/             # Global exception filter
│   ├── guards/              # JwtAuthGuard (applied globally)
│   ├── interceptors/        # Response transform { data, meta }
│   └── middleware/          # RequestIdMiddleware (X-Request-Id header)
├── database/
│   ├── migrations/          # TypeORM migration files
│   └── seeds/               # Demo account seed script
├── modules/
│   ├── auth/                # signup, signin, refresh, signout, /me
│   ├── users/               # User entity
│   ├── entries/             # Spending log CRUD
│   ├── budget/              # Budget category management + autopilot
│   ├── income/              # Income configuration
│   ├── streak/              # Daily logging streak
│   ├── goals/               # Life savings goals
│   ├── reports/             # SQL aggregation — monthly, daily, benchmarks
│   ├── plaid/               # Bank connection, token exchange, transaction sync
│   ├── notifications/       # SES email via Bull queue
│   └── health/              # /health/live + /health/ready for ECS probes
├── otel.ts                  # OpenTelemetry bootstrap (imported first in main.ts)
├── app.module.ts            # Root module
└── main.ts                  # Bootstrap
```

## API endpoints

All routes are prefixed with `/api/v1`. All routes except those marked `@Public()` require a valid access token cookie.

```
POST   /auth/signup              Create account
POST   /auth/signin              Sign in
POST   /auth/refresh             Rotate tokens (uses refresh cookie)
POST   /auth/signout             Invalidate session
GET    /auth/me                  Current user

GET    /income                   Get income config
PUT    /income                   Update income

GET    /budget                   All budget categories
PATCH  /budget/categories/:catId Update a category
PATCH  /budget/categories        Bulk update
POST   /budget/categories        Add custom category
DELETE /budget/categories/:id    Delete custom category
POST   /budget/autopilot         Apply aggressive/balanced/free mode

GET    /entries?from=&to=        All entries (filterable)
GET    /entries/today            Today's entries
POST   /entries                  Log a new entry
DELETE /entries/:id              Delete an entry

GET    /streak                   Current streak

GET    /goals                    All goals
POST   /goals                    Create goal
PATCH  /goals/:id                Update saved amount
DELETE /goals/:id                Delete goal

GET    /reports/summary          Current month breakdown
GET    /reports/monthly?months=6 Last N months totals
GET    /reports/daily?from=&to=  Daily totals for range
GET    /reports/benchmarks       Your spend vs peer averages

POST   /plaid/link-token         Create Plaid Link token
POST   /plaid/exchange-token     Exchange public token
POST   /plaid/sync/:itemId       Manual transaction sync
GET    /plaid/items              Connected banks
DELETE /plaid/items/:id          Disconnect bank

POST   /plaid/webhook            Plaid webhook (public)

GET    /health/live              ECS liveness probe
GET    /health/ready             ECS readiness probe (checks DB + Redis)
```

## Database migrations

```bash
# Run all pending migrations
npm run migration:run

# Revert last migration
npm run migration:revert

# Generate migration from entity changes
npm run migration:generate -- src/database/migrations/MyMigrationName
```

## Testing

```bash
# Unit tests (no DB required)
npm test

# All tests with coverage
npm run test:cov

# Watch mode
npm run test:watch
```

## Deployment to AWS ECS

```bash
# 1. Provision infrastructure (first time only)
cd infra
terraform init
terraform apply \
  -var="db_password=STRONG_PASSWORD" \
  -var="jwt_secret=32_CHAR_SECRET" \
  -var="jwt_refresh_secret=32_CHAR_REFRESH_SECRET" \
  -var="plaid_client_id=YOUR_PLAID_ID" \
  -var="plaid_secret=YOUR_PLAID_SECRET"

# 2. Build and push Docker image
ECR_URL=$(terraform output -raw ecr_url)
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URL
docker build -t $ECR_URL:latest .
docker push $ECR_URL:latest

# 3. Deploy (CI/CD does this automatically on push to main)
aws ecs update-service \
  --cluster monivo-production-cluster \
  --service monivo-production-api \
  --force-new-deployment
```

## Environment variables

See `.env.example` for all available configuration. Required at minimum:

- `DB_PASSWORD` — PostgreSQL password
- `JWT_SECRET` — min 32 chars, for access tokens
- `JWT_REFRESH_SECRET` — min 32 chars, for refresh tokens

Optional for core functionality (no-ops gracefully in dev):
- `AWS_KMS_KEY_ID` — encrypts Plaid access tokens. Without this, base64-only (dev only)
- `PLAID_CLIENT_ID` + `PLAID_SECRET` — bank sync
- SES domain verification for email delivery

## Architecture decisions

**httpOnly cookies over localStorage** — access tokens cannot be read by JavaScript, protecting against XSS. The 15-minute access token + 30-day refresh token pattern gives security without forcing frequent logins.

**KMS-encrypted Plaid tokens** — Plaid access tokens are encrypted with AWS KMS before storage. Even if the database is compromised, access tokens cannot be used without the KMS key.

**Bull queue for email** — SES sends are queued and retried on failure. The API never blocks on email delivery. Weekly report jobs are dispatched by a separate scheduler (to be added).

**Server-side report aggregation** — all monthly totals, category breakdowns, and benchmark comparisons run as parameterised SQL queries. This keeps the frontend simple and fast regardless of how many years of data a user accumulates.

**Incremental Plaid sync via cursor** — each sync picks up exactly where the last one left off. Plaid webhooks trigger syncs automatically when new transactions arrive.
