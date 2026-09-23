# mhj2 HTTP API (Phase 1)

All endpoints return JSON (`Content-Type: application/json`). Errors: HTTP 4xx/5xx with `{"error": "message"}`.

## Tile notation

| Notation | Meaning |
|---|---|
| `1m`–`9m` | 萬子 (manzu) |
| `1p`–`9p` | 筒子 (pinzu) |
| `1s`–`9s` | 索子 (souzu) |
| `0m` `0p` `0s` | 赤5 (red five; one per suit) |
| `1z`–`7z` | 東 南 西 北 白 發 中 |

Hands are always returned sorted (m, p, s, z; red five sorts as 5).
In all shanten/ukeire computation a red five is identical to a normal five.

## Model

A session is a solo game on a fixed wall generated from `seed`.
Because the game is solo, the k-th draw is always `wall[k]` regardless of branch.

A **node** is the state *after a discard*: 13 tiles in hand at turn `turn`
(`turn` = number of discards made so far; root node = starting hand, turn 0).
At a playing node, the next draw `drawn` is shown and the player picks a discard
from hand+drawn (14 tiles), which creates (or moves to an existing) child node.
The tree keeps every branch.

Node status:
- `playing` – waiting for a discard (or tsumo if `can_tsumo`)
- `tsumo` – the player declared tsumo at this node (terminal)
- `exhausted` – `turn == max_turns` reached (terminal; no more draws)

## Endpoints

### `POST /api/sessions`
Body (all optional): `{"seed": 42, "max_turns": 18}`
If `seed` is omitted, a random seed is chosen. Returns a `State`.

### `GET /api/sessions/{id}`
Returns the `State` at the current node.

### `POST /api/sessions/{id}/discard`
Body: `{"tile": "5m"}` – exact tile string from hand or `drawn` (red matters: `0m` vs `5m`).
Creates the child node, or moves to it if the same discard already exists. Returns the `State`.

### `POST /api/sessions/{id}/tsumo`
Allowed only when `can_tsumo` is true. Creates a terminal `tsumo` child node. Returns the `State`.

### `POST /api/sessions/{id}/goto`
Body: `{"node_id": 3}` – moves the current node. Returns the `State`.

## `State`

```jsonc
{
  "session_id": "a1b2c3",
  "seed": 42,
  "max_turns": 18,
  "round_wind": "1z",          // fixed 東 in Phase 1
  "seat_wind": "1z",           // fixed 東 in Phase 1
  "node_id": 5,
  "turn": 3,
  "status": "playing",         // playing | tsumo | exhausted
  "hand": ["1m", "..."],       // 13 tiles, sorted
  "drawn": "5s",               // null unless status == playing
  "discards": ["9z", "..."],   // path discards, in order
  "dora_indicators": ["3z"],
  "wall_remaining": 115,       // draws left in the live wall (not max_turns)
  "can_tsumo": false,          // hand + drawn is a complete hand

  // Analysis of the 13-tile `hand` at this node.
  "analysis": [YakuRow],

  // Only when status == playing: for each distinct discard candidate of hand+drawn
  // (key = exact tile string, red kept distinct), analysis of the resulting 13 tiles.
  "by_discard": { "5m": [YakuRow], "...": [YakuRow] },

  // Path from the root to the current node (inclusive), for the time-series chart.
  "history": [
    { "node_id": 0, "turn": 0, "draw": null, "discard": null,
      "shanten": { "normal": 3, "tanyao": 4, "honitsu": null /* impossible */ } }
  ],

  // Whole tree for the branch view.
  "tree": [
    { "node_id": 0, "parent_id": null, "turn": 0, "draw": null, "discard": null, "status": "playing", "normal_shanten": 3 }
  ],

  // Only when status == tsumo.
  "win": {
    "tiles": ["..."],                          // 14 tiles
    "yaku": [ { "key": "tanyao", "name": "断么九", "han": 1 } ],
    "dora": 1,                                 // dora + red fives count
    "han_total": 3
  }
}
```

### `YakuRow`

```jsonc
{
  "key": "tanyao",
  "name": "断么九",
  "shanten": 2,            // 0 = tenpai, null = impossible (∞)
  "approx": false,         // true when the value is an approximation (pinfu at shanten >= 1)
  "ukeire": [ { "tile": "3m", "remaining": 3 } ],  // tile types (no red notation) that lower shanten
  "ukeire_total": 12       // sum of remaining
}
```

`remaining` = 4 − copies visible to the player at this node: `hand` + `drawn` (if any) +
`discards` + `dora_indicators`. The same visible set is used for `analysis` and every `by_discard` entry.
A tile type can appear with `remaining: 0` (空聴).

### Rows (fixed order)

