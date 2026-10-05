# mhj-dojo

A web app for practicing Japanese riichi mahjong. Run the `mhj-dojo` CLI and it opens the app in your browser. It is the same build as the public site, its engine running in the browser (WebAssembly). Practice alone with per-yaku shanten and a rewindable history, or play a full game (東風戦 / 半荘戦) with calls and riichi against three CPU players.

[日本語版 README](README_jp.md)

The same app, no install: https://mhj-dojo.lolipop-now.app/

## Practice mode

- **Solo practice** — draw and discard on a seeded wall (the same seed always gives the same starting hand and draws). A game ends on tsumo or after 18 turns by default.
- **Per-yaku shanten** — after every draw/discard, see how far the hand is from each yaku, together with its effective tiles (ukeire) and how many of each remain unseen:
  normal form, tanyao, pinfu, iipeikou, ryanpeikou, sanshoku, sanshoku doukou, ittsu, chanta, junchan, honroutou, honitsu, chinitsu, toitoi, sanankou, shousangen, yakuhai (haku / hatsu / chun / ton), chiitoitsu,
  and the yakuman kokushi, suuankou, daisangen, tsuuiisou, shousuushii, daisuushii, ryuuiisou, chinroutou and chuuren.
- **Yaku table tools** — a 翻 column, a tooltip with each yaku's winning conditions, and filters: search by name or reading, limit by shanten, toggle 1翻 / 2翻 / 3翻以上 / 役満, and sort by shanten or ukeire.
- **Yaku combos** — the top five combinations of yaku one complete hand can score together (e.g. tanyao + pinfu + sanshoku), with their han, shanten and effective tiles, ranked so that one step toward tenpai weighs as much as two han (see [docs/api.md](docs/api.md)).
- **Dora and ura dora** — the header shows the dora indicator and its dora; the ura-dora indicator stays face down until the game ends.
- **Discard preview** — hover a tile to see the table as it would be after discarding it, with differences from the current values.
- **Time-series chart** — shanten per yaku across turns; toggle series from the legend (yakuman series are grouped at the end and hidden by default).
- **Rewindable history tree** — jump back to any turn and try a different discard. New branches are added and old ones are kept, so you can compare lines of play on the same wall.
- **Win panel** — on tsumo, shows the yaku, han, and dora (including red fives). Yakuman count 13 han each (26 for the double yakuman 四暗刻単騎, 国士無双十三面待ち, 純正九蓮宝燈 and 大四喜) and stack; dora are shown but not added.
- **Glossary** — a searchable list of the terms used on the page (shanten, ukeire, waits, rules, app features), shown beside the yaku table on wide screens.
- **Help and version** — the header's **?** opens a short guide to the screen; next to it, the build's commit and date, or its release (e.g. `v2026.0927.0`).
- **Minimizable panels** — the time-series chart, history tree and glossary can be minimized into tabs on the right edge of the screen and restored with a click; the layout is remembered.
- **Resume from the URL** — the page URL carries the session and seed, and the moves are saved in the browser (see [Saves](#saves)), so a reload resumes the game.

Default rules: red fives ×3, open tanyao allowed, atozuke allowed. Round and seat wind are fixed to East in solo practice.

## Playing against CPU players

Open **CPU対戦へ** in the header (or `/?mode=game`, `/?mode=game&seed=42`) to play a 東風戦 (one East round) or 半荘戦 (East then South) against three CPU players, with calls, riichi and full scoring.

- **Table** — every seat's river (a riichi tile lies sideways, a called tile shows in the taker's meld), melds, points, wind and dealer mark; CPU hands stay face down until the round ends. Choose **対局: 東風戦** or **半荘戦**, and **起家: ランダム** (seed mod 4) or **自分** to deal first yourself.
- **Your moves** — discard, **リーチ** (pick a discard that keeps tenpai; later draws are discarded for you unless you can win), **ツモ**, **ロン** / **見逃す**, and calls: **ポン** / **チー** / **カン** when offered, or a concealed/added kan on your own turn.
- **Calls** — pon and open kan on any seat's discard, chii from the seat to your left; the last discard of the round cannot be called, and a seat in riichi can only ron or make a concealed kan that keeps its waits. Kuikae (喰い替え) blocks discarding the called kind (or the far tile after an end-of-sequence chii) right after a pon or chii; an added kan can be robbed (槍槓 chankan); each kan draws a replacement tile (嶺上開花 rinshan if it wins) and adds a kan dora indicator (at once for a concealed kan; for an open or added kan when the declarer discards, so a ron on that discard counts it but the rinshan win does not). Open hands lose the closed-only yaku and a han on the kuisagari yaku.
- **CPU move playback** — after each of your moves the engine plays every CPU turn at once; the table replays them one discard/call at a time, with a **スキップ** button to jump straight to your next choice.
- **Rules** — riichi, double riichi, ippatsu, ura dora, haitei / houtei, 天和 / 地和 (tenhou / chiihou), furiten (own discards, same go-around, after riichi), head bump (no double ron), a noten penalty at the exhaustive draw (no nagashi mangan, 流し満貫), and the abortive draws 九種九牌, 四風連打, 四家立直 and 四開槓.
- **Scoring** — fu and han, mangan to counted yakuman, with double and stacked yakuman (a double yakuman counts 26 han; several together add up); dealer / non-dealer payments, honba (300 on a ron, 100 each on a tsumo) and riichi sticks — carried on the table until someone wins — shown with the point changes when the round ends.
- **Game flow** — the dealer keeps the deal (連荘) after winning, after a tenpai draw, or after an abortive draw, otherwise it passes on; honba goes up by one when the dealer keeps the deal or after any draw, and resets to 0 when a non-dealer wins. The game ends after its last round (unless the last dealer keeps the deal) or as soon as anyone drops below 0 points (tobi); final standings rank by points, with uma (+20 / +10 / −10 / −20) and oka (+20 to first place).
- **Per-yaku shanten for open hands** — melds count as fixed groups, so shanten only counts your concealed tiles; a meld that can't satisfy a yaku's shape makes that row impossible. Any meld drops chiitoitsu, kokushi, chuuren, pinfu and ryanpeikou; a chii, pon or open kan additionally opens the hand, dropping iipeikou and suuankou too (a concealed kan alone keeps the hand closed).
- **CPU players** — **CPU: 普通** takes every win, riichis when tenpai, calls when it keeps a yaku, kans when it doesn't set the hand back, discards for tile efficiency, and folds against a riichi two or more steps from tenpai. **CPU: 弱い** also wins and riichis but never calls, kans or folds, and often picks a less efficient discard — both are reproducible from the seed.
- **Practice tools stay on** — the per-yaku shanten table (its wind rows follow your seat and the round), the discard preview, the time-series chart and the glossary. There is no rewinding in a game.
- **Seed** — a seed you choose makes the whole game (CPU moves included) repeatable; a random seed is revealed when the game ends. Only one tab of a browser plays a game or practice session at a time: opening it in another tab stops the first one, which can take it back with 「このタブで続ける」.

### How yaku shanten is defined

For a 13-tile hand H and a yaku Y, shanten is the minimum number of tiles of H that must be replaced to reach a complete 14-tile hand satisfying Y, minus one (tenpai = 0, win = −1). A tile is an effective tile for Y if drawing it lowers that value. Pinfu is exact at tenpai (it requires a two-sided wait); at 1-shanten and above it is an approximation, marked "近似" (approximate) in the UI. See [docs/api.md](docs/api.md) for details.

## Requirements

- Go 1.27+
- Node.js 24+ (to build the frontend, which the binary embeds)

## Quick start

```sh
make build        # builds the static site (make embed), then bin/mhj-dojo with it embedded
./bin/mhj-dojo    # serves http://127.0.0.1:8765 and opens the browser
```

The built frontend isn't committed, so a plain `go build` or `go install github.com/litencatt/mhj-dojo/cmd/mhj-dojo@latest` gives a binary without it: there is nothing to play, and the page only says to rebuild with `make build`. No prebuilt binaries are published; clone the repository and use `make build`.

### Flags

| Flag | Default | Description |
|---|---|---|
| `--port` | `8765` | Port to listen on (`0` = random free port) |
| `--host` | `127.0.0.1` | Host to bind |
| `--open` | `true` | Open the browser on start |
| `--seed` | random | Open practice on this wall seed (0 to 2^53-1; the page `/?seed=N`); CPU games and later practice sessions are not affected |

The server only answers requests whose `Host` header names localhost or a loopback address, which stops another site's page from reaching the app through DNS rebinding. Even with `--host 0.0.0.0`, browsers on other machines can't open the app (the server prints a warning when bound to a non-loopback address).

### Saves

Practice sessions and CPU games are saved in the browser's localStorage: the 10 most recently used sessions and the 5 most recently used games. A reload, or restarting `mhj-dojo`, continues from the save; if a save can't be used, a seed in the URL deals the same wall again. localStorage is per origin (host and port), so another `--port`, or `localhost` instead of `127.0.0.1`, shows other saves.

## Development

```sh
make test         # go test ./...
make vet          # go vet ./...
make embed        # make site (npm ci first if needed), copied to internal/server/static/dist (not committed)
make run          # make embed, then go run ./cmd/mhj-dojo
```

After changing `web/` or the engine, rebuild it with `make embed` (or use `make build` / `make run`): a plain `go build` or `go run` embeds whatever `make embed` last copied.

Every engine operation goes through `internal/apicall` (`apicall.Route`, which the WebAssembly engine answers with), and its behaviour is tested there. Add new operations there; the UI calls them only through the engine in the browser (`web/src/wasm.ts`).

Frontend dev server with hot reload (the engine runs in the page, so build it into `web/site-public/` first):

```sh
make wasm
cd web && npm run dev
```

Browser end-to-end tests (Playwright + Chromium) cover practice mode, a CPU game (calls, round result, next round, phone layouts), the help and the 更新情報 page. They live in `web/e2e/`, and `npm run e2e` runs them on their own `mhj-dojo` server serving the embedded site build (below), so no other server needs to be running:

```sh
cd web && npx playwright install --with-deps chromium   # once
make embed && cd web && npm run e2e
```

Or `make e2e` (`EXTRA=--shard=1/3` or a spec path narrows it), which builds `bin/mhj-dojo` and runs the tests against it instead of `go run` (`MHJDOJO_BIN=<path>` does the same for `npm run e2e`; CI uses it).

### Static site (WebAssembly)

The app is a static site: the Go engine (`cmd/mhj-dojo-wasm`) is compiled to WebAssembly and runs in the browser, in a Web Worker so the analysis doesn't freeze the page. The page sends it requests in the format of [docs/api.md](docs/api.md). `mhj-dojo` serves this build (`make embed`); any static host can too.

```sh
make site         # make wasm (GOOS=js GOARCH=wasm → web/site-public/mhj-dojo.wasm + wasm_exec.js), then npm run build:site
```

The site lands in `web/dist-site/` (not committed): `index.html`, JS, CSS, `worker.js`, `mhj-dojo.wasm` and Go's `wasm_exec.js`. Asset paths are relative, so any static host and subpath works; serve `.wasm` as `application/wasm` (other types still work, only slower to start). Preview it with `cd web && npm run preview`.

It's published at https://mhj-dojo.lolipop-now.app/ on Lolipop Deploy Now.

The 更新情報 (what's new) page at `info/` (https://mhj-dojo.lolipop-now.app/info/) is rendered from `CHANGELOG.md` at build time, so each release's build lists itself; the notes are shown without their authors, the CI, dependency and E2E-only changes are left out, the first release is only named, and nothing links to GitHub (`web/src/changelog.ts`). `mhj-dojo` serves the same built page at `/info/`.

#### Deploying

The build and the deploy are split into two workflows, so the release artifact isn't tied to any one host. Releases go through [tagpr](https://github.com/Songmu/tagpr) (`.tagpr`, `.github/workflows/tagpr.yml`):

1. On every push to `main`, tagpr keeps a release pull request open that updates `CHANGELOG.md` from GitHub's generated release notes, grouped into categories (`.github/release.yml`) by the label **Label pull requests** (`.github/workflows/labeler.yml`) adds from each pull request's head branch prefix (`feat/` → enhancement, `fix/` → bug, `perf/` → performance, `docs/` → documentation, `ci/` → ci, `chore/`/`build/`/`test/` → chore, `dependabot/` → dependencies).
2. Merging it tags the release, named by the date in Japan and the release's number that day (`v2026.0927.0`, then `v2026.0927.1`), and creates the GitHub Release. The same workflow then runs **Build site release** (`.github/workflows/build-site-release.yml`) for the tag: it builds the tagged commit with the release in the header (`MHJDOJO_RELEASE`), runs the site's E2E tests on the build, packages `web/dist-site` as `mhj-dojo-site-<tag>.tar.gz` (plus a `.sha256`) and attaches both to the tag's GitHub Release.
3. Build site release then calls **Deploy to Lolipop** (`.github/workflows/deploy-lolipop.yml`) with the tag. It downloads and verifies that release artifact, merges the tag into a release branch cut from `lolipop-deploy-now`, replaces `web/dist-site` there entirely with the artifact's contents (gitignored on `main`, since Deploy Now can't build the Go WebAssembly engine) and opens a pull request into `lolipop-deploy-now`. The site is published from that branch: Lolipop Deploy Now's GitHub integration watches it (framework: static, no install or build command, output directory `web/dist-site`) and publishes each merge into it.
4. Merging that pull request with a merge commit (not squash) publishes the release.
5. The push to `lolipop-deploy-now` runs **Verify live site** (`.github/workflows/verify-live.yml`): it waits (up to 10 minutes) until the live `version.json` reports the release, then runs the live smoke test (`npm run e2e:live` with `EXPECT_RELEASE=<tag>`); if that fails, it opens an issue labelled `ci`.

What's still manual: merging the release pull request tagpr opens and merging the deploy pull request (with a merge commit). Both are created with `GITHUB_TOKEN`, so they get no CI run and show no checks (`gh pr checks --watch` may return at once with nothing to watch); Build site release verifies the tag and the deploy pull request's contents before it's opened, and Verify live site checks what went live. The push to `main` that merges the release pull request only changes `CHANGELOG.md`, which `ci.yml` skips (`paths-ignore`). If Build site release fails for a tag, re-run it for a flaky failure; for a real defect, fix `main` and release again: the failed tag is never deployed.

Build site release, Deploy to Lolipop and Verify live site can also be run by hand (Actions → *workflow* → Run workflow): Build site release for a tag or for `main` as it is (with no tag, it only builds and tests, keeping the build as a workflow artifact instead of a Release asset, and doesn't call the deploy workflow); Deploy to Lolipop for any existing tag whose Release still carries the artifact, to redeploy it or to **roll back** to an older release — since `web/dist-site` is replaced entirely rather than merged file-by-file, the branch ends up with exactly that tag's files either way, with nothing from tags in between carried over; Verify live site for a tag (or empty, to read it from `lolipop-deploy-now`). Build site release and Deploy to Lolipop need "Allow GitHub Actions to create and approve pull requests" (Settings → Actions → General); their pull requests don't trigger CI (Build site release runs the site's E2E tests itself; `main`'s CI covers the rest).

The site's base URL (used for OGP tags etc.) comes from one place: the `MHJDOJO_SITE_URL` build-time variable, sourced from the `SITE_URL` repository variable (`gh variable set SITE_URL --body https://your-host.example/`, trailing slash included), falling back to the current `https://mhj-dojo.lolipop-now.app/` when unset. `web/playwright.live.config.ts` (`npm run e2e:live` in `web/`, or against a live URL directly with `LIVE_BASE_URL=... npm run e2e:live`) reads the same variable as its default base URL.

**Moving to a different host later**: add a `deploy-<host>.yml` (`workflow_call` + `workflow_dispatch`, input `tag`) that downloads the same `mhj-dojo-site-<tag>.tar.gz` Release asset `deploy-lolipop.yml` does, publish however that host needs, then point `build-site-release.yml`'s call at the new workflow (and set the `SITE_URL` repository variable to the new host). No change to the build is needed, since the artifact it produces is host-independent.

To deploy by hand instead, run `npx lolipop login` once (opens a browser to authorize the CLI), then `DEPLOY_PROJECT=<id> make deploy` (or `export DEPLOY_PROJECT=<id>` first) to build and publish the site; the project id isn't committed and isn't the same for everyone's own Lolipop account, so find it with `npx lolipop project list` (`make deploy` fails fast with a reminder if `DEPLOY_PROJECT` is unset). The Lolipop project was created once with `npx lolipop project create --name mhj-dojo --framework static --install "" --build "" --output "."`; `make deploy` only pushes new builds to it. `make deploy` copies `web/dist-site/` to a fresh temporary directory outside this repo before deploying, because `web/dist-site/` and `mhj-dojo.wasm` are gitignored and the `lolipop` CLI skips gitignored files when its `--dir` is inside a git repository. Deploy Now serves `index.html` with `max-age=86400`, so a deploy can take up to a day to reach a returning visitor's cached page; `index.html` loads the engine (worker, `wasm_exec.js`, `mhj-dojo.wasm`) with a `?v=<hash>` of those files (see `web/src/wasm.ts`), so a returning visitor's stale `index.html` never mixes an old page with a new engine or vice versa.

The site build also writes `version.json` (`{"version": "<commit>", "id": "<hash of the build's inputs>", "built": "<time>"}`; `MHJDOJO_VERSION` overrides the commit, which is `dev` outside git). An open page checks it at startup, every 10 minutes and when the tab comes back into view, and when a newer build is out it shows 「新しいバージョンがあります」 with a 再読み込み button that loads the page with a `_v=<id>` parameter to get past the cached `index.html`.

It also writes `sw.js`, a Service Worker that precaches the build (the pages, the hashed assets, the engine, the icons and the manifest) so that the app opens offline after a first visit: the pages are fetched from the network and fall back to the cache (offline, on a 5xx or after 4 seconds); the other precached files come from the cache; `version.json` always comes from the network. A new build's worker takes over when a page of that build loads (再読み込み loads one). `mhj-dojo` registers it too, on its own localhost port. Building with `MHJDOJO_SW=off` is the kill switch: the new page unregisters any worker and deletes its caches. The CDN serves `sw.js?v=<id>` with a one-year `cache-control`, so a worker already registered keeps getting its old `sw.js` from the CDN; it goes away when the user loads the new page (the pages come from the network first, and the CDN may serve `index.html` for up to about 24 hours). The `sw.js` written by an off build only matters where it is fetched fresh.

The site build's `index.html` also carries absolute Open Graph/Twitter share tags (`og:url`, `og:image`, `twitter:image`), built from that same `MHJDOJO_SITE_URL`. `mhj-dojo` embeds this same build (`make embed`), tags included.

### Layout

```
cmd/mhj-dojo/        CLI entry point
cmd/mhj-dojo-wasm/   engine (practice and CPU games) as WebAssembly for the static site
internal/tile/       tile representation and notation
internal/wall/       seeded wall, deal, draws
internal/memo/       bounded memo table for the shanten engines
internal/shanten/    normal / chiitoitsu / kokushi shanten and ukeire
internal/yakushanten/ per-yaku shanten
internal/yaku/       win decomposition, yaku and dora
internal/apiview/    JSON views shared by practice and games
internal/session/    solo game session and history tree
internal/score/      points from han and fu
internal/game/       four-player round engine (riichi, furiten, settlement)
internal/cpu/        CPU player
internal/match/      games against CPU players
internal/store/      the engine's in-memory store for sessions and games
internal/apicall/    the engine's entry for every request (apicall.Route)
internal/server/     static file serving of the embedded site build
web/                 Vite + Preact + TypeScript frontend
docs/api.md          the engine's request format and definitions
```

Tile notation: `1m`–`9m`, `1p`–`9p`, `1s`–`9s`, `1z`–`7z` (East, South, West, North, White, Green, Red). A red five is written `0m` / `0p` / `0s`.

## License

MIT License. See [LICENSE](LICENSE).

The static site also ships third-party software (Preact, and the Go runtime and `wasm_exec.js` in the WebAssembly engine); their licenses are in [web/site-public/THIRD_PARTY_LICENSES.txt](web/site-public/THIRD_PARTY_LICENSES.txt), which the site serves as `THIRD_PARTY_LICENSES.txt`.
