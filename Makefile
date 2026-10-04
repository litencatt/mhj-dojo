.PHONY: build test run vet wasm site embed e2e deploy deploy-check

# npm ci wipes node_modules, so it only runs when the lockfile changes (npm
# writes node_modules/.package-lock.json on every install).
web/node_modules/.package-lock.json: web/package.json web/package-lock.json
	cd web && npm ci

build: embed
	go build -o bin/mhj-dojo ./cmd/mhj-dojo

test:
	go test ./...

vet:
	go vet ./...

run: embed
	go run ./cmd/mhj-dojo

# The engine (practice and CPU games) as WebAssembly for the static site
# (issue #67), with the matching Go's JS glue, into web/site-public/ (not
# committed).
#
# GOEXPERIMENT=nojsonv2 drops the encoding/json v2 machinery (default on
# since Go 1.25) that our own JSON code never uses: apicall only calls the
# v1 encoding/json API, so the v2 decoder/encoder tables it pulls in are
# dead weight here, worth ~22% of the wasm's raw size (measured on go1.27).
# It only applies here, not to `build`'s native binary: the JSON bytes are
# unaffected (checked field-by-field across builds), but a future Go release
# could remove this experiment once encoding/json fully migrates to v2, so
# re-check `go env GOEXPERIMENT` (or this GOROOT's internal/goexperiment)
# after a Go upgrade breaks this build.
wasm:
	GOOS=js GOARCH=wasm GOEXPERIMENT=nojsonv2 go build -trimpath -ldflags="-s -w" -o web/site-public/mhj-dojo.wasm ./cmd/mhj-dojo-wasm
	cp "$$(go env GOROOT)/lib/wasm/wasm_exec.js" web/site-public/wasm_exec.js

# The static site into web/dist-site/ (not committed).
site: wasm web/node_modules/.package-lock.json
	cd web && npm run build:site

# The static site as the frontend mhj-dojo serves, in
# internal/server/static/dist/ (not committed): the server embeds it, and a
# Go build without it serves a page saying to run `make build`. A plain go
# build or go run embeds whatever this last copied.
embed: site
	rm -rf internal/server/static/dist
	cp -R web/dist-site internal/server/static/dist

# The site's E2E tests against a built mhj-dojo (the server the tests start is
# bin/mhj-dojo instead of `go run`, which compiles during the start-up wait).
# EXTRA passes more arguments to playwright, e.g. EXTRA=--shard=1/3.
e2e: build
	cd web && MHJDOJO_BIN=$(CURDIR)/bin/mhj-dojo npx playwright test $(EXTRA)

# Fails fast (even under `make -n`, via the leading '+') if DEPLOY_PROJECT
# isn't set, before building anything. The project id isn't committed;
# find it with `npx lolipop project list`.
deploy-check:
	+@if [ -z "$(DEPLOY_PROJECT)" ]; then \
		echo "DEPLOY_PROJECT is not set. Run 'npx lolipop project list' for the id, then 'DEPLOY_PROJECT=<id> make deploy' (or export DEPLOY_PROJECT)." >&2; \
		exit 1; \
	fi

# Deploy the static site to Lolipop Deploy Now. web/dist-site/ and the .wasm
# are gitignored, and the lolipop CLI skips gitignored files when its --dir
# is inside a git repo, so the build is copied to a temp dir outside the
# repo first. Run `npx lolipop login` once beforehand.
#
# `site` is invoked as a recipe command (not a prerequisite) so that under
# `make -j` it can't start in parallel with deploy-check: a prerequisite
# (even order-only, `deploy-check |`) only orders deploy-check before site,
# it doesn't stop make from scheduling both once deploy-check finishes, nor
# does it stop -j from starting site's own sub-recipes concurrently with an
# unrelated goal; recipe commands within a single target always run in order.
deploy: deploy-check
	+@$(MAKE) --no-print-directory site
	@set -e; \
	tmp_dir="$$(mktemp -d)" || exit 1; \
	trap 'rm -rf "$$tmp_dir"' EXIT; \
	[ -d "$$tmp_dir" ] || { echo "deploy: mktemp did not create a directory" >&2; exit 1; }; \
	cp -R web/dist-site/. "$$tmp_dir"/; \
	[ -f "$$tmp_dir/index.html" ] || { echo "deploy: $$tmp_dir/index.html is missing after copy" >&2; exit 1; }; \
	[ -f "$$tmp_dir/mhj-dojo.wasm" ] || { echo "deploy: $$tmp_dir/mhj-dojo.wasm is missing after copy" >&2; exit 1; }; \
	npx -y lolipop deploy --project $(DEPLOY_PROJECT) --dir "$$tmp_dir"
