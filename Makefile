.PHONY: web build test run vet wasm site deploy

DEPLOY_PROJECT ?= 01M3EY63A2EQPZG0KRRA8H8PHC

web:
	cd web && npm ci && npm run build

build:
	go build -o bin/mhj-dojo ./cmd/mhj-dojo

test:
	go test ./...

vet:
	go vet ./...

run:
	go run ./cmd/mhj-dojo

# The practice engine as WebAssembly for the static site (issue #67), with
# the matching Go's JS glue, into web/site-public/ (not committed).
wasm:
	GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o web/site-public/mhj-dojo.wasm ./cmd/mhj-dojo-wasm
	cp "$$(go env GOROOT)/lib/wasm/wasm_exec.js" web/site-public/wasm_exec.js

# The static site (practice mode only) into web/dist-site/ (not committed).
site: wasm
	cd web && npm ci && npm run build:site

# Deploy the static site to Lolipop Deploy Now. web/dist-site/ and the .wasm
# are gitignored, and the lolipop CLI skips gitignored files when its --dir
# is inside a git repo, so the build is copied to a temp dir outside the
# repo first. Run `npx lolipop login` once beforehand.
deploy: site
	@tmp_dir="$$(mktemp -d)"; \
	trap 'rm -rf "$$tmp_dir"' EXIT; \
	cp -R web/dist-site/. "$$tmp_dir"/; \
	npx -y lolipop deploy --project $(DEPLOY_PROJECT) --dir "$$tmp_dir"
