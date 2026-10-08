# 部品(部品と、使うクラス・TSX の対応)

新しい要素は、まずここの部品に当てはめる。

## ボタン(`styles/base.css` の「Buttons」)
- 副ボタン(既定): `.dojo-home button`、`.resume-panel button`、`.action-bar button`、`.tab-stopped button`。`--bg` 地、`--border`、`--radius-sm`、`0.9rem`。
- 主ボタン(その場の主操作を1つだけ): 塗りは `--accent`、太字。`.action-primary`(アクションバー・復元パネル・TabStopped)、`.new-game-form button`(新規対局など)、`.tsumo-button`、`.next-round-button`、`.dojo-start`、`.shop-confirm-buy`。
- 副・主とも 1px の枠があり、並べても同じ高さ。新しい主ボタンは上のセレクタ群に追加し、個別に色を書かない。
- ヘッダーの小型ボタン: `.settings-button`、`.help-button`、`.help-close`、`.panel-minimize`(アイコン系は枠のみ、`--muted`)。
- 無効: `opacity: 0.5; cursor: default`(`:disabled` の規則に対象クラスを足す。牌ボタンには付けない)。
- 危険な通知内: `.error-banner button`(`currentColor` の枠)。

## ダイアログ
- すべて `<dialog>` を `showModal()` で開く(ESC・フォーカストラップ・背後の不活性化がブラウザ任せになる)。閉じたらトリガーのボタンにフォーカスを戻す。
- 背景(ダイアログの外)のクリック・タップで閉じる: `components/backdrop.ts` の `useBackdropClose` を `<dialog>` に付ける(ドラッグの終点やダイアログ自身のスクロールバーでは閉じない)。例外は、閉じると操作が止まったままになる `.tab-stopped`。
- 見た目は `.settings-dialog`、`.help-dialog`、`.tab-stopped`、`.shop-confirm`、`.yaku-guide` が共通(`--panel-bg`、`--radius-lg`、`--backdrop`)。幅は `min(Npx, 100vw - 32px)` を基本にする。
- 設定: `web/src/components/SettingsDialog.tsx`。各モードの設定をここに集め、ヘッダーの 設定 から開く。開いたら選択中の入力にフォーカス。
- ヘルプ: `Help.tsx`。スマホでは画面ほぼ全幅、閉じるボタンは大きくする。
- 役の解説: `web/src/dojo/GuideDialog.tsx`(`.yaku-guide`)。役を買った直後(修得しました、`.dojo-aid-ok`)と、所持役のチップ(`.dojo-yaku-guide`、中身は枠なしのボタン)から開く。成立条件・翻・例の手(`Tile`、右端が和了牌)と、主ボタン `.dojo-start` の「この役を練習する」(練習モードへのリンク)、副ボタンの閉じる。

## 選択肢(ラジオ・チェック)
`fieldset.option-group`(練習・CPU対戦)と `fieldset.dojo-settings-group`(道場)は同じ見た目の枠付き。`legend` が項目名、中の `label` は `--fg` のまま(muted にしない)。設定ダイアログでは1項目が1行。入力欄・select は `padding: 4px 6px`、`--border`、`--radius-sm`、`--bg` 地。

## パネル見出し
`h2` を使い、右端にボタンを置くときは `.panel-heading`(`.panel-minimize` で最小化、最小化したパネルは右端の `.panel-dock` の `.dock-tab` に収まる)。

## チップ・バッジ
- 役名のチップ: 枠のみの `--radius-pill`(`.advice-yaku li`、`.dojo-yaku li`)。解説のある所持役は、チップの中に枠なしのボタン(`.dojo-yaku-guide`)を置く。スマホではチップ全部を 44px の高さにそろえる。絞り込みの `.filter-chip` はオン時に `--accent` の塗り。オン・オフの切り替え(手牌の見出しの 面子表示、道場の自動和了・自動ツモ切り・鳴きなしの `.hand-tools`)も `.filter-chip` に `aria-pressed` を付けて使う。`.hand-tools` は見出しの右端(面子表示の後)に置き、スマホでは見出しの下の行に右寄せで並べる。
- 状態バッジ: 成功は `--success*`、警告は `--danger*`(`.dojo-aid-ok` / `.dojo-aid-warn`)。
- 通知: `.dojo-notice`(情報)、`.error-banner`(エラー、`--danger`)、`.save-failed`(警告)。

## 牌
`.tile`(`tile-md` 36x48、`tile-sm` 26x35、`tile-xs` 18x24)。面は `TileFace.tsx` の SVG。選択可能な牌は `.tile-interactive`、選択中は `.tile-picked`、裏は `.tile-back`。色は `--tile-*` のみで、テーマ・裏柄は `<html>` の `data-tile-theme` / `data-tile-back` で切り替える。スマホの手牌は 14 枚が1行に収まるよう `--hand-tile` で幅を決める。スマホの役別向聴・複合役の有効牌は折り返さず1行(1枚 最大16px・最小11px で行に収め、それでも入らなければ横スクロール)。

## アクションバー
`.action-bar`(対局の操作ボタンの行)。鳴きの問い(ロン・ポン・カン・チー・スキップ)は `.action-bar-call` で右寄せにし、打牌で使う右端(ツモ牌)の近くに置く。スマホ(`width <= 760px`)ではボタンをヘッダーの 設定 と同じ高さ 32px(`min-height: 32px; padding: 4px 12px; font-size: 0.85rem`、主ボタン `.action-primary` も同じ、牌入りの `.action-call` は上下 3px)にして役別向聴の欄を広く取る。行そのものも `min-height: 32px` で、ボタンのない行(再生中の `.action-bar-playback`、ヒントだけの道場の行)でも高さが変わらない。
