# MONIVO — Quick Start

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — that's it.

---

## One command

```bash
docker-compose up
```

That's it. Docker will:

1. Start PostgreSQL and Redis
2. Wait until both are healthy
3. Start the NestJS API (TypeScript hot-reload enabled)
4. Compile the database schema automatically
5. Run the demo seed to create **demo@monivo.ai** with 6 months of realistic spending data

**Open http://localhost:3000 when you see:**
```
[Bootstrap] MONIVO running at http://localhost:3000  [dev]
```
This takes about 30–45 seconds on first run (NestJS compiles TypeScript).

---

## Sign in

| Method | Details |
|--------|---------|
| **Demo account** | Click **Try demo** — loads Alex Chen with 6 months of entries |
| **New account** | Click **Get started free** — creates a real account in the DB |
| **Direct sign-in** | Email: `demo@monivo.ai` / Password: `demo-password` |

---

## What's running

| Service | URL | Credentials |
|---------|-----|-------------|
| **App** | http://localhost:3000 | — |
| **Swagger API docs** | http://localhost:3000/api/v1/docs | — |
| **PostgreSQL** | localhost:5432 | `monivo` / `monivo_dev` |
| **Redis** | localhost:6379 | no password |

---

## Useful commands

```bash
# Start in background
docker-compose up -d

# Follow API logs only
docker-compose logs -f api

# Stop everything (keeps data)
docker-compose down

# Stop and delete all data (fresh start)
docker-compose down -v

# Rebuild after changing Dockerfile or package.json
docker-compose up --build

# Run just the seed again (if you deleted the demo account)
docker-compose run --rm seed
```

---

## Enabling bank sync (optional)

Get free sandbox credentials at https://dashboard.plaid.com, then add to `docker-compose.yml`:

```yaml
PLAID_CLIENT_ID: your-plaid-client-id
PLAID_SECRET:    your-plaid-sandbox-secret
```

---

## Before going to production

| Item | Action |
|------|--------|
| **JWT secrets** | Replace `dev-jwt-secret-...` with 64-char random strings |
| **DB password** | Replace `monivo_dev` with a strong password |
| **`DB_SYNC`** | Set to `false` and run migrations: `npm run migration:run` |
| **AWS KMS** | Set `AWS_KMS_KEY_ID` to encrypt Plaid access tokens |
| **AWS SES** | Verify your domain and set credentials for email delivery |
| **HTTPS** | Set `FRONTEND_URL` to your real domain, configure SSL |
| **`OTEL_ENABLED`** | Set to `true` and configure `OTEL_EXPORTER_OTLP_ENDPOINT` |

---

## Troubleshooting

**Port 3000 already in use:**
```bash
lsof -i :3000   # find what's using it
# or change the port in docker-compose.yml: '3001:3000'
```

**Postgres port 5432 already in use (common on Mac):**
```bash
# Change the exposed port in docker-compose.yml:
ports:
  - '5433:5432'   # access via localhost:5433
```

**App crashes immediately:**
```bash
docker-compose logs api   # see the full error
```

**Want a completely clean slate:**
```bash
docker-compose down -v && docker-compose up
```
