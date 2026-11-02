.PHONY: run start stop down run-dev start-dev stop-dev down-dev

# Local env file for the default stack, dev-specific one for the dev override
ENV     = --env-file .env
DEV_ENV = --env-file .env.development.local
DEV     = -f docker-compose.yml -f docker-compose.dev.yml $(DEV_ENV)

# Build images and create + start all containers in the background
run:
	docker compose $(ENV) up -d --build

# Start existing stopped containers
start:
	docker compose $(ENV) start

# Stop containers without removing them
stop:
	docker compose $(ENV) stop

# Stop and remove containers and the network (named volumes are kept)
down:
	docker compose $(ENV) down

# Development (hot reload, ./src bind-mounted, .env.development.local): same commands with the dev override
run-dev:
	docker compose $(DEV) up -d --build

start-dev:
	docker compose $(DEV) start

stop-dev:
	docker compose $(DEV) stop

down-dev:
	docker compose $(DEV) down
