# mhj2 HTTP API

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
  "dora": ["4z"],              // dora kind each indicator points to (no red notation)
  "ura_dora_indicators": [],     // the tiles below the dora indicators; [] until status != playing
  "ura_dora": [],                // kinds pointed to by ura_dora_indicators (Phase 1 has no riichi,
                                 // so ura dora are shown only and never scored)
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
  "yakuman": false,        // true for the yakuman rows (kokushi … chuuren)
  "han": 1,                // han for your hand (practice: closed, East round/seat); 13 for yakuman, 0 for "normal"
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

| key | name | yakuman |
|---|---|---|
| `normal` | 一般形（役なし） | |
| `tanyao` | 断么九 | |
| `pinfu` | 平和 | |
| `iipeikou` | 一盃口 | |
| `ryanpeikou` | 二盃口 | |
| `sanshoku` | 三色同順 | |
| `sanshoku_doukou` | 三色同刻 | |
| `ittsu` | 一気通貫 | |
| `chanta` | 混全帯么九 | |
| `junchan` | 純全帯么九 | |
| `honroutou` | 混老頭 | |
| `honitsu` | 混一色 | |
| `chinitsu` | 清一色 | |
| `toitoi` | 対々和 | |
| `sanankou` | 三暗刻 | |
| `shousangen` | 小三元 | |
| `haku` | 役牌 白 | |
| `hatsu` | 役牌 發 | |
| `chun` | 役牌 中 | |
| `ton` | 役牌 東（場風・自風） | |
| `chiitoitsu` | 七対子 | |
| `kokushi` | 国士無双 | ✓ |
| `suuankou` | 四暗刻 | ✓ |
| `daisangen` | 大三元 | ✓ |
| `tsuuiisou` | 字一色 | ✓ |
| `shousuushii` | 小四喜 | ✓ |
| `daisuushii` | 大四喜 | ✓ |
| `ryuuiisou` | 緑一色 | ✓ |
| `chinroutou` | 清老頭 | ✓ |
| `chuuren` | 九蓮宝燈 | ✓ |

`yakuman` is `true` exactly for the rows marked ✓ (a fixed property of the key).

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
- **A session's tree** holds at most 2000 nodes; a discard that would add another returns `409`.
- **`win`** lists the reading with the most han, then the most fu. The fu tie-break can pick, for
  example, 三暗刻 (40 fu) over 平和+一盃口 (20 fu) when both are the same han; `han_total` is the same.
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
  `haku/hatsu/chun/ton` = a triplet of 白/發/中/東. Consequently every row is always possible for a
  closed hand without melds, so `shanten: null` occurs only in games, after a call (see below).
  The other rows (4 melds + pair unless stated):
  - `ryanpeikou`: four sequences forming two pairs of identical sequences (the two pairs may be the
    same sequence, i.e. four copies of one sequence).
  - `sanshoku_doukou`: triplets of the same number in 萬子, 筒子 and 索子.
  - `honroutou`: every tile is a terminal or honor — four triplets + pair, **or** seven distinct
    terminal/honor pairs (chiitoitsu form); the row is the minimum over both forms.
  - `shousangen`: two dragon triplets + a dragon pair.
  - `suuankou`: four triplets + pair (all concealed in solo play, so it equals `toitoi` in Phase 1).
  - `daisangen`: triplets of 白, 發 and 中.
  - `tsuuiisou`: honors only — four triplets + pair, **or** seven distinct honor pairs (chiitoitsu form).
  - `shousuushii`: three wind triplets + a wind pair. `daisuushii`: four wind triplets. Neither
    contains the other, so `daisuushii` can be lower than `shousuushii` (e.g. `111222333444z5z`
    is daisuushii tenpai but shousuushii 1-shanten).
  - `ryuuiisou`: every tile in {2s 3s 4s 6s 8s 發} (發 is not required).
  - `chinroutou`: every tile is a terminal (1/9 of a number suit): four triplets + pair.
  - `chuuren`: `1112345678999` of one number suit plus any one more tile of that suit
    (so `1112345678999m` is tenpai on all nine 萬子).
- **Win evaluation vs. shanten rows**: the rows above are containment-based, but the win evaluation
  follows the scoring rules. In particular `chanta`/`junchan` score only with at least one sequence
  (an all-triplet terminal hand scores `toitoi`/`honroutou` instead), while their rows also count
  all-triplet shapes.
