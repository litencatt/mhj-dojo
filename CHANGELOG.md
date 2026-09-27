# Changelog

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
