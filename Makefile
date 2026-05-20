-include .env
export

.PHONY: run build up down

run:
	go run ./cmd/

build:
	go build -o bin/keeper ./cmd/

up:
	docker compose up -d

down:
	docker compose down