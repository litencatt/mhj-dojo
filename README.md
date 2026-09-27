# mhj-dojo

A local web app for practicing Japanese riichi mahjong. Run the `mhj-dojo` CLI and it starts a local web server and opens the practice UI in your browser. Practice alone with per-yaku shanten and a rewindable history, or play a full game (東風戦 / 半荘戦) with calls and riichi against three CPU players.

[日本語版 README](README_jp.md)

Static site (practice mode only, CPU games not yet): https://mhj-dojo.lolipop-now.app/

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
- **Help and version** — the header's **?** opens a short guide to the screen; next to it, the commit the app was built from (`GET /api/version`).
- **Minimizable panels** — the time-series chart, history tree and glossary can be minimized into tabs on the right edge of the screen and restored with a click; the layout is remembered.
- **Resume from the URL** — the page URL carries the session and seed, so a reload resumes the game. If the server was restarted, the same wall is dealt again from the seed.

Default rules: red fives ×3, open tanyao allowed, atozuke allowed. Round and seat wind are fixed to East in solo practice.

## Playing against CPU players

Open **CPU対戦へ** in the header (or `/?mode=game`, `/?mode=game&seed=42`) to play a 東風戦 (one East round) or 半荘戦 (East then South) against three CPU players, with calls, riichi and full scoring.

- **Table** — every seat's river (a riichi tile lies sideways, a called tile shows in the taker's meld), melds, points, wind and dealer mark; CPU hands stay face down until the round ends. Choose **対局: 東風戦** or **半荘戦**, and **起家: ランダム** (seed mod 4) or **自分** to deal first yourself.
- **Your moves** — discard, **リーチ** (pick a discard that keeps tenpai; later draws are discarded for you unless you can win), **ツモ**, **ロン** / **見逃す**, and calls: **ポン** / **チー** / **カン** when offered, or a concealed/added kan on your own turn.
- **Calls** — pon and open kan on any seat's discard, chii from the seat to your left; the last discard of the round cannot be called, and a seat in riichi can only ron or make a concealed kan that keeps its waits. Kuikae (喰い替え) blocks discarding the called kind (or the far tile after an end-of-sequence chii) right after a pon or chii; an added kan can be robbed (槍槓 chankan); each kan draws a replacement tile (嶺上開花 rinshan if it wins) and adds a kan dora indicator (at once for a concealed kan; for an open or added kan when the declarer discards, so a ron on that discard counts it but the rinshan win does not). Open hands lose the closed-only yaku and a han on the kuisagari yaku.
- **CPU move playback** — after each of your moves the server plays every CPU turn at once; the table replays them one discard/call at a time, with a **スキップ** button to jump straight to your next choice.
- **Rules** — riichi, double riichi, ippatsu, ura dora, haitei / houtei, furiten (own discards, same go-around, after riichi), head bump (no double ron), a noten penalty at the exhaustive draw, and the abortive draws 九種九牌, 四風連打, 四家立直 and 四開槓.
- **Scoring** — fu and han, mangan to counted yakuman, with double and stacked yakuman (a double yakuman counts 26 han; several together add up); dealer / non-dealer payments, honba (300 on a ron, 100 each on a tsumo) and riichi sticks — carried on the table until someone wins — shown with the point changes when the round ends.
- **Game flow** — the dealer keeps the deal (連荘) after winning, after a tenpai draw, or after an abortive draw, otherwise it passes on; honba goes up by one when the dealer keeps the deal or after any draw, and resets to 0 when a non-dealer wins. The game ends after its last round (unless the last dealer keeps the deal) or as soon as anyone drops below 0 points (tobi); final standings rank by points, with uma (+20 / +10 / −10 / −20) and oka (+20 to first place).
- **Per-yaku shanten for open hands** — melds count as fixed groups, so shanten only counts your concealed tiles; a meld that can't satisfy a yaku's shape makes that row impossible. Any meld drops chiitoitsu, kokushi, chuuren, pinfu and ryanpeikou; a chii, pon or open kan additionally opens the hand, dropping iipeikou and suuankou too (a concealed kan alone keeps the hand closed).
- **CPU players** — **CPU: 普通** takes every win, riichis when tenpai, calls when it keeps a yaku, kans when it doesn't set the hand back, discards for tile efficiency, and folds against a riichi two or more steps from tenpai. **CPU: 弱い** also wins and riichis but never calls, kans or folds, and often picks a less efficient discard — both are reproducible from the seed.
- **Practice tools stay on** — the per-yaku shanten table (its wind rows follow your seat and the round), the discard preview, the time-series chart and the glossary. There is no rewinding in a game.
- **Seed** — a seed you choose makes the whole game (CPU moves included) repeatable; a random seed is revealed when the game ends. If another tab (or a CPU turn finishing mid-request) has already moved the game on, your next action re-fetches the current state instead of failing.

### How yaku shanten is defined

For a 13-tile hand H and a yaku Y, shanten is the minimum number of tiles of H that must be replaced to reach a complete 14-tile hand satisfying Y, minus one (tenpai = 0, win = −1). A tile is an effective tile for Y if drawing it lowers that value. Pinfu is exact at tenpai (it requires a two-sided wait); at 1-shanten and above it is an approximation, marked "近似" (approximate) in the UI. See [docs/api.md](docs/api.md) for details.

## Requirements

- Go 1.27+
- Node.js 24+ (only needed to rebuild the frontend; the built assets are committed)

## Quick start

```sh
make build        # builds bin/mhj-dojo (frontend is embedded)
./bin/mhj-dojo    # serves http://127.0.0.1:8765 and opens the browser
```

### Flags

