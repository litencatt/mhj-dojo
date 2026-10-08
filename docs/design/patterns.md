# パターン(ページ構成・モード・操作の決まり)

## 原則

1. 同じ役割の要素は、どのモードでも同じ見た目にする。モード別の見た目が要るのは、盤面(牌・卓)だけ。
2. 色は必ず `tokens.css` のトークンで書く。ライト/ダークは `:root` の差し替えだけで済ませ、部品側に `prefers-color-scheme` を書かない。
3. 値(角丸・余白・文字サイズ)は`foundations.md` の段階から選ぶ。新しい段階を作る前に、既存の段階で足りないか確かめる。
4. 状態が変わっても寸法は変えない(レイアウトシフトなし)。切り替わる文言や空の行は `min-height` で高さを保つ。
5. 操作は目に見える形で。無効は opacity 0.5、選択中は `aria-pressed` / `aria-selected` / `aria-current` を属性で持ち、見た目はその属性から付ける。

## レイアウト

- ページの幅と余白: `.app` と `.dojo-home` が共通(`max-width: 1280px`、`padding: 12px 16px 48px`、ノッチの安全領域を考慮)。新しいページもこのどちらかのクラスを使う。
- ヘッダー: 必ず `web/src/components/SiteHeader.tsx`。タイトル(`h1`)、3モードのリンク(現在のモードは `aria-current="page"`)、バージョン、`設定`、`?` ヘルプ(`Help.tsx`)。下にモード固有の状態(`children`)を置ける。モードの中のページ(道場の対局)は `back` でそのモードのトップへ戻るリンク(`.header-back`、タイトルの下の1行)を出す。モードのリンクは3つとも全画面で同じ順序(練習・CPU対戦・道場)。
- 残り牌とドラ: 練習・CPU対戦・道場の対局とも `components/PinnedStatus.tsx` の `WallDora`(`.status-wall-dora`、残り牌の直後にドラ)。PC ではヘッダーの状態の行の右端、スマホ(`width <= 760px`)ではヘッダーから外し、上端に固定される手牌の欄の先頭(`PinnedStatus`、`.pinned-status`)に出して、スクロールしても常に見えるようにする。どちらか一方だけを表示する。
- パネル: `section`、`.resume-panel`、`.dojo-panel` は同じ見た目(`styles/base.css` の「A panel」)。`.release`(更新情報)も同じ寸法。新しいパネルは `section`(盤面側)か `.dojo-panel`(ハブ側)を使い、個別に border や radius を書かない。
- 更新情報(`web/info/index.html`)は静的ページで SiteHeader を使わず、`.info-header` + `.info-nav`。色・角丸・パネルはトークンと共通。

## インタラクションとアクセシビリティ

- タッチ操作の最小はスマホで 32px(ヘッダーの 設定・? と、操作欄のロン・ポン・おすすめ等のボタンは同じ 32px)。牌のタップ領域は `::after` で隣へ広げる。
- フォーカスリングを消さない。消すのは `.action-area:focus` のようにプログラムでフォーカスを移しただけの要素に限る。
- 状態は属性で表す: モード → `aria-current="page"`、トグル → `aria-pressed`、タブ → `role="tab"` + `aria-selected`、ダイアログを開くボタン → `aria-haspopup="dialog"`。
- ホバー表現は `@media (hover: hover)` の中だけ(タッチで持ち上げが残らないように)。
- アニメーションは `@media (prefers-reduced-motion: no-preference)` の中だけ。
- 状態の切り替えで高さが変わる行(CPU の要約、再生中、ショップの一覧)は `min-height` や固定高さで保つ。
