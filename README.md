# mhj2

A local web app for practicing Japanese riichi mahjong. Run the `mhj2` CLI and it starts a local web server and opens the practice UI in your browser.

[日本語版 README](README_jp.md)

## Features (Phase 1)

- **Solo practice** — draw and discard on a seeded wall (the same seed always gives the same starting hand and draws). A game ends on tsumo or after 18 turns by default.
- **Per-yaku shanten** — after every draw/discard, see how far the hand is from each yaku, together with its effective tiles (ukeire) and how many of each remain unseen:
  normal form, tanyao, pinfu, iipeikou, sanshoku, ittsu, chanta, junchan, honitsu, chinitsu, toitoi, sanankou, yakuhai (haku / hatsu / chun / ton), chiitoitsu, kokushi.
- **Discard preview** — hover a tile to see the table as it would be after discarding it, with differences from the current values.
- **Time-series chart** — shanten per yaku across turns; toggle series from the legend.
- **Rewindable history tree** — jump back to any turn and try a different discard. New branches are added and old ones are kept, so you can compare lines of play on the same wall.
- **Win panel** — on tsumo, shows the yaku, han, and dora (including red fives).

Default rules: red fives ×3, open tanyao allowed, atozuke allowed. Round and seat wind are fixed to East in Phase 1.

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

The server only accepts requests addressed to localhost (a DNS-rebinding guard), so it is not reachable from other machines even with `--host 0.0.0.0`.

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

Open `http://localhost:5173/?mock=1` to use the built-in mock backend instead (dev only).

### Layout

```
cmd/mhj2/            CLI entry point
internal/tile/       tile representation and notation
internal/wall/       seeded wall, deal, draws
internal/shanten/    normal / chiitoitsu / kokushi shanten and ukeire
internal/yakushanten/ per-yaku shanten
internal/yaku/       win decomposition, yaku and dora
internal/session/    solo game session and history tree
internal/server/     HTTP API and embedded frontend
web/                 Vite + Preact + TypeScript frontend
docs/api.md          HTTP API and definitions
```

Tile notation: `1m`–`9m`, `1p`–`9p`, `1s`–`9s`, `1z`–`7z` (East, South, West, North, White, Green, Red). A red five is written `0m` / `0p` / `0s`.

## Roadmap

- **Phase 2** — full four-player hanchan against three CPU players: calls (pon/chi/kan), riichi, fu and score calculation.
