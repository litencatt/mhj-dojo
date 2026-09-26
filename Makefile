.PHONY: web build test run vet wasm site

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

# The practice engine as WebAssembly for the static site (issue #67), with
# the matching Go's JS glue, into web/site-public/ (not committed).
wasm:
	GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o web/site-public/mhj2.wasm ./cmd/mhj2wasm
	cp "$$(go env GOROOT)/lib/wasm/wasm_exec.js" web/site-public/wasm_exec.js

# The static site (practice mode only) into web/dist-site/ (not committed).
site: wasm
	cd web && npm ci && npm run build:site
