.PHONY: web build test run vet

web:
	cd web && npm ci && npm run build

build:
	go build -o bin/mhj2 ./cmd/mhj2

test:
	go test ./...

vet:
	go vet ./...

run:
	go run ./cmd/mhj2
