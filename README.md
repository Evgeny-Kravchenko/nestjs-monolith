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
│   └── app/         # Root module
├── database/        # TypeORM CLI data-source and migrations
├── modules/         # Feature modules
└── main.ts          # Entry point
```

## Docker

The backend and Postgres run on one bridge network (`mnt-network`); the backend reaches the database at host `postgres`, port `5432` (`POSTGRES_HOST` and `POSTGRES_PORT` are overridden in `docker-compose.yml`; everything else comes from `.env`). Postgres data lives in the `postgres_data` volume.

```bash
docker compose up -d --build                                              # backend + Postgres, production image
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build # hot reload: ./src is bind-mounted
```

Migrations are not run by the image. For local dev you can set `POSTGRES_MIGRATIONS_RUN=true` in `.env`; otherwise apply them with the `migration:run` npm script from the host against the published Postgres port (the CLI needs ts-node and `src/`, so it cannot run inside the runtime image). The dev override mounts only `./src`; after changing dependencies, rebuild with `--build`.

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

## Core Modules

| Purpose       | Module           |
|---------------|-----------------|
| Configuration | `ConfigModule`  |
| Database      | `DatabaseModule` |
| Health Check  | `HealthModule`  |

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
