# Changelog

## [v2026.1009.1](https://github.com/litencatt/mhj-dojo/compare/v2026.1009.0...v2026.1009.1) - 2026-10-09

### 修正
- 更新情報で、PR の題の末尾にある issue 番号を出さない by @litencatt in https://github.com/litencatt/mhj-dojo/pull/327

## [v2026.1009.0](https://github.com/litencatt/mhj-dojo/compare/v2026.1008.2...v2026.1009.0) - 2026-10-09

### 新機能
- CPU対戦の処理時間のベンチマークを足す (#233) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/313
### CI・リポジトリ
- CI: Go 1.27.2 での lint の失敗と Nightly のタイムアウトを直す by @litencatt in https://github.com/litencatt/mhj-dojo/pull/315
### その他
- base.css と wasm.ts / api.ts を分割する (#311) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/312

## [v2026.1008.2](https://github.com/litencatt/mhj-dojo/compare/v2026.1008.1...v2026.1008.2) - 2026-10-08

### 新機能
- 道場に自動和了・自動ツモ切り・鳴きなしを足す by @litencatt in https://github.com/litencatt/mhj-dojo/pull/308
### 修正
- スマホの役別向聴の有効牌を小さくし、1行に並べる by @litencatt in https://github.com/litencatt/mhj-dojo/pull/306

## [v2026.1008.1](https://github.com/litencatt/mhj-dojo/compare/v2026.1008.0...v2026.1008.1) - 2026-10-08

### 新機能
- スマホの操作欄のボタンを設定ボタンと同じ大きさにする by @litencatt in https://github.com/litencatt/mhj-dojo/pull/299
### その他
- リファクタリング: GameApp を分割し、道場の対局の処理をフックにまとめる by @litencatt in https://github.com/litencatt/mhj-dojo/pull/300
- リファクタリング: E2E の補助関数と定数をまとめる by @litencatt in https://github.com/litencatt/mhj-dojo/pull/303
- リファクタリング: CSS を部品ごとのファイルに分ける by @litencatt in https://github.com/litencatt/mhj-dojo/pull/302
- CSS のルールを本来の部品のファイルへ移す by @litencatt in https://github.com/litencatt/mhj-dojo/pull/304

## [v2026.1008.0](https://github.com/litencatt/mhj-dojo/compare/v2026.1007.0...v2026.1008.0) - 2026-10-08

### 新機能
- 道場: 役の購入時の説明と練習モードへの導線 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/295
- 捨て牌の切り替えを設定へ移し、残り牌をドラの隣に（スマホでは常に表示） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/296
- スマホで縦の余白を詰め、役別向聴の欄を広くする by @litencatt in https://github.com/litencatt/mhj-dojo/pull/297
### CI・リポジトリ
- 道場: 最後までUIで打つE2Eと、mode=game からの移動のE2Eを足す by @litencatt in https://github.com/litencatt/mhj-dojo/pull/292
### その他
- 道場の経済を人に近い打ち方で確かめ、CPU 普通の倍率を ×2 にする by @litencatt in https://github.com/litencatt/mhj-dojo/pull/294

## [v2026.1007.0](https://github.com/litencatt/mhj-dojo/compare/v2026.1006.1...v2026.1007.0) - 2026-10-07

### 新機能
- 道場モードを追加する by @litencatt in https://github.com/litencatt/mhj-dojo/pull/263
- CPU対戦の設定をモーダルで開く by @litencatt in https://github.com/litencatt/mhj-dojo/pull/283
- CPU対戦の設定をラジオボタンにし、道場の設定と同じ見た目にする by @litencatt in https://github.com/litencatt/mhj-dojo/pull/285
- ヘッダーを3モード共通にし、設定をモーダルにまとめる by @litencatt in https://github.com/litencatt/mhj-dojo/pull/286
- モーダルの外側クリックで閉じ、鳴きの操作欄を右寄せ、和了演出のプレビュー by @litencatt in https://github.com/litencatt/mhj-dojo/pull/289
- 道場の対局のヘッダーに「道場トップへ戻る」リンクを出す by @litencatt in https://github.com/litencatt/mhj-dojo/pull/290
### 修正
- CPUの再生開始で操作欄の高さが変わらないようにする by @litencatt in https://github.com/litencatt/mhj-dojo/pull/287
### ドキュメント
- デザインを統一し、DESIGN.md（入口）と docs/design/ にまとめる by @litencatt in https://github.com/litencatt/mhj-dojo/pull/288
### CI・リポジトリ
- E2Eの高速化とハング対策 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/258
- ワークフローを変えたリリースでも公開用 PR を作れるようにする by @litencatt in https://github.com/litencatt/mhj-dojo/pull/262
- 手牌と操作欄の隙間を詰め、make dev を足す by @litencatt in https://github.com/litencatt/mhj-dojo/pull/282
- OG の文面に道場モードを入れる by @litencatt in https://github.com/litencatt/mhj-dojo/pull/284
### その他
- 道場のルール定数を Go のテストがフロントから読むようにする by @litencatt in https://github.com/litencatt/mhj-dojo/pull/279
- 道場の鳴いた手の「役なし」表示を実局面の E2E で確かめる by @litencatt in https://github.com/litencatt/mhj-dojo/pull/280
- 道場のショップに見た目の商品（卓布・リーチ棒・和了演出）を足す by @litencatt in https://github.com/litencatt/mhj-dojo/pull/281

## [v2026.1006.1](https://github.com/litencatt/mhj-dojo/compare/v2026.1006.0...v2026.1006.1) - 2026-10-06

### 新機能
- CPU対戦のアドバイスに危険度を並べて表示 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/251
- スマホの対局でおすすめの打牌を表示し、非表示時は計算を省く by @litencatt in https://github.com/litencatt/mhj-dojo/pull/254
- CPUの動きの再生後、リーチ・鳴き・ロンの機会を1文で表示 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/253
- CPUの動きの再生中のスキップボタンを削除 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/256
### ドキュメント
- 練習画面の文言を「新しい練習」にし、READMEを最近の機能に合わせる by @litencatt in https://github.com/litencatt/mhj-dojo/pull/252
### CI・リポジトリ
- 公開用 PR で CI と Formal model を起動しない by @litencatt in https://github.com/litencatt/mhj-dojo/pull/250
- 画面側ロジックの単体テストを追加 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/255
### 依存関係
- Build(deps): Bump source-map-js from 1.2.1 to 1.2.2 in /web by @dependabot[bot] in https://github.com/litencatt/mhj-dojo/pull/225
### その他
- 練習画面と対局画面の共通部分を整理 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/257

## [v2026.1006.0](https://github.com/litencatt/mhj-dojo/compare/v2026.1005.0...v2026.1006.0) - 2026-10-06

### 新機能
- 普通の CPU の守備と鳴きを強くした by @litencatt in https://github.com/litencatt/mhj-dojo/pull/222
- CPU対戦でアドバイスとリーチへの危険度を表示 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/221
### 修正
- スマホの役別向聴で、件数を見出しの行にまとめる by @litencatt in https://github.com/litencatt/mhj-dojo/pull/218
### パフォーマンス
- 練習の分析を約2倍速く by @litencatt in https://github.com/litencatt/mhj-dojo/pull/223
### ドキュメント
- Service Worker の停止手順の説明を正確に by @litencatt in https://github.com/litencatt/mhj-dojo/pull/219
### CI・リポジトリ
- 同じコミットにリリースタグを二重に付けないように by @litencatt in https://github.com/litencatt/mhj-dojo/pull/220

## [v2026.1005.0](https://github.com/litencatt/mhj-dojo/compare/v2026.1004.3...v2026.1005.0) - 2026-10-05

### 新機能
- 一度開いたあとはオフラインでも使えるように by @litencatt in https://github.com/litencatt/mhj-dojo/pull/213
### パフォーマンス
- エンジン読み込み中の表示とアプリのアイコン・ショートカットを改善 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/214

## [v2026.1004.3](https://github.com/litencatt/mhj-dojo/compare/v2026.1004.2...v2026.1004.3) - 2026-10-04

### 新機能
- CPUの動きの再生速度を選べるように、補助文字を読みやすく by @litencatt in https://github.com/litencatt/mhj-dojo/pull/201
- 保存した練習・対局に「続きから」で戻れるように by @litencatt in https://github.com/litencatt/mhj-dojo/pull/205
- エラー表示に「再試行」を追加し、保存できないときに知らせる by @litencatt in https://github.com/litencatt/mhj-dojo/pull/209
- 天和・地和を役に追加 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/211
### 修正
- 和了形の分解で同じ形が重複して返らないように修正 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/204
- 練習のアドバイスで七対子・国士無双も考えるように by @litencatt in https://github.com/litencatt/mhj-dojo/pull/206
### ドキュメント
- 流し満貫は対象外と明記 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/199
### CI・リポジトリ
- リリースから公開までの手作業を減らす（CHANGELOG のみの CI 省略と公開後の自動確認） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/200
- 計算ロジックの性質テストと総当たり照合を追加 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/203
- CI を短くし、E2E を安定させる（分割実行・ビルド済みバイナリ・flaky 警告） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/202
- 符計算の形式モデルと検証ベクトルを追加 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/208
- サーバー時代の足場（ロック・既定上限・race CI）を削除 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/210

## [v2026.1004.2](https://github.com/litencatt/mhj-dojo/compare/v2026.1004.1...v2026.1004.2) - 2026-10-04

### 修正
- 役別向聴の三暗刻・四暗刻はツモ和了で数えることを明記 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/183
- 再読み込みや開き直しで直前のCPUの手を再生し直さないように by @litencatt in https://github.com/litencatt/mhj-dojo/pull/182
### CI・リポジトリ
- E2E: シード依存のシーン(ポン等)をGoテストで守る by @litencatt in https://github.com/litencatt/mhj-dojo/pull/181

## [v2026.1004.1](https://github.com/litencatt/mhj-dojo/compare/v2026.1004.0...v2026.1004.1) - 2026-10-04

### 依存関係
- Bump preact from 10.29.8 to 11.0.0 in /web by @dependabot[bot] in https://github.com/litencatt/mhj-dojo/pull/177

## [v2026.1004.0](https://github.com/litencatt/mhj-dojo/compare/v2026.1003.0...v2026.1004.0) - 2026-10-04

### CI・リポジトリ
- Dependabot: @types/node のメジャー更新は Node 本体と一緒に上げる by @litencatt in https://github.com/litencatt/mhj-dojo/pull/176
### 依存関係
- Bump leanprover/lean-action from 1.6.0 to 1.6.1 by @dependabot[bot] in https://github.com/litencatt/mhj-dojo/pull/171
- Bump Songmu/tagpr from 1.21.0 to 1.21.1 by @dependabot[bot] in https://github.com/litencatt/mhj-dojo/pull/170

## [v2026.1003.0](https://github.com/litencatt/mhj-dojo/compare/v2026.0930.3...v2026.1003.0) - 2026-10-03

### パフォーマンス
- エンジンを約 500 KB 小さくして読み込みを軽くする by @litencatt in https://github.com/litencatt/mhj-dojo/pull/172

## [v2026.0930.3](https://github.com/litencatt/mhj-dojo/compare/v2026.0930.2...v2026.0930.3) - 2026-09-30

### CI・リポジトリ
- ドキュメント: 画面もエンジンもブラウザの中の1つのビルドに（#147 の 4・その5） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/167
- mhj-dojo が公開サイトと同じビルドを配る（#147 の 4・その1） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/162
- E2E を1組・1つの設定に（#147 の 4・その4） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/166
- 画面から HTTP の経路を消す（#147 の 4・その2） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/163
- サーバの API を削除（#147 の 4・その3） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/165

## [v2026.0930.2](https://github.com/litencatt/mhj-dojo/compare/v2026.0930.1...v2026.0930.2) - 2026-09-30

### 修正
- E2E: 更新情報の最新リリースが内部の改善のみでも通るように by @litencatt in https://github.com/litencatt/mhj-dojo/pull/159
### CI・リポジトリ
- ラベル: build/・test/ ブランチを chore に by @litencatt in https://github.com/litencatt/mhj-dojo/pull/158
- E2E を1組にまとめる（#147 の 3） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/160
- ビルド済みの画面をリポジトリに入れない（#147 の 1・2） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/156

## [v2026.0930.1](https://github.com/litencatt/mhj-dojo/compare/v2026.0930.0...v2026.0930.1) - 2026-09-30

### 修正
- 更新情報の表記を修正 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/153

## [v2026.0930.0](https://github.com/litencatt/mhj-dojo/compare/v2026.0929.2...v2026.0930.0) - 2026-09-30

### 新機能
- 更新情報: 外部サイトへのリンクをなくし、ヘルプのバージョン表示を簡潔に by @litencatt in https://github.com/litencatt/mhj-dojo/pull/151

## [v2026.0929.2](https://github.com/litencatt/mhj-dojo/compare/v2026.0929.1...v2026.0929.2) - 2026-09-29

### 新機能
- 説明文と OG 画像を CPU 対戦も含む内容に by @litencatt in https://github.com/litencatt/mhj-dojo/pull/145
- 更新情報ページ（/info）を CHANGELOG から自動で作る by @litencatt in https://github.com/litencatt/mhj-dojo/pull/149

## [v2026.0929.1](https://github.com/litencatt/mhj-dojo/compare/v2026.0929.0...v2026.0929.1) - 2026-09-29

### 新機能
- 役別向聴: 絞り込みをトグルでたたむ・条件をクリアで高さが変わらないように by @litencatt in https://github.com/litencatt/mhj-dojo/pull/141
- CPU 対戦（スマホ縦）: 席を横長に並べ、自分の情報を手牌の欄に、チャート・用語表をなくして役別向聴を広く by @litencatt in https://github.com/litencatt/mhj-dojo/pull/143

## [v2026.0929.0](https://github.com/litencatt/mhj-dojo/compare/v2026.0928.1...v2026.0929.0) - 2026-09-29

### 新機能
- CPU 対戦: 伏せているシードは局の情報に出さない by @litencatt in https://github.com/litencatt/mhj-dojo/pull/137
- CPU 対戦（スマホ）: 役別向聴を独立スクロールに、他家の捨て牌の表示切り替え by @litencatt in https://github.com/litencatt/mhj-dojo/pull/138

## [v2026.0928.1](https://github.com/litencatt/mhj-dojo/compare/v2026.0928.0...v2026.0928.1) - 2026-09-28

### 新機能
- CPU 対戦: スマホでヘッダ・CPU の牌・局の動きをコンパクトに by @litencatt in https://github.com/litencatt/mhj-dojo/pull/134

## [v2026.0928.0](https://github.com/litencatt/mhj-dojo/compare/v2026.0927.9...v2026.0928.0) - 2026-09-28

### 修正
- E2E: アドバイスのテストでリクエストを数え始める時点を修正（不安定な失敗の修正） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/130
### CI・リポジトリ
- dependabot の対象に web の npm パッケージを追加 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/129
### 依存関係
- Bump vite from 8.3.0 to 8.3.1 in /web in the web-minor group by @dependabot[bot] in https://github.com/litencatt/mhj-dojo/pull/132

## [v2026.0927.9](https://github.com/litencatt/mhj-dojo/compare/v2026.0927.8...v2026.0927.9) - 2026-09-27

### 修正
- 同じ対局・練習は1つのタブだけで進める（新しいタブが優先し、古いタブは停止） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/124
### パフォーマンス
- 画面の無駄な描き直しを減らす（役別向聴の表・グラフの memo 化、最小化パネルは中身を作らない） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/123
- エンジン: 同じ手牌の重複分析をなくす（1手 約15〜20% 短縮、分岐移動 35 ms → 0.1 ms） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/126
- 応答を小さく（残り枚数を1回だけ・分岐ツリーは差分）、アドバイスは開いたときだけ計算 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/127

## [v2026.0927.8](https://github.com/litencatt/mhj-dojo/compare/v2026.0927.7...v2026.0927.8) - 2026-09-27

### 修正
- 公開版: 同じ対局・練習を複数タブで開いたときに同期する by @litencatt in https://github.com/litencatt/mhj-dojo/pull/118
- CPU 対戦: 再生中の盤面を手ごとの値にし、局の動きを全件表示・スマホの CPU 手牌をコンパクトに by @litencatt in https://github.com/litencatt/mhj-dojo/pull/120
### パフォーマンス
- 向聴計算のメモを2世代メモにしてメモリの最悪値を抑える by @litencatt in https://github.com/litencatt/mhj-dojo/pull/121

## [v2026.0927.7](https://github.com/litencatt/mhj-dojo/compare/v2026.0927.6...v2026.0927.7) - 2026-09-27

### 新機能
- 公開版（WASM）で CPU 対戦を遊べるようにする by @litencatt in https://github.com/litencatt/mhj-dojo/pull/114
### パフォーマンス
- WASM 版: 向聴メモの局またぎ再利用と、応答しないエンジンからの復帰 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/116

## [v2026.0927.6](https://github.com/litencatt/mhj-dojo/compare/v2026.0927.5...v2026.0927.6) - 2026-09-27

### 新機能
- 役別向聴で聴牌になった役の行を薄い赤にする by @litencatt in https://github.com/litencatt/mhj-dojo/pull/111

## [v2026.0927.5](https://github.com/litencatt/mhj-dojo/compare/v2026.0927.4...v2026.0927.5) - 2026-09-27

### 修正
- スマホ縦向きの下部タブバーをコンパクトにする by @litencatt in https://github.com/litencatt/mhj-dojo/pull/108
### CI・リポジトリ
- perf/ ブランチの PR をリリースノートの「パフォーマンス」に分類する by @litencatt in https://github.com/litencatt/mhj-dojo/pull/107

## [v2026.0927.4](https://github.com/litencatt/mhj-dojo/compare/v2026.0927.3...v2026.0927.4) - 2026-09-27

### その他
- wasmビルドに GOEXPERIMENT=nojsonv2 を適用してサイズ削減 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/102
- wasm: 静的サイトのpracticeセッション保持数を4に制限 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/103
- 牌の描画を共有SVGスプライト方式に変更してDOMを削減 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/104

## [v2026.0927.3](https://github.com/litencatt/mhj-dojo/compare/v2026.0927.2...v2026.0927.3) - 2026-09-27

### 新機能
- サイトのリリースビルドと Lolipop デプロイを分離 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/100
- favicon・アプリアイコン・OGP設定を追加 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/99
### 修正
- スマホ横向きでは最小化したパネルを PC と同じ右端の縦タブにする by @litencatt in https://github.com/litencatt/mhj-dojo/pull/97

## [v2026.0927.2](https://github.com/litencatt/mhj-dojo/compare/v2026.0927.1...v2026.0927.2) - 2026-09-27

### 修正
- 用語表は麻雀の用語だけにし、アプリの用語はヘルプへ移す by @litencatt in https://github.com/litencatt/mhj-dojo/pull/95
### その他
- Web: iPhone でシード値とバージョンが電話番号リンクになるのを止める by @litencatt in https://github.com/litencatt/mhj-dojo/pull/92
- リリースフローの改善: PRラベル付けとカテゴリ別リリースノート、公開後スモークテストの土台 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/93

## [v2026.0927.1](https://github.com/litencatt/mhj-dojo/compare/v2026.0927.0...v2026.0927.1) - 2026-09-27

- 公開サイト版 E2E: リリースのビルドではヘッダーのタグ表示を期待する by @litencatt in https://github.com/litencatt/mhj-dojo/pull/89

## [v2026.0927.0](https://github.com/litencatt/mhj-dojo/commits/v2026.0927.0) - 2026-09-27

- Fix UI request races and tsumo chart overlap; add READMEs by @litencatt in https://github.com/litencatt/mhj-dojo/pull/1
- Add CI workflow (lint, test, vulncheck, web build) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/2
- Speed up CI tests by @litencatt in https://github.com/litencatt/mhj-dojo/pull/3
- Realistic SVG tiles, resume from URL, remove mock backend by @litencatt in https://github.com/litencatt/mhj-dojo/pull/4
- Draw 白 as a blank tile by @litencatt in https://github.com/litencatt/mhj-dojo/pull/5
- Two-column layout with the yaku table on the right; simplify pinzu/souzu colours by @litencatt in https://github.com/litencatt/mhj-dojo/pull/6
- Add 12 yaku, including 8 yakuman by @litencatt in https://github.com/litencatt/mhj-dojo/pull/7
- Add a searchable glossary beside the yaku table by @litencatt in https://github.com/litencatt/mhj-dojo/pull/8
- Fit the page to the viewport with per-column scrolling; compact header; hand title by @litencatt in https://github.com/litencatt/mhj-dojo/pull/9
- History tree column between hand and yaku table; always show yakuman rows by @litencatt in https://github.com/litencatt/mhj-dojo/pull/10
- Add filters and sorting to the yaku table by @litencatt in https://github.com/litencatt/mhj-dojo/pull/11
- Minimize the chart, tree, yaku table and glossary into a right-edge dock by @litencatt in https://github.com/litencatt/mhj-dojo/pull/12
- Dora and ura dora; yaku table 翻 column, tooltips, no yakuman grouping by @litencatt in https://github.com/litencatt/mhj-dojo/pull/13
- Keep the yaku tooltip on screen near the bottom edge by @litencatt in https://github.com/litencatt/mhj-dojo/pull/14
- Evaluate yaku per winning reading (Phase 2 prep) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/15
- Phase 2a step 0: generic in-memory store by @litencatt in https://github.com/litencatt/mhj-dojo/pull/16
- Phase 2a step 1: four-player deal from the wall by @litencatt in https://github.com/litencatt/mhj-dojo/pull/17
- Phase 2a step 2: ron, riichi and fu in yaku evaluation by @litencatt in https://github.com/litencatt/mhj-dojo/pull/18
- Phase 2a step 3: points from han and fu by @litencatt in https://github.com/litencatt/mhj-dojo/pull/19
- Phase 2a step 4: wind rows follow the round and seat winds by @litencatt in https://github.com/litencatt/mhj-dojo/pull/20
- Phase 2a step 5: four-player round engine by @litencatt in https://github.com/litencatt/mhj-dojo/pull/22
- Phase 2a step 6: CPU player by @litencatt in https://github.com/litencatt/mhj-dojo/pull/23
- Phase 2a step 7: games API by @litencatt in https://github.com/litencatt/mhj-dojo/pull/24
- Phase 2a step 8: CPU game mode in the frontend by @litencatt in https://github.com/litencatt/mhj-dojo/pull/25
- Phase 2a step 9: document the CPU game mode by @litencatt in https://github.com/litencatt/mhj-dojo/pull/26
- Fix backend review findings by @litencatt in https://github.com/litencatt/mhj-dojo/pull/32
- Fix frontend review findings by @litencatt in https://github.com/litencatt/mhj-dojo/pull/31
- Start rounds from a config; honba, carried sticks and kan dora (#30) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/36
- Let hands hold called melds (#30) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/35
- Share winds, API rows and visible-tile counting (#30) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/34
- Deduplicate the practice and game frontends by @litencatt in https://github.com/litencatt/mhj-dojo/pull/33
- Play games of several rounds in the browser (#28) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/39
- Play games of several rounds (#28, engine) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/37
- Serve games of several rounds over the API (#28) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/38
- Call pon, chii and kan in the browser (#27) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/42
- Let CPU players call, and serve calls over the API (#27) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/41
- Add pon, chii and kan to the round engine (#27) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/40
- Speed up the race job by @litencatt in https://github.com/litencatt/mhj-dojo/pull/44
- Keep separate, refreshed build caches for the test jobs by @litencatt in https://github.com/litencatt/mhj-dojo/pull/45
- Run browser E2E tests in CI (#29) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/46
- Per-yaku shanten for open hands (#43) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/47
- Replay CPU moves one at a time (#29) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/48
- Score double yakuman (#29) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/49
- Choose the first dealer and the CPU level (#29) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/50
- Tidy up the deferred items from #30 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/51
- Bump actions/upload-artifact from 4.6.2 to 7.0.1 by @dependabot[bot] in https://github.com/litencatt/mhj-dojo/pull/52
- Center the hand row in its panel by @litencatt in https://github.com/litencatt/mhj-dojo/pull/58
- Bring the READMEs up to date (#54) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/59
- Settle pao for 大三元, 大四喜 and 四槓子 (#56) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/60
- Detect another tab moving a practice session (#53) by @litencatt in https://github.com/litencatt/mhj-dojo/pull/61
- Show the hand's blocks behind a 面子表示 toggle by @litencatt in https://github.com/litencatt/mhj-dojo/pull/62
- Show the 面子表示 toggle as a filter chip by @litencatt in https://github.com/litencatt/mhj-dojo/pull/63
- Lay the header out left and right by @litencatt in https://github.com/litencatt/mhj-dojo/pull/64
- Add discard advice to practice mode by @litencatt in https://github.com/litencatt/mhj-dojo/pull/65
- Dock the advice panel like the other panels by @litencatt in https://github.com/litencatt/mhj-dojo/pull/66
- Check scoring, settlement and standings against a Lean model by @litencatt in https://github.com/litencatt/mhj-dojo/pull/68
- Speed up the PR CI: reduced test sizes, nightly full suites, matrix jobs by @litencatt in https://github.com/litencatt/mhj-dojo/pull/69
- Turn open and added kan dora over after the next discard; rules audit tests and docs by @litencatt in https://github.com/litencatt/mhj-dojo/pull/70
- 複合役の向聴（役の組み合わせ）を表示する by @litencatt in https://github.com/litencatt/mhj-dojo/pull/71
- 練習モードを WebAssembly の静的サイトとしてビルドする（#67 第1段階） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/72
- chore: rename project to mhj-dojo by @litencatt in https://github.com/litencatt/mhj-dojo/pull/73
- docs: Lolipop Deploy Now の deploy ターゲットと公開URLを追加 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/74
- バージョン表示・公開版の新バージョン通知・ヘルプ by @litencatt in https://github.com/litencatt/mhj-dojo/pull/76
- Web: スマートフォン対応（下部タブバー・1行の手牌・2段組の役表・2タップ打牌）と既定パネルの変更 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/77
- Web: 麻雀道場に改名、スマホ表示の調整、牌を5萬・5筒・5索で表示 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/78
- Web: エラーメッセージの牌も記号ではなく名前で表示 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/79
- Web: スマホで捨て牌を手牌より少し小さく表示 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/80
- Web: バージョンの日付を閲覧者のタイムゾーンで表示 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/81
- MIT ライセンスと公開サイトの第三者ライセンス表示を追加 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/83
- E2E: CPU対戦の1局を通すテストの制限時間を60秒に by @litencatt in https://github.com/litencatt/mhj-dojo/pull/82
- 公開サイトを lolipop-deploy-now ブランチ経由でリリースする（#75） by @litencatt in https://github.com/litencatt/mhj-dojo/pull/84
- tagpr でリリース（CHANGELOG・タグ・GitHub Releases）し、公開サイトのヘッダーにバージョンを表示 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/86
- リリースのバージョンを v2026.0927.0（3区切り）に変更 by @litencatt in https://github.com/litencatt/mhj-dojo/pull/88