| Flag | Default | Description |
|---|---|---|
| `--port` | `8765` | Port to listen on (`0` = random free port) |
| `--host` | `127.0.0.1` | Host to bind |
| `--open` | `true` | Open the browser on start |
| `--seed` | random | Default wall seed for new games |

The server only accepts requests whose `Host` header names localhost. That stops web pages in your browser from reaching it through DNS rebinding, but it is not authentication: with `--host 0.0.0.0` any machine on the network can use the API by sending a loopback `Host` header, and the server prints a warning when bound to a non-loopback address. Keep the default host unless you trust the network.

## Development

```sh
make test         # go test ./...
make vet          # go vet ./...
make web          # npm ci && npm run build → internal/server/static
make run          # go run ./cmd/mhj-dojo
```

Frontend dev server with hot reload (proxies `/api` to `127.0.0.1:8765`, so keep `mhj-dojo` running):

```sh
cd web && npm run dev
```

Browser end-to-end tests (Playwright + Chromium) cover practice mode and a CPU game (calls, round result, next round, a mobile viewport). They start their own `mhj-dojo` server against the built frontend, so no other server needs to be running:

```sh
cd web && npx playwright install --with-deps chromium   # once
cd web && npm run build && npm run e2e
```

### Static site (WebAssembly, practice mode only)

The practice mode can also be built as a static site that needs no server: the Go practice engine (`cmd/mhj-dojo-wasm`) is compiled to WebAssembly and runs in the browser, in a Web Worker so the analysis doesn't freeze the page. It answers the same requests as the HTTP API (docs/api.md), so the UI code is shared.

```sh
make site         # make wasm (GOOS=js GOARCH=wasm → web/site-public/mhj-dojo.wasm + wasm_exec.js), then npm run build:site
```

The site lands in `web/dist-site/` (not committed): `index.html`, JS, CSS, `worker.js`, `mhj-dojo.wasm` and Go's `wasm_exec.js`. Asset paths are relative, so any static host and subpath works; serve `.wasm` as `application/wasm` (other types still work, only slower to start). Preview it with `cd web && npm run preview:site`, and run its E2E tests with `cd web && npm run e2e:site`.

Differences from the local version:

- Practice mode only; the CPU game (**CPU対戦へ**, `?mode=game`) is not available yet.
- Each tab runs its own sessions, so there is no "another tab moved on" handling.
- Each session's moves are saved in the browser (localStorage, the 10 most recently used sessions) and replayed after a reload, under the same URL; if that fails, the same wall is dealt again from the seed in the URL.

It's published at https://mhj-dojo.lolipop-now.app/ (practice mode only; CPU games not yet) on Lolipop Deploy Now.

#### Deploying

Run `npx lolipop login` once (opens a browser to authorize the CLI), then `DEPLOY_PROJECT=<id> make deploy` (or `export DEPLOY_PROJECT=<id>` first) to build and publish the site; the project id isn't committed and isn't the same for everyone's own Lolipop account, so find it with `npx lolipop project list` (`make deploy` fails fast with a reminder if `DEPLOY_PROJECT` is unset). The Lolipop project was created once with `npx lolipop project create --name mhj-dojo --framework static --install "" --build "" --output "."`; `make deploy` only pushes new builds to it. `make deploy` copies `web/dist-site/` to a fresh temporary directory outside this repo before deploying, because `web/dist-site/` and `mhj-dojo.wasm` are gitignored and the `lolipop` CLI skips gitignored files when its `--dir` is inside a git repository. Deploy Now serves `index.html` with `max-age=86400`, so a deploy can take up to a day to reach a returning visitor's cached page; `index.html` loads the engine (worker, `wasm_exec.js`, `mhj-dojo.wasm`) with a `?v=<hash>` of those files (see `web/src/wasm.ts`), so a returning visitor's stale `index.html` never mixes an old page with a new engine or vice versa.

The site build also writes `version.json` (`{"version": "<commit>", "id": "<hash of the build's inputs>", "built": "<time>"}`; `MHJDOJO_VERSION` overrides the commit, which is `dev` outside git). An open page checks it at startup, every 10 minutes and when the tab comes back into view, and when a newer build is out it shows 「新しいバージョンがあります」 with a 再読み込み button that loads the page with a `_v=<id>` parameter to get past the cached `index.html`.

### Layout

```
cmd/mhj-dojo/        CLI entry point
cmd/mhj-dojo-wasm/   practice engine as WebAssembly for the static site
internal/tile/       tile representation and notation
internal/wall/       seeded wall, deal, draws
internal/shanten/    normal / chiitoitsu / kokushi shanten and ukeire
internal/yakushanten/ per-yaku shanten
internal/yaku/       win decomposition, yaku and dora
internal/apiview/    JSON views shared by the practice and game APIs
internal/session/    solo game session and history tree
internal/score/      points from han and fu
internal/game/       four-player round engine (riichi, furiten, settlement)
internal/cpu/        CPU player
internal/match/      games against CPU players for the API
internal/store/      in-memory store for sessions and games
internal/apicall/    request handling shared by the HTTP API and the WebAssembly build
internal/server/     HTTP API and embedded frontend
web/                 Vite + Preact + TypeScript frontend
docs/api.md          HTTP API and definitions
```

Tile notation: `1m`–`9m`, `1p`–`9p`, `1s`–`9s`, `1z`–`7z` (East, South, West, North, White, Green, Red). A red five is written `0m` / `0p` / `0s`.

## License

MIT License. See [LICENSE](LICENSE).

The static site also ships third-party software (Preact, and the Go runtime and `wasm_exec.js` in the WebAssembly engine); their licenses are in [web/site-public/THIRD_PARTY_LICENSES.txt](web/site-public/THIRD_PARTY_LICENSES.txt), which the site serves as `THIRD_PARTY_LICENSES.txt`.
