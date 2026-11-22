# Backend Template

NestJS backend project template. HTTP kernel is **Fastify** (`@nestjs/platform-fastify`), not Express — use Fastify plugins and types (`NestFastifyApplication`, `app.register(...)`) in `src/main.ts`. Compression (`@fastify/compress`) and cookies (`@fastify/cookie`) are already registered.

## Scripts

```bash
npm run start:dev    # Development with hot reload
npm run start:prod   # Production
npm run build        # Build
npm run lint         # Lint & fix
npm run test         # Unit tests
npm run test:e2e     # E2E tests
```

## Project Structure

```
src/
├── core/
│   ├── config/      # App configuration (env variables)
│   ├── database/    # TypeORM + PostgreSQL connection
│   ├── health/      # Health check endpoints
│   ├── mail/        # SMTP mail sending (nodemailer)
│   ├── clock/       # Injectable clock
│   ├── throttler/   # Named rate limiters (default, registration)
│   └── app/         # Root module
├── database/        # TypeORM CLI data-source and migrations
├── modules/         # Feature modules (auth, users)
└── main.ts          # Entry point
```

## API

Guest registration (no session; registration never issues tokens):

| Method | Path | Result |
|--------|------|--------|
| `POST` | `/auth/register` | `201` active account (verification off) or `202` pending account + verification email (verification on). Rate-limited per client IP |
| `POST` | `/auth/register/confirm` | `200` account activated; body is `attemptId` + `code`, or `token` from the emailed link |
| `POST` | `/auth/register/resend` | `202` new verification email for a pending account (at most once per 60 s) |

With `NODE_ENV=development` the OpenAPI UI is served at `/docs` (JSON at `/docs-json`); it is not served in other environments.

## Configuration

Keys are validated on startup; see `.env.example` for a working set. Registration and mail keys (defaults and meaning in [src/core/config/README.MD](src/core/config/README.MD#registration-and-mail-options)):

- `REGISTRATION_VERIFICATION_ENABLED`, `REGISTRATION_VERIFICATION_METHOD`, `REGISTRATION_SECRET_KEY`, `REGISTRATION_MAGIC_LINK_BASE_URL`, `REGISTRATION_THROTTLE_TTL`, `REGISTRATION_THROTTLE_LIMIT`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`

`REGISTRATION_SECRET_KEY`, `SMTP_HOST`, `SMTP_PORT` and `MAIL_FROM` have no default and are required even when verification is off.

## Docker

The backend, Postgres, Mailpit and pgAdmin run on one bridge network (`mnt-network`); the backend reaches the database at host `postgres`, port `5432` (`POSTGRES_HOST` and `POSTGRES_PORT` are overridden in `docker-compose.yml`; everything else comes from `.env`). Postgres data lives in the `postgres_data` volume.

```bash
make run       # docker compose --env-file .env up -d --build: all base services, production image
make run-dev   # adds docker-compose.dev.yml and reads .env.development.local: hot reload, ./src bind-mounted, NODE_ENV=development
```

The dev override replaces `.env` with `.env.development.local` for both the backend and Postgres; `make start|stop|down` and `make start-dev|stop-dev|down-dev` manage each stack.

Migrations are not run by the image. For local dev you can set `POSTGRES_MIGRATIONS_RUN=true` in the env file; otherwise apply them with the `migration:run` npm script from the host against the published Postgres port (the CLI needs ts-node and `src/`, so it cannot run inside the runtime image). The dev override mounts only `./src`; after changing dependencies, rebuild with `--build`.

### Mail (Mailpit)

Verification emails go to Mailpit, a local SMTP catcher: SMTP on port 1025, web UI on http://localhost:8025. It is part of both stacks; to run it alone for a host-side `npm run start:dev`:

```bash
docker compose up -d mailpit
```

Use `SMTP_HOST=localhost` when the backend runs on the host and `SMTP_HOST=mailpit` when it runs in compose; `SMTP_PORT=1025` in both cases.

### pgAdmin

http://localhost:5050 (bound to 127.0.0.1, no login). The `postgres` server and its password are generated from the `POSTGRES_*` values on the first start of an empty `pgadmin_data` volume only; after changing database credentials the volume must be recreated.

### Confirm a magic link locally

The development stack (`make run-dev`, which uses `.env.development.local`) also starts `confirm-page`, a small nginx container that stands in for the frontend: http://localhost:4200/register/confirm. It is development-only and is not part of `make run` or the backend image.

1. In `.env.development.local` set `REGISTRATION_VERIFICATION_ENABLED=true`, `REGISTRATION_VERIFICATION_METHOD=magic_link` and `SMTP_HOST=mailpit`; leave `REGISTRATION_MAGIC_LINK_BASE_URL` at its default (it points at this page).
2. `make run-dev`, then register through `POST /auth/register`.
3. Open Mailpit (http://localhost:8025) and click the link in the email: the page confirms the account once and shows the result.

Port 4200 must be free (stop any other dev server using it).

## Database

PostgreSQL and TypeORM are already wired in. Use them for new modules — no extra setup.

- **Local Postgres only:** `docker compose up -d postgres` (image and credentials from `.env` / `.env.example`)
- **Connection:** `DatabaseModule` (`src/core/database`) is imported in `AppModule`
- **Entities:** any `*.entity.ts` under `src/` is auto-loaded
- **Repositories:** `TypeOrmModule.forFeature([YourEntity])` in a feature module, then `@InjectRepository(YourEntity)`
- **Transactions:** `@Transactional()` from `typeorm-transactional` (context is initialized in `main.ts`)
- **Schema:** migrations in `src/database/migrations/`. `POSTGRES_SYNCHRONIZE` is `false` by default — do not rely on auto-sync

```bash
npm run migration:generate   # Generate from entity changes
npm run migration:run        # Apply pending migrations
npm run migration:revert     # Roll back the last migration
npm run migration:show       # List applied / pending
```

CLI uses `src/database/data-source.ts`. At runtime, Nest uses the DataSource from `DatabaseModule`. If `POSTGRES_MIGRATIONS_RUN=true`, pending migrations also run on app start.

## Libraries

| Purpose       | Library                  |
|---------------|--------------------------|
| HTTP          | Fastify (`@nestjs/platform-fastify`) |
| Validation    | Joi                      |
| ORM           | TypeORM (`@nestjs/typeorm`) |
| Database      | PostgreSQL (`pg`)        |
| Password hashing | argon2 (`argon2id`)   |
| Mail          | nodemailer               |
| API docs      | `@nestjs/swagger` (development only) |
| Rate limiting | `@nestjs/throttler`      |

## Core Modules

| Purpose       | Module           |
|---------------|-----------------|
| Configuration | `ConfigModule`  |
| Database      | `DatabaseModule` |
| Health Check  | `HealthModule`  |
| Mail          | `MailModule`    |
| Clock         | `ClockModule`   |
| Rate limiting | `ThrottlerModule` |

## Adding a Module

```bash
nest generate module <name>
nest generate controller <name>
nest generate service <name>
```

## Code Style

- Use `@` aliases for imports (e.g., `@config/config.service`)
- Run `npm run format` before committing
- Follow NestJS module pattern
