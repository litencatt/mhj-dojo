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
- 設定: `web/src/components/SettingsDialog.tsx`。各モードの設定をここに集め、ヘッダーの 設定 から開く。開いたら最初の入力(ラジオならその組の選択中のもの)にフォーカス。
- 見た目の選択: `web/src/dojo/looks.tsx` の `LooksSettings`(牌テーマ・裏柄・卓布・リーチ棒・和了演出の `fieldset.dojo-settings-group` と見本 `.dojo-settings-sample`)。道場のハブ・道場の対局・練習・CPU対戦の 設定 で同じものを、モードの選択肢(新しく始めるフォームなど)の後に置く。選べるのは解放済みだけで、道場の進捗がないときは出さない。ハブ以外(`ownedOnly`)では、1つも持っていない種類の組を出さず、何も持っていなければ見た目の選択ごと出さない。保存に失敗したら `.save-failed` で知らせる。当てるのは `useDojoLooks`(ハブ)・`useSharedLooks`(ほかのモード、別タブの変更も `storage` イベントで追う)で、`<html>` の `data-*` に付ける。
- ヘルプ: `Help.tsx`。スマホでは画面ほぼ全幅、閉じるボタンは大きくする。
- 役の解説: `web/src/dojo/GuideDialog.tsx`(`.yaku-guide`)。役を買った直後(修得しました、`.dojo-aid-ok`)と、所持役のチップ(`.dojo-yaku-guide`、中身は枠なしのボタン)から開く。成立条件・翻・例の手(`Tile`、右端が和了牌)と、主ボタン `.dojo-start` の「この役を練習する」(練習モードへのリンク)、副ボタンの閉じる。

## 選択肢(ラジオ・チェック)
`fieldset.option-group`(練習・CPU対戦)と `fieldset.dojo-settings-group`(道場。練習・CPU対戦の 設定 に出る見た目の選択 `LooksSettings` も)は同じ見た目の枠付き。`legend` が項目名、中の `label` は `--fg` のまま(muted にしない)。設定ダイアログでは1項目が1行。入力欄・select は `padding: 4px 6px`、`--border`、`--radius-sm`、`--bg` 地。

## パネル見出し
`h2` を使い、右端にボタンを置くときは `.panel-heading`(`.panel-minimize` で最小化、最小化したパネルは右端の `.panel-dock` の `.dock-tab` に収まる)。

## チップ・バッジ
- 役名のチップ: 枠のみの `--radius-pill`(`.advice-yaku li`、`.dojo-yaku li`)。解説のある所持役は、チップの中に枠なしのボタン(`.dojo-yaku-guide`)を置く。スマホではチップ全部を 44px の高さにそろえる。絞り込みの `.filter-chip` はオン時に `--accent` の塗り。オン・オフの切り替え(手牌の見出しの 面子表示、道場の自動和了・自動ツモ切り・鳴きなしの `.hand-tools`)も `.filter-chip` に `aria-pressed` を付けて使う。`.hand-tools` は見出しの右端(面子表示の後)に置き、スマホでは見出しの下の行に右寄せで並べる。
- 状態バッジ: 成功は `--success*`、警告は `--danger*`(`.dojo-aid-ok` / `.dojo-aid-warn`)。
- 通知: `.dojo-notice`(情報)、`.error-banner`(エラー、`--danger`)、`.save-failed`(警告)。
- 課程のパネル: `web/src/dojo/Curriculum.tsx`(ハブの `.dojo-panel`、見出し `課程（合格数 / 全体）`)。段ごとに `details.dojo-lesson-stage`(見出しは 32px、次の課題の段だけ開く)。課題の行はショップと同じ `.shop-list` / `.shop-item`(題 `.shop-name`、状態は 合格 `.shop-owned`・ロック `.shop-locked`・ほか `.shop-price`、回数つき)に、役の解説の副ボタンと「始める」(続きなら「続ける」。読み上げ名は課題の題つき)のリンク(次の課題だけ主ボタン `.dojo-start`、ほかは副の `.dojo-restart`。ロック中・合格済みには出さない)。行の下に折りたたんだ説明(`details.dojo-lesson-more`、次の課題は開く)と例の手(`Tile` の xs)。次の課題は行を `--row-best-bg` で塗り、`次はこれ`(`.dojo-aid-ok`)を付け `aria-current="step"`。最後に準備中の段6と師範戦(`.dojo-lesson-later`)。スマホでは行のボタン・リンクと見出しを 32px 以上にする。
- 課題の行: `web/src/dojo/LessonBar.tsx`(`.dojo-notice.lesson-status`)。課題の対局と練習モードの課題で、手牌の欄の上(対局は卓の上)に置く。状態が変わっても高さを変えない2行: 1行目は `課題` のラベル(`.dojo-aid-label`)・題(`.lesson-title`、狭いと省略)・段階と回数(`.lesson-stage`、`data-stage`)・直前の達成(`.dojo-aid-ok.lesson-note`、短い文言で省略しない)を折り返さずに並べる。2行目は折りたたんだヒント(`details.lesson-hint`)で、失敗が続くと見出しに促し(`.lesson-hint-nudge`)が付くが、開くのは利用者だけ。中は課題の説明と、役の解説(`GuideDialog` の `inLesson`、練習モードへのリンクなし)を開く副ボタン。

## 牌
`.tile`(`tile-md` 36x48、`tile-sm` 26x35、`tile-xs` 18x24)。面は `TileFace.tsx` の SVG。選択可能な牌は `.tile-interactive`、選択中は `.tile-picked`、裏は `.tile-back`。色は `--tile-*` のみで、テーマ・裏柄は `<html>` の `data-tile-theme` / `data-tile-back` で切り替える(道場で選んだものを全モードで当てる)。スマホの手牌は 14 枚が1行に収まるよう `--hand-tile` で幅を決める。スマホの役別向聴・複合役の有効牌は折り返さず1行(1枚 最大16px・最小11px で行に収め、それでも入らなければ横スクロール)。

## アクションバー
`.action-bar`(対局の操作ボタンの行)。鳴きの問い(ロン・ポン・カン・チー・スキップ)は `.action-bar-call` で右寄せにし、打牌で使う右端(ツモ牌)の近くに置く。スマホ(`width <= 760px`)ではボタンをヘッダーの 設定 と同じ高さ 32px(`min-height: 32px; padding: 4px 12px; font-size: 0.85rem`、主ボタン `.action-primary` も同じ、牌入りの `.action-call` は上下 3px)にして役別向聴の欄を広く取る。行そのものも `min-height: 32px` で、ボタンのない行(再生中の `.action-bar-playback`、ヒントだけの道場の行)でも高さが変わらない。
