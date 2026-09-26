.PHONY: web build test run vet wasm site deploy deploy-check

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