- **Pinfu**: at shanten ≥ 1 the value is "all sequences + pair not 白發中東" (`approx: true`). If that
  relaxed value is 0 but no winning tile gives a two-sided pinfu wait, the row reports `shanten: 1`,
  `approx: true`, and `ukeire` = draws after which some discard reaches exact pinfu tenpai.
- **Win evaluation** (`win.yaku`): the reading with the most han is chosen (a yakuman reading always
  wins); 東 as round+seat wind is one entry `ton` with `han: 2`. Without yakuman, 門前清自摸和 is always
  included. Closed han: `ryanpeikou` 3 (replaces `iipeikou`; a hand readable as both ryanpeikou and
  chiitoitsu takes the higher-scoring reading, normally ryanpeikou), `sanshoku_doukou` 2, `honroutou` 2
  (never with `chanta`/`junchan`; also with chiitoitsu), `shousangen` 2 (the dragon triplets also
  score their yakuhai).
  **Yakuman** (`kokushi`, `suuankou`, `daisangen`, `tsuuiisou`, `shousuushii`, `daisuushii`,
  `ryuuiisou`, `chinroutou`, `chuuren`): 13 han each, 26 for a double yakuman; several yakuman add up
  (e.g. `suuankou` + `tsuuiisou` + `daisangen` = 39, a triple yakuman). The double yakuman keep their
  key and have their own `name`: `suuankou` won on the pair (四暗刻単騎, ron or tsumo), `kokushi` whose
  13 tiles before the win held one of each kind (国士無双十三面待ち), `chuuren` whose 13 tiles before
  the win were exactly 1112345678999 of the suit (純正九蓮宝燈), and `daisuushii` (大四喜, always
  double). The analysis rows' `han` stays 13 for every yakuman. When any yakuman is present, only the
  yakuman are listed (no 門前清自摸和 or other yaku). A closed tsumo with four triplets is always
  `suuankou`. `dora` counts indicator dora (9→1, 北→東, 中→白) plus red fives; `han_total` = yaku
  han + dora, except for yakuman: `dora` is still reported but `han_total` is the yakuman han only.
- **Request guards** (all endpoints): the `Host` header must be a loopback name — `localhost`,
  `127.0.0.1` or another loopback IP, `[::1]`, any port — otherwise `403` (a DNS-rebinding guard
  against browsers; a network client can spoof the header, so `--host 0.0.0.0` does expose the API).
  Every `POST` must send `Content-Type: application/json` (parameters such as `charset` allowed),
  otherwise `415`. Responses carry `X-Content-Type-Options: nosniff` and forbid framing.

## Games against CPU players

A game is a 東風戦 (East round only) or 半荘戦 (East and South rounds): you
are seat 0, three CPU players take seats 1–3, and every player starts with
25000 points. The first dealer (起家) is `seed mod 4`, so your seat wind
depends on the seed. There is no rewinding. After each of your moves the server plays the CPU seats until you
have a choice again or the round ends; after a round ends you send `next`.

Round rules: riichi (closed, 1000 points, at least 4 draws left, tenpai after
the discard; after riichi only the drawn tile can be discarded, and the server
discards it for you unless you can tsumo), double riichi, ippatsu, ura dora,
haitei, houtei, furiten (own discards, same go-around, and after riichi), head
bump (no double ron), 3000-point noten penalty at the exhaustive draw, and the
abortive draws 九種九牌 (declared), 四風連打, 四家立直 and 四開槓. Points: no
kiriage mangan, counted yakuman at 13 han, yakuman multiples (a double yakuman or
stacked yakuman: `multiplier` = total yakuman han / 13, paying 32000 × n to a non-dealer
and 48000 × n to the dealer), honba 300 (ron) / 100 each (tsumo). No pao (責任払い).

Calls: pon and open kan on any other seat's discard, chii on the discard of
the seat to your left, and on your own turn a concealed kan or an added kan
onto your pon. After a discard every seat that can claim it answers in turn
order: a ron wins at once (head bump), otherwise a pon or kan beats a chii.
Declining a ron makes you furiten; declining a call does not. The last
discard of the round cannot be called, and a seat in riichi can only ron (or
make a concealed kan that keeps its waits). After a pon or chii you discard
without drawing and may not discard the called kind, nor the tile on the far
side after a chii on an end of the sequence (喰い替え). Each kan draws a
replacement tile (嶺上開花 if it wins), reveals another dora indicator and
shortens the live wall by one; an added kan can be robbed (槍槓). Calls end
ippatsu and the uninterrupted first go-around. Open hands lose the
closed-only yaku and a han on the kuisagari yaku.

