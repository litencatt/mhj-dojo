# 基礎(トークン・文字・余白・ブレークポイント)

値の正は CSS。ここは役割の説明だけで、値を変えたら CSS を直し、役割が変わったときだけこの文書を直す。

## トークン(正: `web/src/tokens.css` の `:root` とダークの `@media` ブロック)

| トークン | 役割 |
| --- | --- |
| `--bg` / `--fg` | ページ背景 / 本文色。副ボタン・入力欄の地も `--bg` |
| `--panel-bg` | パネル・ダイアログの地 |
| `--border` | 罫線(パネル、ボタン、入力欄、区切り) |
| `--muted` | 補足の文字(`--bg` 上で 4.5:1 以上) |
| `--accent` / `--accent-fg` | 主操作の塗り、リンク、選択・フォーカスの強調 / その上の文字 |
| `--danger` / `--danger-bg` | 警告・危険・失点 |
| `--success` / `--success-bg` / `--success-border` | 成功・獲得・加点 |
| `--row-best-bg` / `--row-tenpai-bg` | 表の強調行(推奨・聴牌)。`--row-best-bg` は課程の次の課題の行にも使う |
| `--chart-grid` | グラフの罫線、道場の経験値バーの地 |
| `--group-taatsu` | 面子表示の搭子 |
| `--backdrop` | モーダルダイアログの背後(`::backdrop`) |
| `--tile-*` | 牌の面・縁・裏・図柄の色。テーマ(`data-tile-theme`)で上書きされる。牌以外では使わない |
| `--radius-sm` | ボタン・入力欄・小さなバッジ |
| `--radius-md` | パネル内の枠(選択肢の枠、通知、ドラ表示) |
| `--radius-lg` | パネル・ダイアログ・ヘッダー |
| `--radius-pill` | 役名などのチップ |

ダークは `@media (prefers-color-scheme: dark)` で `--bg` 〜 `--group-taatsu` を差し替える。色を直書きしてよいのは牌の描画(図柄・立体感・裏の模様・リーチ棒)だけで、それ以外に `#xxx` を足さない(UI の緑は `--success-border`)。

## タイポグラフィ

フォントは `"Hiragino Sans", "Yu Gothic", "Noto Sans JP", system-ui`(`body`)。ボタン・入力欄は `font-family: inherit` にする。基準は本文 15px(`0.9rem` = 13.5px が副次の基本)。

| 用途 | サイズ |
| --- | --- |
| ページ見出し(`h1`) | 1.4rem、ヘッダー内は 1.2rem |
| パネル見出し(`h2`) | 1rem(ダイアログの見出しも同じ) |
| 本文 | 15px(`body`) |
| ボタン | 0.9rem(ヘッダーの 設定 と × は小型の 0.85rem) |
| 補足・ラベル・表のセル | 0.85rem(`--muted` と併用することが多い) |
| 小さな注記・ドラ・見出しのラベル | 0.75rem / 0.7rem |

iOS の入力欄は拡大を避けるため、スマホ幅では `font-size: 16px`(`.new-game-form` 参照)。

## 余白と角丸

- パネル: `padding: 12px 14px`、`border: 1px solid var(--border)`、`border-radius: var(--radius-lg)`、`--panel-bg`。パネル同士の間隔は 12px。
- スマホ(`width <= 760px`)は役別向聴の欄を広く取るため詰める: パネルの内側 8px、列・パネル同士の間隔 6px、ページ下端はドックがなければ 8px(縦向きでドックがあれば 60px)。`.cpu-summary` の負のマージンと、上に固定される手牌の欄の `box-shadow` の広がりは、列の間隔と同じ値にする(PC は 12px)。役別向聴の見出し行の `top` はパネルの内側の余白と同じ値の負数。
- パネル内の枠(選択肢の枠など): `padding: 6px 10px 8px`、`--radius-md`。
- ボタン: `padding: 6px 12px`、`--radius-sm`。ボタン同士の間隔は 8px。
- ダイアログ: `--radius-lg`、背後は `--backdrop`。

## ブレークポイント

| 条件 | 何が変わるか |
| --- | --- |
| `(width <= 760px), (height <= 500px) and (pointer: coarse)` | スマホ(横向き含む)。手牌は1行 14 枚、アクションバーのボタンは 32px(設定ボタンと同じ)、新規対局フォームは全幅、ヘルプは全画面に近い幅 |
| `(width <= 760px)` | 縦長スマホ。ヘッダーの 設定 と ? を大きく(32px 以上) |
| `(width > 1100px)` / `(width <= 1100px)` | 盤面とパネルを並べる2列配置 / 縦積み |
| `(width > 1500px)` | `.app` を 1920px まで広げ、パネルを横に並べる |
| `(max-width: 600px)` | 卓(`.game-table`)を2列に組み替える |
| `(max-width: 420px)` | ページ余白と牌を詰める(`.app` / `.dojo-home` は `8px 10px 32px`) |
| `(width <= 340px)` | 最小幅のスマホ。席・ドックを詰める |
| `(prefers-reduced-motion: no-preference)` | アニメーションは必ずこの中に書く |

スマホ判定はこのメディアクエリをそのまま使い、別の幅を作らない。
