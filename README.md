# mhj2

A local web app for practicing Japanese riichi mahjong. Run the `mhj2` CLI and it starts a local web server and opens the practice UI in your browser. Practice alone with per-yaku shanten and a rewindable history, or play a round against three CPU players.

[日本語版 README](README_jp.md)

## Features (Phase 1)

- **Solo practice** — draw and discard on a seeded wall (the same seed always gives the same starting hand and draws). A game ends on tsumo or after 18 turns by default.
- **Per-yaku shanten** — after every draw/discard, see how far the hand is from each yaku, together with its effective tiles (ukeire) and how many of each remain unseen:
  normal form, tanyao, pinfu, iipeikou, ryanpeikou, sanshoku, sanshoku doukou, ittsu, chanta, junchan, honroutou, honitsu, chinitsu, toitoi, sanankou, shousangen, yakuhai (haku / hatsu / chun / ton), chiitoitsu,
  and the yakuman kokushi, suuankou, daisangen, tsuuiisou, shousuushii, daisuushii, ryuuiisou, chinroutou and chuuren.
- **Yaku table tools** — a 翻 column, a tooltip with each yaku's winning conditions, and filters: search by name or reading, limit by shanten, toggle 1翻 / 2翻 / 3翻以上 / 役満, and sort by shanten or ukeire.
- **Dora and ura dora** — the header shows the dora indicator and its dora; the ura-dora indicator stays face down until the game ends.
- **Discard preview** — hover a tile to see the table as it would be after discarding it, with differences from the current values.
- **Time-series chart** — shanten per yaku across turns; toggle series from the legend (yakuman series are grouped at the end and hidden by default).
- **Rewindable history tree** — jump back to any turn and try a different discard. New branches are added and old ones are kept, so you can compare lines of play on the same wall.
- **Win panel** — on tsumo, shows the yaku, han, and dora (including red fives). Yakuman count 13 han each and stack; dora are shown but not added.
- **Glossary** — a searchable list of the terms used on the page (shanten, ukeire, waits, rules, app features), shown beside the yaku table on wide screens.
- **Minimizable panels** — the time-series chart, history tree and glossary can be minimized into tabs on the right edge of the screen and restored with a click; the layout is remembered.
- **Resume from the URL** — the page URL carries the session and seed, so a reload resumes the game. If the server was restarted, the same wall is dealt again from the seed.

Default rules: red fives ×3, open tanyao allowed, atozuke allowed. Round and seat wind are fixed to East in solo practice.

## Playing against CPU players (Phase 2a)

Open **CPU対戦へ** in the header (or `/?mode=game`, `/?mode=game&seed=42`) to play one closed-hand East round against three CPU players.

- **Table** — every seat's river (the riichi tile lies sideways), points, wind and dealer mark; CPU hands stay face down until the round ends. The dealer is the seed mod 4, so your seat wind varies.
- **Your moves** — discard, **リーチ** (then pick a discard that keeps tenpai; later draws are discarded for you unless you can win), **ツモ**, and **ロン** / **見逃す** when a discard completes your hand.
- **Rules** — riichi, double riichi, ippatsu, ura dora, haitei / houtei, furiten (own discards, same go-around, after riichi), head bump, noten penalty at the exhaustive draw. No calls (pon / chi / kan) yet.
- **Scoring** — fu and han, mangan to (counted) yakuman, dealer / non-dealer payments and riichi sticks, shown with the point changes when the round ends.
- **CPU players** — take every win, discard for tile efficiency, declare riichi when tenpai, and fold (genbutsu, suji, safe honors) against a riichi when two or more steps from tenpai.
- **Practice tools stay on** — the per-yaku shanten table (its wind rows follow your seat and the round), the discard preview, the time-series chart and the glossary. There is no rewinding in a game.
- **Seed** — a seed you choose makes the whole round (CPU moves included) repeatable; a random seed is revealed when the round ends.

### How yaku shanten is defined

For a 13-tile hand H and a yaku Y, shanten is the minimum number of tiles of H that must be replaced to reach a complete 14-tile hand satisfying Y, minus one (tenpai = 0, win = −1). A tile is an effective tile for Y if drawing it lowers that value. Pinfu is exact at tenpai (it requires a two-sided wait); at 1-shanten and above it is an approximation, marked "近似" (approximate) in the UI. See [docs/api.md](docs/api.md) for details.

## Requirements

- Go 1.27+
- Node.js 24+ (only needed to rebuild the frontend; the built assets are committed)

## Quick start

```sh
make build        # builds bin/mhj2 (frontend is embedded)
./bin/mhj2        # serves http://127.0.0.1:8765 and opens the browser
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
make run          # go run ./cmd/mhj2
```

Frontend dev server with hot reload (proxies `/api` to `127.0.0.1:8765`, so keep `mhj2` running):

```sh
cd web && npm run dev
```

Browser end-to-end tests (Playwright + Chromium) cover practice mode and a CPU game (calls, round result, next round, a mobile viewport). They start their own `mhj2` server against the built frontend, so no other server needs to be running:

```sh
cd web && npx playwright install --with-deps chromium   # once
cd web && npm run build && npm run e2e
```

### Layout

```
cmd/mhj2/            CLI entry point
internal/tile/       tile representation and notation
internal/wall/       seeded wall, deal, draws
internal/shanten/    normal / chiitoitsu / kokushi shanten and ukeire
internal/yakushanten/ per-yaku shanten
internal/yaku/       win decomposition, yaku and dora
internal/session/    solo game session and history tree
internal/score/      points from han and fu
internal/game/       four-player round engine (riichi, furiten, settlement)
internal/cpu/        CPU player
internal/match/      games against CPU players for the API
internal/store/      in-memory store for sessions and games
internal/server/     HTTP API and embedded frontend
web/                 Vite + Preact + TypeScript frontend
docs/api.md          HTTP API and definitions
```

Tile notation: `1m`–`9m`, `1p`–`9p`, `1s`–`9s`, `1z`–`7z` (East, South, West, North, White, Green, Red). A red five is written `0m` / `0p` / `0s`.

## Roadmap

- **Phase 2a** (done) — one closed-hand round against three CPU players with riichi, fu and points.
- **Phase 2b** — calls (pon / chi / kan, rinshan, kan dora) and full games (tonpuu / hanchan, dealer rotation, renchan, honba, final ranking).