Analysis with melds: `analysis`, `by_discard` and `history` go on after a
call. Every meld (chii, pon, kan, ankan) is a fixed group of each complete
hand W, so the shanten counts only the concealed tiles (13 - 3 per meld; the
tiles of a kan count toward the 4-copy limit). A meld may stand for a group
the yaku requires (e.g. the 中 pon for `chun`, a 456m chii for `ittsu`) or
for a free group the yaku's shape allows; a meld that fits neither makes the
row impossible (`shanten: null`), e.g. a 中 pon for `tanyao`. `sanankou`
counts only concealed triplets (an ankan counts). With any meld,
`chiitoitsu`, `kokushi`, `chuuren`, `pinfu` and `ryanpeikou` are impossible,
and the honroutou / tsuuiisou chiitoitsu forms drop out. After a chii, pon or
open kan the hand is open: `iipeikou` and `suuankou` are impossible too, and
`han` is the open-hand han: `sanshoku`, `ittsu`, `chanta`, `junchan`,
`honitsu` and `chinitsu` one lower (kuisagari), the closed-only rows 0. An
ankan keeps the hand closed. Right after a pon or chii there is no drawn
tile and you must discard before you can win: `by_discard` covers the legal
discards of your concealed tiles, and `analysis` keeps its 13-tile meaning as
the best you can reach with one of them. Each row is that row of the legal
discard with the lowest `shanten`, then the highest `ukeire_total`, then the
first in `legal.discards` order (a `null` row only when every discard gives
`null`), with that discard's `ukeire` and `approx`. So it is never `-1`.

Game rules: the dealer keeps the deal after winning, after a draw where the
dealer is tenpai, and after an abortive draw; otherwise the deal passes on.
Honba goes up by one when the dealer keeps the deal or after a draw, and back
to 0 when a non-dealer wins. Riichi sticks stay on the table until someone
wins. The game ends after the last round (East 4, or South 4) unless the last
dealer keeps the deal (no agari-yame), or as soon as someone is below 0 (no
West round). Standings rank by points (ties to the seat nearer the first
dealer); the score is (points − 30000) / 1000 + uma (+20 / +10 / −10 / −20)
+ oka (+20 to first), and sticks left at the end go to first place.

### `POST /api/games`
Body (optional): `{"seed": 42, "length": "hanchan"}`. `length` is `"tonpuu"`
(the default) or `"hanchan"`. Returns a `GameState`. Every round's wall is
derived one-way from the seed. Without a seed (and without the server's
`--seed` flag) a random seed in `[0, 2^53)` is used and `seed` stays `null`
until the game ends, because the seed rebuilds every wall.

### `GET /api/games/{id}`
Returns the `GameState`.

### `POST /api/games/{id}/action`
Body: `{"type": "discard", "tile": "5m"}`. `type` is one of:

| type | when | tile |
|---|---|---|
| `discard` | your turn | a tile from `legal.discards` |
| `riichi` | your turn | a tile from `legal.riichi` (declare riichi and discard it) |
| `tsumo` | `legal.tsumo` | – |
| `ron` | `legal.ron` (the tile is `last_discard`) | – |
| `skip` | `legal.skip`: pass on the claims you were offered (passing a ron makes you furiten) | – |
| `pon` | `legal.pon` (the tile is `last_discard`) | – (`tiles`: optionally the two tiles to use, e.g. with a red five) |
| `chii` | `legal.chii` | `tiles`: one of the pairs in `legal.chii` |
| `kan` | `legal.kan`: in the call phase an open kan of `last_discard`; on your turn a concealed or added kan | on your turn, `tile`: a kind from `legal.kan` |
| `kyuushu` | `legal.kyuushu`: your first uninterrupted turn with nine or more different terminals and honors (九種九牌, an abortive draw) | – |
| `next` | `can_next`: the round has ended and another follows | – |

Errors: `400` malformed body, unknown type or a tile you do not hold, `404`
unknown game, `409` a move that is not legal now.

### `GameState`

