# DESIGN.md

mhj-dojo の UI を作る・直すときの入口。詳細は `docs/design/` に分け、ここは地図と決まりだけを置く。

## Read first

1. `docs/design/foundations.md`: 色・文字・余白・角丸・ブレークポイントのトークンと役割
2. `docs/design/components.md`: ボタン、パネル、ダイアログ、選択肢、チップ、牌、アクションバーと、使うクラス・TSX
3. `docs/design/patterns.md`: ページ構成、ヘッダー、モード、アクセシビリティ・操作の決まり
4. `docs/design/operation.md`: ページや要素を足す手順と、確認のコマンド

## Source of truth

- トークン(色・角丸): `web/src/tokens.css`(ライトの `:root` とダークの `@media`。`style.css` と更新情報の `info.css` が共有)。文書は役割の説明だけで、値は CSS が正
- 部品の見た目: `web/src/style.css`(本体)、`web/src/dojo/dojo.css`(道場)、`web/src/info.css`(更新情報)
- 共通の部品: `web/src/components/SiteHeader.tsx`(ヘッダー)、`SettingsDialog.tsx`(設定)、`Help.tsx`(ヘルプ)
- 文書と CSS が食い違ったら CSS が正。直した人が文書も直す

## Rules

- 既存のトークン・クラス・コンポーネントを再利用する。色の直書き、新しい角丸・余白の段階、モード専用の部品を作らない
- 頼まれた UI は、新しい見せ方を足す前に、既存のパターン(`components.md` の部品)に置き換えられないか考える
- 本当に新しいパターンが要るときは、トークン(`tokens.css`)や共通部品として足し、同じ変更で `docs/design/` と、必要ならこのファイルも更新する
- 同じ役割の要素は全モードで同じ見た目にする。モードで変えてよいのは盤面(牌・卓)だけ
- スマホ(`(width <= 760px), (height <= 500px) and (pointer: coarse)`)のタップ領域は 44px、状態の切り替えで高さを変えない
- 終わる前に `cd web && npm run typecheck` と `make e2e` を通し、3モードをライト/ダーク・1280/390 で目視する(`operation.md`)