| key | name |
|---|---|
| `normal` | 一般形（役なし） |
| `tanyao` | 断么九 |
| `pinfu` | 平和 |
| `iipeikou` | 一盃口 |
| `sanshoku` | 三色同順 |
| `ittsu` | 一気通貫 |
| `chanta` | 混全帯么九 |
| `junchan` | 純全帯么九 |
| `honitsu` | 混一色 |
| `chinitsu` | 清一色 |
| `toitoi` | 対々和 |
| `sanankou` | 三暗刻 |
| `haku` | 役牌 白 |
| `hatsu` | 役牌 發 |
| `chun` | 役牌 中 |
| `ton` | 役牌 東（場風・自風） |
| `chiitoitsu` | 七対子 |
| `kokushi` | 国士無双 |

## Definition of yaku shanten

For a 13-tile hand H and yaku Y:
`shanten_Y(H) = min over complete 14-tile hands W that satisfy Y (≤4 copies per tile) of |W \ H| − 1`
(multiset difference). Tenpai = 0. No such W → impossible (`null`).
Tile t is ukeire for Y iff t ∈ W \ H for some optimal W (equivalently drawing t lowers shanten_Y).

`normal` uses standard 4 melds + 1 pair only (chiitoitsu / kokushi have their own rows).

Pinfu: all four melds are sequences, the pair is not a yakuhai (白發中, 東), and the wait is ryanmen.
At shanten 0 the ryanmen condition is checked exactly (tenpai only if some winning tile completes a
pinfu shape with a ryanmen wait); at shanten ≥ 1 the value ignores the wait condition and `approx` is true.

## Implementation notes (backend, binding)

These clarify points the contract above leaves open; none changes the JSON shape.

- **Errors**: `400` invalid body/tile/`max_turns`, `403` non-loopback Host, `404` unknown
  session/node/endpoint, `415` POST without a JSON content type, `409` action not
  allowed at the current node (discard/tsumo at a terminal node, tsumo with an incomplete hand).
- **`seed`** defaults to a random value in `[0, 2^32)` (or the server's `--seed` flag). **`max_turns`**
  must be `1..109`; `0`/omitted means 18.
- **`by_discard`** is always present: `{}` unless `status == "playing"`. **`win`** is `null` unless `status == "tsumo"`.
- **`wall_remaining`** = 109 live draws − draws taken, where the draw shown at a playing node (or the
  winning tile at a tsumo node) counts as taken. Root: 108.
- **Tsumo node**: `turn` and `hand` (13 tiles) equal the parent's, `draw` = winning tile, `discard = null`.
  Its `analysis` is of the 13-tile hand; the winning tile counts as visible for `remaining`.
  Its `history[].shanten` is computed on the 14 winning tiles: `-1` for every row the win satisfies
  (pinfu: only if the win scored pinfu), otherwise the distance − 1 (≥ 0). E.g. a chiitoitsu or kokushi
  win has `chiitoitsu`/`kokushi` = `-1` but `normal` ≥ 0. `tree[].normal_shanten` is always `-1` for a
  tsumo node, whatever the winning shape.
- **Yaku shapes are containment-based** (a W satisfies Y if its tiles/groups meet Y's constraint):
  `honitsu` = tiles from one number suit + honors (a chinitsu shape counts), `chinitsu` = one number
  suit only, `chanta` = every group incl. the pair contains a terminal/honor (junchan/honroutou shapes
  count), `junchan` = every group contains a terminal and there are no honors, `toitoi` = 4 triplets,
  `sanankou` = at least 3 triplets (all concealed in solo play), `iipeikou` = two identical sequences,
  `haku/hatsu/chun/ton` = a triplet of 白/發/中/東. Consequently every row is always possible in
  Phase 1 (closed hands), so `shanten: null` does not occur yet; it is reserved for Phase 2 melds.
- **Pinfu**: at shanten ≥ 1 the value is "all sequences + pair not 白發中東" (`approx: true`). If that
  relaxed value is 0 but no winning tile gives a two-sided pinfu wait, the row reports `shanten: 1`,
  `approx: true`, and `ukeire` = draws after which some discard reaches exact pinfu tenpai.
- **Win evaluation** (`win.yaku`): 門前清自摸和 is always included; the reading with the most han is
  chosen; kokushi is reported alone with `han: 13`; four concealed triplets are reported as
  `sanankou` (suuankou is out of scope); 東 as round+seat wind is one entry `ton` with `han: 2`.
  `dora` counts indicator dora (9→1, 北→東, 中→白) plus red fives; `han_total` = yaku han + dora,
  except for yakuman (kokushi): `dora` is still reported but `han_total` stays 13.
- **Request guards** (all endpoints): the `Host` header must be a loopback name — `localhost`,
  `127.0.0.1` or another loopback IP, `[::1]`, any port — otherwise `403` (DNS-rebinding guard; this also
  means `--host 0.0.0.0` does not serve other machines). Every `POST` must send
  `Content-Type: application/json` (parameters such as `charset` allowed), otherwise `415`.
