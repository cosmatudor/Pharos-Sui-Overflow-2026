-include .env
export

.PHONY: run build up down

run:
	go run ./cmd/

build:
	go build -o bin/keeper ./cmd/

up:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

down:
	docker compose down