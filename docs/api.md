# mhj-dojo engine requests

The page talks to its engine, the Go code built as WebAssembly (`cmd/mhj-dojo-wasm`), in a Web
Worker (`web/site-public/worker.js`, driven by `web/src/wasm.ts`). A request is an HTTP-style
method, path and JSON body — practice (`/api/sessions…`) or game (`/api/games…`), below — which
the worker's `mhjDojoRequest(method, path, body)` hands to `apicall.Route` (`internal/apicall`). It
returns `{status, body, save}`: an HTTP status code and a JSON body, the error ones
`{"error": "message"}` with a 4xx/5xx status ("Errors" under the implementation notes), and a game's save (see "Game saves").
There is no HTTP server behind it: `mhj-dojo` only serves the page's files. The worker also defines
two calls that are not requests: `mhjDojoRestore(body, query)`, which rebuilds a session from its
moves in one call after a page reload (`body` is `{"seed", "max_turns", "moves", "current"}`;
`query`, which may be left out, holds view options as a request's query does, see "View options"),
and `mhjDojoRestoreGame(save)`, which rebuilds a game from its save (see "Game saves").

The TypeScript types for these shapes are in `web/src/api.ts`.

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

## Requests

### `POST /api/sessions`
Body (all optional): `{"seed": 42, "max_turns": 18}`
If `seed` is omitted, a random seed is chosen. Returns a `State`.

### `GET /api/sessions/{id}`
Returns the `State` at the current node.

### `POST /api/sessions/{id}/discard`
Body: `{"tile": "5m", "node_id": 3}` – `tile` is the exact tile string from hand or `drawn`
(red matters: `0m` vs `5m`). `node_id` is optional: the node the page acted from (its
current `state.node_id`); if it doesn't match the session's current node, the request is
rejected with `409` and nothing changes (see Errors below). Omitting it acts on whatever node is
current.
Creates the child node, or moves to it if the same discard already exists. Returns the `State`.

### `POST /api/sessions/{id}/tsumo`
Body (optional): `{"node_id": 3}`, as `discard` above. Allowed only when `can_tsumo` is true.
Creates a terminal `tsumo` child node. Returns the `State`.

### `POST /api/sessions/{id}/goto`
Body: `{"node_id": 3}` – moves the current node. Returns the `State`. `node_id` names the
destination itself (it still exists: the tree only grows), so `goto` takes no staleness guard.

### View options

Every practice request above (`POST /api/sessions` included) takes two optional query
parameters, in its path after `?`, that leave parts of the returned `State` out, for a page that
doesn't need them:

- `advice=0` – `advice` and `discard_review` are `null`, and the advice is not computed (about
  2 ms, a sixth of a discard's time along the advice's best line). A discard made with it leaves
  the new node's review to be computed the next time the node is shown with the advice, so asking
  for the same state again without `advice=0` (say, once the page's advice panel opens) fills
  in both. `advice=1` is the default.
- `tree_from=<n>` – `tree` holds only the nodes with `node_id >= n`. Nodes are numbered in the
  order they are made and never change once made, so a page that holds the first `n` nodes
  (its tree's length) asks for the rest only and appends them; `node_count` tells it how many
  the whole tree has, a check that the two add up. `0` (the default) sends the whole tree; past
  the end, `tree` is `[]`.

Any other value is a `400` (`tree_from` is read as a decimal integer, a leading `+` allowed);
unknown parameters are ignored, and of a parameter given twice the last value counts. The UI sends `advice=0` while the
advice panel is minimized (opening it asks for the state shown again, with the advice), and
`tree_from` on every request but those that load a session afresh (a new one, the first of a page),
which take the whole tree.

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
  "hand_groups": [HandGroup],  // how `hand` splits into blocks (drawn tile excluded)
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
  "by_discard": { "5m": [DiscardRow], "...": [DiscardRow] },

  // Up to five yaku combinations for `hand`, best first (see Yaku combos),
  // and, only when status == playing, for each discard candidate as in by_discard.
  "combos": [ComboRow],
  "combos_by_discard": { "5m": [ComboRow] },

  // Unseen copies of every tile kind (34 keys, no red notation), which the ukeire
  // lists of analysis, by_discard and the combos count from (see YakuRow).
  "remaining": { "1m": 3, "2m": 4, "...": 4 },

  // Path from the root to the current node (inclusive), for the time-series chart.
  "history": [
    { "node_id": 0, "turn": 0, "draw": null, "discard": null,
      "shanten": { "normal": 3, "tanyao": 4, "honitsu": null /* impossible */ } }
  ],

  // Nodes in the whole tree, and the tree for the branch view: all of it, or the
  // nodes from tree_from on (see View options).
  "node_count": 1,
  "tree": [
    { "node_id": 0, "parent_id": null, "turn": 0, "draw": null, "discard": null, "status": "playing", "normal_shanten": 3 }
  ],

  // Only when status == tsumo.
  "win": {
    "tiles": ["..."],                          // 14 tiles
    "yaku": [ { "key": "tanyao", "name": "断么九", "han": 1 } ],
    "dora": 1,                                 // dora + red fives count
    "han_total": 3
  },

  // Only when status == playing: ranked discards and notes (see Advice).
  // null with advice=0.
  "advice": Advice,
  // Only at a node reached by a discard (null at the root and at tsumo
  // nodes): that discard compared with the best one at the parent.
  // null with advice=0.
  "discard_review": Review
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
  "ukeire": ["3m", "6m"],  // tile types (no red notation) that lower shanten
  "ukeire_total": 12       // their unseen copies: the sum of remaining[t] over ukeire
}
```

The state's `remaining[t]` = 4 − copies of `t` visible to the player at this node: `hand` + `drawn`
(if any) + `discards` + `dora_indicators`. The same visible set is used for `analysis` and every
`by_discard` entry, so one map serves every ukeire list of the state. A tile type can be ukeire with
`remaining` 0 (空聴).

### `DiscardRow`

A row of a `by_discard` preview: a `YakuRow` without `name`, `yakuman` and `han`, which depend only
on the key within one state; the state's `analysis` has a row of every key with them.

```jsonc
{ "key": "tanyao", "shanten": 1, "approx": false, "ukeire": ["2p"], "ukeire_total": 3 }
```

### `HandGroup`

```jsonc
{ "type": "seq", "tiles": [0, 3, 5] }   // tiles: indexes into `hand`
```

`hand_groups` split the concealed `hand` (the drawn tile is never included)
into blocks for display. Each index of `hand` appears in exactly one group,
so equal tiles are told apart. `type` is one of:

| type | block |
|---|---|
| `seq` | sequence (順子) |
| `trip` | triplet (刻子) |
| `pair` | the pair (雀頭) |
| `ryanmen` | two-sided taatsu (両面), e.g. 34m |
| `kanchan` | closed taatsu (嵌張), e.g. 35m |
| `penchan` | edge taatsu (辺張), 12 or 89 |
| `toitsu` | a pair other than the pair (対子) |
| `float` | every tile in no block (浮き牌), as one group |

Groups come melds first (in tile order), then the pair, the taatsu (in tile
order) and last the float group; empty classes are left out. The split is one
normal-form (4 melds + 1 pair) decomposition only; chiitoitsu and kokushi
shapes are not considered. Among all splits it picks the one with the lowest
normal shanten, `8 − 2 × (melds + called melds) − taatsu − pair` with
melds + taatsu ≤ 4 − called melds, using the same 4-copy rules as the
`normal` row (a taatsu whose waits are all in the hand does not count, and a
hand without a pair needs a floating tile it does not hold four of), so it
always has the `normal` row's shanten for the concealed tiles. Ties go, in
order, to more melds, having a pair, better taatsu (more ryanmen, then more
toitsu, more kanchan, more penchan), more floating terminals and honors, and
finally the first split found scanning kinds 1m → 7z (at each kind:
sequence, triplet, pair, toitsu, ryanmen/penchan, kanchan, float). Red fives
count as fives.

### Advice

Rule-based advice for the pending discard (`internal/advice`): the same
position always gets the same advice. The text fields are Japanese.

```jsonc
{
  "candidates": [                 // the best three distinct discards, best first
    { "tile": "9m",               // exact tile; a plain five is offered before a red one
      "shanten": 1,               // shanten of the 13 tiles left (lowest of normal, chiitoitsu, kokushi)
      "ukeire_kinds": 8,          // tile types that lower it
      "ukeire": 28,               // their unseen copies (4 − visible copies, as ukeire_total)
      "wait": 5.8,                // expected tenpai wait (0.1 steps); null above 1-shanten
      "yaku": ["断么九"] }         // near yaku of the 13 tiles left (see below)
  ],
  "junme": 4,                     // the discard being chosen: turn + 1
  "phase": "early",               // early (junme 1–6) | middle (7–12) | late (13+, or draws_left ≤ 5)
  "guideline": "序盤は受け入れの広さと好形を優先。…",
  "draws_left": 14,               // draws after this discard: max_turns − turn − 1
  "tenpai_chance": 0.62,          // after the best discard, 0..1 (0.001 steps)
  "win_chance": 0.21,
  "shape": "打 9萬 後: 面子2・両面2・嵌張1・雀頭あり。浮き牌は 北",  // hand_groups-style split; when chiitoitsu or kokushi gives the shanten: "七対子: 対子6。浮き牌は 2筒" / "国士無双: 12種・対子なし"
  "near_yaku": [ { "key": "tanyao", "name": "断么九", "han": 1, "shanten": 1, "kept": true } ],
  "notes": ["打 9萬 と打 北 はどちらも1向聴。9萬 を切るほうが有効牌が4枚多い（28枚と24枚）。…"]
}
```

**Ranking.** Every distinct discard kind is compared by, in order:
1. shanten (lower first): the lowest of the normal form, chiitoitsu and
   kokushi (concealed hands only), as the CPU counts it;
2. `ukeire` (more first), counted like `by_discard`: 4 − visible copies, over
   the union of the ukeire of every form reaching that shanten;
3. `wait` (more first), only between two discards at tenpai or 1-shanten. At
   tenpai it is the wait itself (= `ukeire`). At 1-shanten: for each ukeire
   type with unseen copies, draw it (it becomes visible), try every discard,
   and take the most unseen waits of any tenpai reached (in any of the three
   forms, so a chiitoitsu tanki or kokushi wait counts); `wait` is the average
   of those, weighted by the unseen copies of each ukeire type. Waits are
   compared as shown, rounded to 0.1, so closer ones tie;
4. near yaku of the 13 tiles left: rows other than `normal` and the yakuman
   whose shanten is ≤ max(1, the discard's normal-form shanten) — more rows first,
   then more total `han`;
5. dora kept: a dora kind or red five is discarded last; then terminals and
   honors before simples; then kind order.

**Chances.** A step model over `draws_left` draws: from the best discard's
shanten *s*, each draw advances one step with probability *u* / *n*, where
*n* is the unseen tile count (136 − visible) and *u* is that discard's
`ukeire` for the steps up to tenpai and, for the winning step, its `wait`
(at tenpai or 1-shanten) or min(`ukeire`, 6) (further away). `tenpai_chance`
is the probability of having made *s* steps (1 at tenpai), `win_chance` of
*s* + 1. Later steps reuse the first step's count, so it is a rough guide
only (no calls, riichi or other players).

**Phase and notes.** `guideline` gives the phase's rule of thumb (序盤: wide
acceptance and good shapes, isolated honors and terminals first; 中盤: speed
to tenpai; 終盤: says so when `tenpai_chance` < 0.3, and at the last discard,
`draws_left` = 0, says no draw follows). The last 5 draws are 終盤 whatever
the junme, so a short game (small `max_turns`) never shows 序盤 advice at its end. `notes[0]` explains the
first two candidates by the first key that differs; a further note names the
near yaku the best discard gives up. `near_yaku` lists up to 6 rows (the
yakuman aside) whose best shanten over all discards is ≤ max(1, the lowest
normal-form shanten over all discards), closest first; `kept` is whether the best discard keeps
that shanten.

### Review

```jsonc
{ "tile": "5p", "best": "9m", "rank": 3, "is_best": false,
  "shanten": 1, "best_shanten": 1, "ukeire": 22, "best_ukeire": 28,
  "text": "前巡の打 5筒: 最善（打 9萬）より有効牌が6枚少ない（22枚と28枚、3位）" }
```

The discard that led to this node, ranked among the parent's discards by the
first three keys above (ties share a rank; `is_best` = rank 1, which a
different tile tied with the best also gets — except a red five discarded
while a plain copy of it was held: that gives up a dora for nothing, so it
keeps rank 1 but `is_best` is false and the text says 赤ドラを失う). It is computed once, when the
node is created, and kept with the node, so it shows again after `goto`.

### Yaku combos

`combos` lists combinations of two or more non-yakuman yaku that one complete
hand can score together, with the shanten toward such a hand:

`shanten_{Y1..Yn}(H) = min over complete W satisfying every Yi in one reading of |W \ H| − 1`

and its ukeire (as for a single row). The yaku come from `tanyao`, `pinfu`,
`iipeikou`, `sanshoku`, `sanshoku_doukou`, `ittsu`, `chanta`, `junchan`,
`honroutou`, `honitsu`, `chinitsu`, `toitoi`, `shousangen`, the dragon rows,
the value-wind rows and `chiitoitsu` (seven pairs combines only with `tanyao`,
`honroutou`, `honitsu` and `chinitsu`). Not combined: `ryanpeikou`,
`sanankou`, the yakuman, pairs where one yaku replaces the other (chanta /
junchan, honitsu / chinitsu), pairs no hand scores together (chanta or
junchan with toitoi or honroutou), pairs whose hands are really another yaku
(tanyao or junchan with honitsu = chinitsu, chanta with chinitsu = junchan),
and all three dragons (daisangen). In a combination `chanta` and `junchan`
need a sequence, as the win evaluator scores them (their rows also count the
all-triplet hands, which are honroutou or chinroutou). `shousangen` always
counts its two dragon triplets: its name reads `小三元（役牌×2込み）` and it
adds 4 han; it is not combined with the dragon rows. A combination counts
only the yaku it names: an `iipeikou` combination may be completed as a
ryanpeikou hand, and a closed `toitoi` one as a sanankou or suuankou hand,
without that showing in its han. East/East practice has 295 combinations.

```jsonc
{
  "keys": ["tanyao", "pinfu", "sanshoku"],  // row keys, in row order
  "name": "断么九＋平和＋三色同順",          // row names joined with ＋
  "han": 4,                // sum of the rows' han (open-hand han after a call); dora not counted
  "shanten": 0,            // never null: impossible combinations are not listed
  "approx": false,         // true for a pinfu combination at shanten >= 1 (as the pinfu row)
  "ukeire": ["4s"],        // counted by the state's remaining, as for a row
  "ukeire_total": 3
}
```

Pinfu combinations follow the pinfu row: exact at tenpai (a winning tile must
give a reading with a two-sided wait that also satisfies the other yaku),
relaxed and `approx` otherwise. With melds the combinations follow the rows
(fixed groups, closed-only yaku dropped, kuisagari han).

Ranking (`yakushanten.Combos`):

1. Sort by `2 × shanten − value`, where value = han capped at 5 (mangan), +1
   from 6 han (haneman) and +1 more from 8 han (baiman): one step toward tenpai
   weighs as much as two han. Ties: more han, then a fixed list order.
2. Drop a combination when one with more yaku that contains it has the same
   shanten (it scores more for the same work).
3. Drop a combination that differs from a better-ranked one only in which
   value tiles (dragons, winds) it uses, with the same han and shanten.
4. Keep the first five.

The engine evaluates the combinations best-first by a lower bound (the largest
shanten among each combination's own rows) and stops once no remaining one can
enter the top five; within a combination's target family it also stops at the
first member that reaches the distance that bound implies (for pinfu the
bound uses 0 when its row is 1 from the fallback: a relaxed tenpai without a
two-sided wait still has distance 1); `TestCombosPruneMatchesFull` checks this gives the same
result as evaluating all of them, and `TestCombosMatchBruteForce` checks every
combination against a brute-force definition (for East/East and for split
winds). With the combos, analysing every discard candidate of a random closed
hand (`TestAnalyzeAllDiscardsP95`) takes p95 ~30 ms on a developer machine
(the rows alone took ~23 ms before the suit-table DP skipped unreachable
states and the rows shared the combos' fold cache), within the 100 ms budget
(GitHub's runners are about 2.5x slower); the same test times all-sequence
worst cases (`worstHands`) at ~18-34 ms each.

Right after a pon or chii (game mode), `combos` is the list of the legal
discard whose first combination ranks best (lowest rank, then more han, then
the highest `ukeire_total`, then the first in `legal.discards` order), like
`analysis` there.

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
W counts as won by tsumo: a triplet the winning tile completes is concealed for `sanankou` and
`suuankou`. On a ron it would be open, so e.g. the shanpon wait `111m222p333s44z55z` is suuankou
tenpai on 4z/5z by tsumo only (`yaku.Evaluate`, which scores real wins, counts it as open; this matters only in CPU
games, since practice sessions win by tsumo only).

`normal` uses standard 4 melds + 1 pair only (chiitoitsu / kokushi have their own rows).

Pinfu: all four melds are sequences, the pair is not a yakuhai (白發中, 東), and the wait is ryanmen.
At shanten 0 the ryanmen condition is checked exactly (tenpai only if some winning tile completes a
pinfu shape with a ryanmen wait); at shanten ≥ 1 the value ignores the wait condition and `approx` is true.

## Implementation notes (engine)

These clarify points the contract above leaves open; none changes the JSON shape.

- **Errors**: `400` invalid body/tile/`max_turns`/view option, `404` unknown
  session/node/request path, `409` action not
  allowed at the current node (discard/tsumo at a terminal node, tsumo with an incomplete hand,
  or a `node_id` that no longer matches the current node; of two tabs the page stops the older
  one before that can happen),
  `422` a session's tree is already at its node cap (see below) — not a state conflict: the
  current node itself is fine to act on.
  The page's side of the worker (`web/src/wasm.ts`) adds two of its own, which never reach the
  engine: `409` when a save another tab wrote can't be rebuilt here (that tab may run a newer
  engine; the page asks for a reload), and `423` when another tab has taken the session or game
  over.
- **`seed`** defaults to a random value in `[0, 2^32)`. **`max_turns`**
  must be `1..109`; `0`/omitted means 18.
- **`by_discard`** and **`combos_by_discard`** are always present: `{}` unless `status == "playing"`. **`win`** is `null` unless `status == "tsumo"`.
  **`advice`** is `null` unless `status == "playing"`; **`discard_review`** is `null` at the root and at tsumo nodes
  (an exhausted node has one); both are `null` with `advice=0`. Like `by_discard`, the full advice and the combos are kept only for the current node (see Memory);
  each node keeps just its small review. Computing the advice takes ~2 ms per discard along the advice's
  best line (`internal/session/advice_test.go`'s `TestPracticeActionP95` plays whole games along the advice:
  discard p95 ~20 ms including the rest of the state), which `advice=0` saves.
- **A session's tree** holds at most 2000 nodes; a discard that would add another returns `422`.
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
  `ryuuiisou`, `chinroutou`, `chuuren`, and in games `tenhou`, `chiihou`): 13 han each, 26 for a double yakuman; several yakuman add up
  (e.g. `suuankou` + `tsuuiisou` + `daisangen` = 39, a triple yakuman). The double yakuman keep their
  key and have their own `name`: `suuankou` won on the pair (四暗刻単騎, ron or tsumo), `kokushi` whose
  13 tiles before the win held one of each kind (国士無双十三面待ち), `chuuren` whose 13 tiles before
  the win were exactly 1112345678999 of the suit (純正九蓮宝燈), and `daisuushii` (大四喜, always
  double). The analysis rows' `han` stays 13 for every yakuman. When any yakuman is present, only the
  yakuman are listed (no 門前清自摸和 or other yaku). In games `tenhou` (天和) and `chiihou` (地和) are
  13-han yakuman too, stacking with the hand's own (see the round rules). For `tenhou` the winning tile
  is the dealer's 14th tile (its first draw), so the double forms that depend on the wait (国士無双十三面待ち,
  四暗刻単騎, 純正九蓮宝燈) depend on which tile that was. A closed tsumo with four triplets is always
  `suuankou`. `dora` counts indicator dora (9→1, 北→東, 中→白) plus red fives; `han_total` = yaku
  han + dora, except for yakuman: `dora` is still reported but `han_total` is the yakuman han only.

## Games against CPU players

A game is a 東風戦 (East round only) or 半荘戦 (East and South rounds): you
are seat 0, three CPU players take seats 1–3, and every player starts with
25000 points. The first dealer (起家) is `seed mod 4`, so your seat wind
depends on the seed, unless you ask to be the first dealer
(`"first_dealer": "you"`); the walls are the same either way. There is no
rewinding. After each of your moves the engine plays the CPU seats until you
have a choice again or the round ends; after a round ends you send `next`.

Round rules: riichi (closed, costs a 1000-point stick and needs at least 1000
points, at least 4 draws left, tenpai after the discard; after riichi only the
drawn tile can be discarded, and the engine discards it for you unless you can
tsumo), double riichi, ippatsu, ura dora, haitei, houtei, 天和 / 地和
(`tenhou` / `chiihou`: a yakuman tsumo on the dealer's / a non-dealer's first
draw with no call, concealed kan included, before it; never on a ron or a
rinshan draw), furiten (own
discards, same go-around, and after riichi), head bump (no double ron),
3000-point noten penalty at the exhaustive draw, and the abortive draws 九種九牌
(declared), 四風連打, 四家立直 and 四開槓; no nagashi mangan (流し満貫). Points: no kiriage mangan, a pair of a wind
that is both the round and the seat wind is 4 fu (2 per reason, as for any
value pair), counted yakuman at 13 han, yakuman multiples (a double yakuman or
stacked yakuman: `multiplier` = total yakuman han / 13, paying 32000 × n to a
non-dealer and 48000 × n to the dealer), honba 300 (ron) / 100 each (tsumo).

Pao (包, 責任払い): a seat whose discard the winner called (pon or open kan)
to complete the third dragon meld (大三元), the fourth wind meld (大四喜) or
the fourth kan (四槓子, only when that kan is an open kan) is responsible for
that yakuman. A concealed kan or an added kan never makes a seat responsible.
On a tsumo the responsible seat pays that yakuman in full (32000, or 48000 to a
dealer; 大四喜 counts double), and all the honba when its pao covers the whole
hand. On a ron by another seat's discard the discarder and the responsible seat
pay half of that yakuman each (rounded up to 100) and the discarder pays the
honba; when the responsible seat deals in, it pays as a normal ron. Other
yakuman stacked in the hand are paid as usual (shared on a tsumo, by the
discarder on a ron), and two yakuman with different responsible seats are each
paid by their own seat. Riichi sticks go to the winner as usual.

Calls: pon and open kan on any other seat's discard, chii on the discard of
the seat to your left, and on your own turn a concealed kan or an added kan
onto your pon. After a discard every seat that can claim it answers in turn
order: a ron wins at once (head bump), otherwise a pon or kan beats a chii.
Declining a ron makes you furiten, and so does passing a winning tile you cannot ron for lack of a yaku; declining a call does not. The last discard
of the round cannot be called, and a seat in riichi can only ron (or make a
concealed kan that keeps its waits). After a pon or chii you discard without
drawing and may not discard the called kind, nor the tile on the far side
after a chii on an end of the sequence (喰い替え). Each kan draws a replacement
tile (嶺上開花 if it wins), adds a dora indicator and shortens the live wall by
one; an added kan can be robbed (槍槓), a concealed kan cannot (not even for
国士無双). A concealed kan's indicator is turned over at once, so its replacement
tile already counts it. An open or added kan's indicator is turned over when
the declarer discards, before the other seats answer that discard (後めくり): a
win on the replacement tile does not count it, a ron on that discard (槓振り)
does, ura dora included. If the declarer makes another kan before discarding,
the earlier kan's indicator is turned over when the new kan completes. House
rule: a robbed added kan never completes, so neither it nor an earlier open
kan of the same turn turns an indicator over, and the chankan scores without
them. The ura-dora indicators are the tiles below the dora indicators turned
over when the round ends. Calls end ippatsu and the uninterrupted first
go-around. Open hands lose the closed-only yaku and a han on the kuisagari
yaku.

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

CPU players (`cpu`): `"normal"` (普通) takes every win, declares riichi when
tenpai unless every tile of its wait is in sight (it then breaks the wait
for a one-step-back hand with tiles left, if any), calls when the hand keeps a
yaku (a value triplet, tanyao, or within two steps of tenpai honitsu, toitoi
or a value pair made a triplet later), makes a concealed or added kan when it
does not set the hand back, discards for tile efficiency (lowest shanten,
then most unseen accepting tiles; an open hand first toward its yaku) and
folds against a riichi when two or more steps from tenpai, or one step
against two riichi or with a cheap hand (no dora, not the dealer). Folding,
it discards the safest tile: tiles the riichi seat discarded or let pass
after its riichi, then suji and kabe (no-chance) tiles and seen honors.
`"weak"` (弱い) also
takes every win and declares riichi when tenpai, but never calls or declares
a kan, never folds, and on about every other discard picks any discard that
keeps the lowest shanten instead of the most efficient one. That pick is a
hash of the round's wall, the seat and the progress of the round rather than a
random draw, so a seed with the same options and moves always plays out the
same.

### `POST /api/games`
Body (optional): `{"seed": 42, "length": "hanchan", "first_dealer": "you",
"cpu": "weak"}`. `length` is `"tonpuu"` (the default) or `"hanchan"`;
`first_dealer` is `"random"` (the default: `seed mod 4`) or `"you"`; `cpu` is
`"normal"` (the default) or `"weak"`. Any other value is a `400`. Returns a
`GameState`. Every round's wall is
derived one-way from the seed. Without a seed a random seed in `[0, 2^53)` is used and `seed` stays `null`
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

### Game saves

The WebAssembly engine keeps games in the tab's memory only, so the page keeps
a save of each game to rebuild it after a reload or an eviction (see Memory).
The CPU players decide deterministically, so a game is rebuilt by replaying
the human's moves on the same seed and options.

- `mhjDojoRequest(method, path, body)` returns `{status, body, save}`. `save`
  is a JSON string (below) when `body` is a `GameState` (`POST /api/games`,
  `GET /api/games/{id}` and `POST /api/games/{id}/action` with status `200`),
  and `""` for any other response (practice, errors). Take each new
  save as the game's latest.
- `mhjDojoRestoreGame(save)` takes such a save string and returns
  `{status, body, save}` like a request: `200` with the rebuilt game's
  `GameState` and its save, or an error (`400` a malformed save or an invalid
  option or move, `409` a move that is not legal where it is replayed, or a
  replay that does not match the save's `check`). The
  game gets a **new** `game_id`, as `mhjDojoRestore` gives a session a new id:
  the page keeps its own id for the game and maps it to the engine's current
  one. Its state equals the saved game's (the events of the last move
  included), the id aside; a seed the player did not choose stays `null`.
  Replaying a whole 半荘戦 takes ~0.17 s natively (the state is built only
  once, at the end, and the per-discard history analysis only for the last
  round, the one the state shows).

The save (`match.Save`):

```jsonc
{
  "seed": 1234567890123,     // the game's seed, also while GameState.seed is null: don't show it
  "seed_known": false,       // the player chose the seed (GameState shows it)
  "length": "tonpuu",        // the options, filled in: tonpuu|hanchan
  "first_dealer": "random",  // random|you
  "cpu": "normal",           // normal|weak
  "actions": [               // the human's successful moves in order, "next" included
    {"type": "discard", "tile": "5m"},
    {"type": "chii", "tiles": ["3m", "4m"]},
    {"type": "next"}
  ],
  "check": "8c3f0e2a91b4d7c5" // FNV-1a digest of every round's moves, CPU moves included
}
```

An action is the body of `POST /api/games/{id}/action` as it was accepted
(`tile` and `tiles` are left out when empty). Moves that failed are not
recorded, nor are the discards the engine plays for you in riichi. `check`
guards against a save made by another engine version (say, one whose CPU
plays differently after a deploy): the same moves would replay into another
game, so a replay whose moves differ from the digest is refused with `409`
("save does not match this engine") instead. A save without `check` is not
checked. The seed in the save is not a security boundary: `localStorage` and
the WebAssembly memory can both be inspected, so hiding it only keeps it out of
sight during play. Treat the save as opaque: keep the string as it is rather than re-encoding it, since a
seed chosen above 2^53 is exact only in the string. A 半荘戦 save is ~6–7 KB, well
under the 64 KiB body limit.

### `GameState`

```jsonc
{
  "game_id": "a1b2c3",
  "seed": 42,                   // null until the game ends for a random seed
  "length": "tonpuu",           // "tonpuu" | "hanchan"
  "first_dealer_mode": "random", // the first_dealer asked for: "random" | "you"
  "cpu": "normal",              // "normal" | "weak"
  "you": 0,
  "first_dealer": 2,            // 起家: the seat
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
      "river": [{"tile": "9s", "riichi": false, "called": false}],  // riichi: the declaration tile (not when it was ronned); called: taken into another seat's meld
      "melds": [{"type": "pon", "tiles": ["7z", "7z", "7z"], "from": 3, "added": false}],  // "chii" | "pon" | "kan" | "ankan"; the called tile last; from -1 for an ankan
                                // added: a kan made by adding a tile to a pon (kakan); the added tile comes just before the called tile
      "hand_count": 14,             // concealed tiles, drawn tile included
      "hand": ["1m", "..."],    // present only for you, and for every seat once ended
      "hand_groups": [HandGroup],  // your seat only: blocks of hand, melds counted as called melds
      "drawn": "4p" }           // your drawn tile on your turn
  ],
  "last_discard": null,         // the tile you may claim, in the call phase
  "legal": { "discards": ["1m", "..."], "riichi": [], "tsumo": false, "ron": false, "skip": false, "kyuushu": false,
             "pon": false, "chii": [["3m", "4m"]], "kan": [] },
  "events": [ {"seat": 1, "type": "discard", "tile": "2z", "wall_remaining": 70},
              {"seat": 2, "type": "pon", "tile": "2z", "tiles": ["2z", "2z"], "wall_remaining": 70} ],  // moves since your previous move; no skips
                                // wall_remaining: live draws left right after the move (an open or concealed kan's replacement
                                // draw included, an added kan's with the declarer's next move, the next seat's draw not);
                                // new_dora_indicators: kan dora indicators the move turned over (a concealed kan's at once, an
                                // open or added kan's on the declarer's next discard or kan; one turned over with no move of its own,
                                // as an added kan completes, on the response's last move), omitted if none. None is reported
                                // twice: a round's new_dora_indicators add up to dora_indicators[1:]
  "events_from": 12,            // the round's index of events[0]: the round's earlier events came in earlier responses
  "events_wall_remaining": 70,  // live draws left just before events[0] (its mover's draw taken); wall_remaining with no events
  "analysis": [YakuRow],        // your hand of 13 - 3 per meld tiles, melds held fixed (right after a pon or chii: the best row over by_discard);
                                // wind rows follow your seat and the round
  "by_discard": { "1m": [DiscardRow] },  // on your turn: rows after each legal discard
  "combos": [ComboRow],         // yaku combos of your hand (right after a pon or chii: the best discard's, see Yaku combos)
  "combos_by_discard": { "1m": [ComboRow] },  // on your turn: combos after each legal discard
  "remaining": { "1m": 3, "...": 4 },  // unseen copies of every tile kind, for the ukeire lists (see YakuRow)
  "history": [HistoryEntry],    // this round: your rows at the start and after each of your discards (node_id = turn)
  "advice": Advice,             // on your turn with a drawn tile and a concealed hand (no calls or kans), not in riichi, no tsumo offered; else null
  "danger": [ {"seat": 2, "tiles": {"5p": 3, "1z": 0}} ],  // on your turn: each other seat in riichi, rating every tile you hold
                                // (hand and drawn): 0 safe, 1 low, 2 medium, 3 high; [] otherwise
  "result": null                // Result once ended
}
```

The wind rows of `analysis` are `役牌 東（場風・自風）` (2 han) when you are
East, otherwise the round wind row then your seat wind row (1 han each).
`remaining` counts every river and the dora indicators as visible.

`advice` is the practice [Advice](#advice) for the discard: it ranks the
14 concealed tiles for speed only (no defense), so it is left out once you
have called or declared a kan, whose hands it does not model, in riichi, and
when you can tsumo.
`junme` is your discards so far + 1, and `draws_left` your draws left: a
quarter of `wall_remaining`, rounded down (ignoring calls). `danger` is the
CPU's own folding judgment (`cpu.DangerLevel`) against that seat: 0 for
genbutsu (a kind in that seat's own river, or one any seat discarded after its
riichi) or an honor with all 4 visible, 1 for a number tile with no two-sided
wait left on it (suji, or no-chance: all 4 of a tile of that wait in sight)
or an honor with 2–3 visible, 2 for one of two two-sided waits ruled out or
another honor, 3 for other terminals, 2/8 and middle tiles (the CPU's 0–9
score `cpu.Danger`: 0, 1–3, 5–6, 7–9). Both are derived from the table, so saves and replays are
unaffected.

`Result`:

```jsonc
{
  "kind": "ron",                // "tsumo" | "ron" | "draw" | "abort"
  "reason": "",                 // abort: "kyuushu" | "suufon" | "suucha" | "suukaikan" (omitted otherwise)
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
  "honba_deltas": [-600, 600, 0, 0],      // honba: 300 each from the discarder, or 100 from each seat on a tsumo (pao: see the rules)
  "stick_deltas": [0, 1000, 0, 0],        // riichi sticks paid (-1000) and received (the winner takes the table)
  "honba": 2,
  "tenpai": [false, false, false, false],  // on a draw
  "deposit": 0,                 // sticks left on the table after a draw (carried to the next round)
  "pao": []                     // 包 (responsible seats) for yakuman the win scored, e.g.
                                // [{"seat": 0, "yaku": "daisangen"}]; yaku: "daisangen" | "daisuushii" | "suukantsu"
}
```

## Memory

The engine keeps two in-memory stores, each evicting its least recently used
entry once full (`internal/store`; a `Get` marks an entry most recently used,
so one the page keeps acting on stays in). Each session or game owns a
`yakushanten.Analyzer`, and a game's three CPU seats additionally share one
`cpu.Player`; each keeps a shanten memo bounded as described under "Memo
bounds" below (at most ~9 MiB per analyzer and ~1 MiB per CPU player).

The WebAssembly build (`cmd/mhj-dojo-wasm`) keeps at most 4 sessions and
2 games (the `max` argument of `session.NewStore` and `match.NewStore`), so
the stores hold at most about 4 x 9.8 + 2 x 10.5 = ~60 MiB of memos and trees
(a few MiB more while a memo turns over). It runs in a browser tab's memory,
and the engine is single-threaded (no per-session or per-game locks). Go's wasm
runtime never returns freed heap pages to the OS, so a session's cost (its
branch tree plus its own analyzer memo, up to ~9.8 MiB) only ever grows the
tab's memory until the store evicts it. A session evicted this way, or lost
to a reload, is rebuilt from its moves on its next request
(`mhjDojoRestore`, `web/src/wasm.ts`), so revisiting an old game by URL still
works; `web/e2e/practice-saves.spec.ts` checks the eviction and rebuild
together.

A game holds its analyzer memo and its CPU players' memo, and an evicted or
reloaded game is rebuilt from its save (`mhjDojoRestoreGame`, "Game saves").

Measured with `internal/match/memory_test.go`'s `BenchmarkGameMemory` and
`internal/session/memory_test.go`'s `BenchmarkSessionMemory` (not run by
`go test ./...`; each plays or grows N real games/sessions, then divides the
`runtime.MemStats` `HeapAlloc` delta, after a `runtime.GC()`, by N — run with
`go test ./internal/<pkg> -run '^$' -bench BenchmarkXMemory -benchtime=1x`):

- **A finished 半荘戦 game**, played out with the real CPU: ~1.7 MiB when first
  measured, while the analyzer still started each round with an empty memo.
  Since the memo carries over to the next round (`Analyzer.ForWinds`) it was
  ~15.5 MiB under the old reset-at-200,000-tables cap, and is ~7.7 MiB with
  the bounds below (the analyzer's memo is full by the end of a 半荘戦).
- **A session's branch tree at its `MaxNodes` = 2000 cap** (reached by
  branching into every distinct discard at every node): originally ~84 MiB,
  256 such sessions ≈ 21 GiB — alarming, and not explained by the analyzer's
  memo above. `state()` used to report every tree node's `normal_shanten` by
  running the *whole* per-yaku analysis (30+ rows with ukeire) and caching it
  on the node forever just to read that one field, so a heavily branched
  session's cache grew with its whole tree instead of resetting like the
  memos above.

  Fixed in two parts (`internal/yakushanten/yakushanten.go`,
  `internal/session/session.go`, `internal/session/view.go`):
  - `Analyzer.NormalShanten` computes only the normal-form row (one target
    family) instead of every row; `state()`'s tree-wide loop now calls it and
    caches just that one int per node, permanently (`TestNormalShantenMatchesAnalyze`
    checks it against `Analyze`'s "normal" row on random hands).
  - The *full* per-yaku analysis and per-discard preview — genuinely needed
    only for the current node and its history path (`state()`'s `analysis`
    and `history` fields) — are now pruned once a node is no longer on that
    path (`pruneAnalysisCache`), instead of being kept forever. A node whose
    cache was pruned just recomputes it, from the still-memoized suit
    tables, if it's revisited.
  - The `history` field only needs each row's shanten, which every node
    keeps permanently once known (`rowShanten`, one byte per row), so
    switching to another branch reads its history path from them instead of
    re-analyzing the path's nodes.

  Result: ~2.51 MiB per maximally branched session (a 34x cut), 256 sessions
  ≈ 644 MiB. Most of what's left (~72% in this benchmark, measured by
  swapping in a fresh `Analyzer` after the build and re-reading `HeapAlloc`)
  is the *analyzer's own* suit-table memo, not node data: a session tied to
  one wall still explores enough distinct hands, while branching into
  thousands of alternate lines, to grow it well past what one played-out
  line ever needs. It was bounded only by a reset at 200,000 tables
  (~28 MiB), and is now bounded like every other memo (see "Memo bounds"
  below: at most ~8.8 MiB), independent of `MaxNodes`; measured again with
  those bounds, the benchmark is ~4.9 MiB per session (it was ~7.2 MiB
  just before). The rest — 2000 nodes' own data (hand,
  per-node child map) plus the current node and its history path's pruned
  cache — is a few hundred KiB, not worth tightening further.
  `TestStateUnchangedAfterCachePruning` checks that revisiting a pruned node
  reproduces the exact same `state()` JSON.

  Pruning trades a little latency for that memory: a node whose analysis was
  pruned must be recomputed if it's visited again. `internal/session/latency_test.go`
  times `Goto` requests (`go test ./internal/session -run '^$' -bench BenchmarkXRequestLatency`,
  same "don't run under `go test ./...`" convention as the memory
  benchmarks above): `BenchmarkLargeTreeRequestLatency` builds a `MaxNodes`
  tree with fillTree (every one of 2000 nodes visited once while building
  it, so nothing stays cached — the worst case) at ~8 ms/request, and
  `BenchmarkTypicalTreeRequestLatency` builds a shape closer to normal play
  (one long line plus a few local rewinds) at ~7 ms/request — both up from
  ~1.3 ms/request before this fix, when everything was cached forever, but
  still imperceptible for this tool's single local user. `TestTreeRequestLatency`
  is the always-on regression guard: the same measurement on a 120-node
  tree (~2s total, fast enough for `go test ./...`), failing if a request
  ever exceeds 300 ms — enough margin to absorb CI noise while still
  catching a regression back toward O(tree size) work per request.

### Memo bounds

A memo that throws itself away whole once it reaches a cap is cheap to bound
but costly at a low cap: a practice request's analysis (every row of every
discard candidate, plus the advice's waits) touches several thousand suit
tables, so a reset forces the request to rebuild them all, and it recurs
every few requests. Measured on real sessions, capping the old memo at
16,000 tables made requests ~24% slower. So the memos are now
generational (`internal/memo`): new entries go to the current generation;
once it holds `gen` entries it becomes the old one (the previous old one is
dropped), and a hit in the old generation copies the entry forward, so
whatever is still in use survives. A memo holds at most `2 × gen` entries,
and a working set of up to `gen` entries is never lost. Returned tables are
immutable and stay valid after they are dropped (the caller's pointer keeps
them alive), so a turnover in the middle of a turn only costs recomputation,
never correctness; the fold memo is keyed by table pointers, so a table
dropped and rebuilt only misses its old folds. `TestMemoTurnover`
(`internal/yakushanten/memo_test.go`) checks an analyzer for ~200 hands
past its memo's turnovers against a fresh one, and the bounds below;
`TestTinyMemos` does the same, on every hand, with generations of 64
tables and 16 folds, so tables are dropped and rebuilt under their folds'
keys all the time.

| memo | per generation | bytes per entry | at most |
|---|---|---|---|
| suit tables, `shanten.MemoGen` (analyzer) | 28,000 | ~127 | ~7 MiB |
| folds, `foldGen` (`internal/yakushanten/combo.go`) | 4,000 | ~100 | ~0.8 MiB |
| tables kept alive only by fold keys (2 per fold) | | 64 | ~1 MiB |
| results, `resultMemoSize` (analyzer; FIFO, not generational) | 32 hands | ~4 KiB | ~0.15 MiB |
| **one analyzer** | | | **~9 MiB** |
| suit tables, `cpu` `memoGen` | 4,000 | ~127 | ~1 MiB |

A fold's key names two tables, which it keeps alive even after the engine's
memo dropped them: at most `2 × foldGen × 2` = 16,000 tables, hence the
third row.

An analyzer also keeps its last results: the rows and the combos of the
last `resultMemoSize` = 32 hands each (`internal/yakushanten/yakushanten.go`),
because a request asks for the same hand more than once (a game's
`analysis` is also its drawn tile's `by_discard` preview, and the hand
recorded in the history after a discard is that discard's preview). That is
~4 KiB per hand, ~0.15 MiB in all (the fourth row). In a practice session
many of them are also the current node's preview, so the memo adds less
than that there: `BenchmarkSessionMemory` went from ~5.2 to ~5.5 MiB per
session with it and the nodes' per-row shanten (above), `BenchmarkGameMemory` from
~8.1 to ~8.3 MiB per game.

The bytes per entry are `HeapAlloc` deltas (after `runtime.GC()`) of an
analyzer filled from random hands, divided by its entries: a table is 50
bytes allocated in a 64-byte size class plus its map slot and the map's
slack. The measured peak of one analyzer, filled the same way, was ~7.7
MiB (both memos full; the fold keys' tables were mostly still in the
engine's memo), under the tables' ~8.8 MiB bound. At a turnover the dropped
generation stays on the heap until the next GC, so for that moment a memo
briefly holds three generations (~3.5 MiB more for the analyzer's tables):
ordinary GC slack, not a lasting cost.

The sizes come from counting cache misses (computed tables and folds) on
real play, which unlike timings is deterministic: 8 practice sessions of
18 turns each played along the advice's best discard and then rewound and
replayed 4 times (472 requests), 8 more of 109 turns, and 12 whole CPU games
(6 東風戦 and 6 半荘戦, 1,486 human moves). Unbounded, an 18-turn session's
table memo reached 13,000–45,000 tables and a 半荘戦's 78,000–107,000 (the
memo carries over between rounds); the old caps were never reached, and
the fold cache (then 50,000 entries, reset when full) was reset in nearly
every session and game. Suit-table misses against an unbounded memo, per
generation size (every engine counted, so the CPU games also include the
CPU seats' misses):

| per generation | 18-turn sessions | 109-turn sessions | CPU games |
|---|---|---|---|
| 12,000 | +47% | | +15% |
| 16,000 | +23% | +155% | +12% |
| 20,000 | +12% | | +9% |
| 24,000 | +7% | +113% | +7% |
| 28,000 | +3% | | +5% |
| 32,000 | 0% | +76% | +4% |

A table costs ~10–18 µs to build and a fold ~0.4 µs, so the fold memo is
kept small (4,000 per generation: +77% fold misses, ~0.3 ms per request).
The CPU seats build only ~3,000–6,500 tables over a whole game, so 4,000
per generation leaves their misses unchanged.

Latency cost, against the old caps: **+4%** per request in 18-turn practice
sessions and per move in CPU games, **+11%** per request in long (109-turn)
sessions, which revisit hands from many turns back. Measured on a native
build over 3 alternating runs of the same play as above (noisy, ±1 ms):
18-turn session requests ~11.4 → ~11.9 ms, 109-turn ~11.0 → ~12.1 ms, CPU
game moves ~11.7 → ~12.2 ms.
`BenchmarkAnalyzeAllDiscards` (one fresh analyzer per call) is unchanged
at ~22.5 ms, so the generational lookup itself costs nothing measurable.

Worst case: a session ≈ 9 MiB (analyzer) + ~0.8 MiB (a
2000-node tree, its per-row shanten included) ≈ 9.8 MiB, a game ≈ 9 + 1
(CPU) + ~0.5 (game state) ≈ 10.5 MiB (~30 MiB per session and ~42 MiB per
game under the old caps), so the WebAssembly build (4 sessions, 2 games) is
bounded at ~60 MiB, down from ~200 MiB (plus a turnover's brief extra
generation, see above). A lower `shanten.MemoGen` trades latency for memory
along the table above (12,000 per generation would be ~5 MiB per analyzer,
at +47% table misses in ordinary practice).