```jsonc
{
  "game_id": "a1b2c3",
  "seed": 42,                   // null until the game ends for a random seed
  "length": "tonpuu",           // "tonpuu" | "hanchan"
  "you": 0,
  "first_dealer": 2,            // 起家
  "dealer": 2,                  // seat of 東 this round
  "round_wind": "1z", "round_number": 1, "honba": 0,   // 東1局 0本場
  "can_next": false,            // the round has ended and another follows: send "next"
  "game_over": false,           // the last round has ended
  "standings": [ {"seat": 0, "rank": 1, "points": 25000, "score": 25.0} ],  // index = seat; score final once game_over
  "rounds": [ {"round_wind": "1z", "round_number": 1, "honba": 0, "kind": "ron",
               "winner": 1, "from": 0, "deltas": [-3900, 3900, 0, 0]} ],  // finished rounds; the current one last once it ends
  "phase": "discard",           // "discard" | "call" (claims on a discard or an added kan) | "ended"
  "actor": 0,                   // seat to act; -1 once ended
  "wall_remaining": 69,         // live draws left (70 after the deal)
  "deposit": 0,                 // riichi sticks on the table
  "dora_indicators": ["3m"], "dora": ["4m"],
  "ura_dora_indicators": [], "ura_dora": [],   // revealed when the round ends
  "seats": [                    // index = seat
    { "seat": 0, "wind": "3z", "points": 25000, "riichi": false,
      "river": [{"tile": "9s", "riichi": false, "called": false}],  // called: taken into another seat's meld
      "melds": [{"type": "pon", "tiles": ["7z", "7z", "7z"], "from": 3, "added": false}],  // "chii" | "pon" | "kan" | "ankan"; the called tile last; from -1 for an ankan
                                // added: a kan made by adding a tile to a pon (kakan); the added tile comes just before the called tile
      "hand_count": 14,             // concealed tiles, drawn tile included
      "hand": ["1m", "..."],    // present only for you, and for every seat once ended
      "drawn": "4p" }           // your drawn tile on your turn
  ],
  "last_discard": null,         // the tile you may claim, in the call phase
  "legal": { "discards": ["1m", "..."], "riichi": [], "tsumo": false, "ron": false, "skip": false, "kyuushu": false,
             "pon": false, "chii": [["3m", "4m"]], "kan": [] },
  "events": [ {"seat": 1, "type": "discard", "tile": "2z"},
              {"seat": 2, "type": "pon", "tile": "2z", "tiles": ["2z", "2z"]} ],  // moves since your previous move; no skips
  "analysis": [YakuRow],        // your hand of 13 - 3 per meld tiles, melds held fixed (right after a pon or chii: the best row over by_discard);
                                // wind rows follow your seat and the round
  "by_discard": { "1m": [YakuRow] },  // on your turn: rows after each legal discard
  "history": [HistoryEntry],    // this round: your rows at the start and after each of your discards (node_id = turn)
  "result": null                // Result once ended
}
```

The wind rows of `analysis` are `役牌 東（場風・自風）` (2 han) when you are
East, otherwise the round wind row then your seat wind row (1 han each).
`remaining` counts every river and the dora indicators as visible.

`Result`:

```jsonc
{
  "kind": "ron",                // "tsumo" | "ron" | "draw" | "abort"
  "reason": "",                 // abort: "kyuushu" | "suufon" | "suucha" (omitted otherwise)
  "winner": 1, "from": 0,       // -1 when not applicable
  "win_tile": "5p",
  "yaku": [{"key": "riichi", "name": "立直", "han": 1}],
  "han": 3, "fu": 40, "dora": 1, "ura_dora": 0,
  "points": { "limit": "", "multiplier": 0, "total": 5200, "ron": 5200 },
  // on a tsumo: "from_dealer" / "from_non_dealer" instead of "ron"
  // limit: "" | "mangan" | "haneman" | "baiman" | "sanbaiman" | "yakuman"
  // multiplier: yakuman count (2 = double, 3 = triple ...; 1 for a counted yakuman), else 0
  // yaku[].han: 13 per yakuman, 26 for a double yakuman form; "han" is their sum
  "deltas": [-5800, 6800, 0, 0], // points at the end minus at the start: the sum of the next three
  "hand_deltas":  [-5200, 5200, 0, 0],    // the hand's payments (or the noten penalty)
  "honba_deltas": [-600, 600, 0, 0],      // honba: 300 each from the discarder, or 100 from each seat on a tsumo
  "stick_deltas": [0, 1000, 0, 0],        // riichi sticks paid (-1000) and received (the winner takes the table)
  "honba": 2,
  "tenpai": [false, false, false, false],  // on a draw
  "deposit": 0                  // sticks left on the table after a draw (carried to the next round)
}
```
