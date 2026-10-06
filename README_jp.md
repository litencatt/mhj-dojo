# mhj-dojo

日本式リーチ麻雀を練習するためのWebアプリです。CLI `mhj-dojo` を起動すると、ブラウザでアプリが開きます。公開サイトと同じビルドで、エンジンはブラウザ内（WebAssembly）で動きます。一人打ちで役別向聴を見ながら練習することも、鳴きとリーチのある東風戦・半荘戦をCPU3人と打つこともできます。

[English README](README.md)

インストール不要の同じアプリ: https://mhj-dojo.lolipop-now.app/

## 練習モード

- **一人打ち練習**：シード付きの山でツモと打牌を繰り返します。同じシードなら、配牌もツモ順も毎回同じです。ツモ和了するか、既定の18巡で終局します。
- **役別向聴**：ツモと打牌のたびに、各役まであと何向聴か、有効牌は何か、その残り枚数は何枚かを表示します。対象は次のとおりです。
  一般形、断么九、平和、一盃口、二盃口、三色同順、三色同刻、一気通貫、混全帯么九、純全帯么九、混老頭、混一色、清一色、対々和、三暗刻、小三元、役牌（白・發・中・東）、七対子
  役満：国士無双、四暗刻、大三元、字一色、小四喜、大四喜、緑一色、清老頭、九蓮宝燈
- **役別向聴の表の機能**：翻の列、役名のツールチップ（成立条件）、絞り込み（役名・読みでの検索、向聴数、1翻・2翻・3翻以上・役満の切り替え）と並べ替え（向聴が近い順・有効牌が多い順）。
- **複合役**：同じ和了形で同時に成立する役の組み合わせ（例: 断么九＋平和＋三色同順）について、向聴・翻・有効牌を上位5件表示します。並び順は「向聴1つ＝2翻」とみなした評価値です（[docs/api.md](docs/api.md)）。
- **ドラ・裏ドラ**：ヘッダーにドラ表示牌とドラを表示します。裏ドラ表示牌は終局までは伏せたままです。
- **打牌プレビュー**：牌にカーソルを合わせると、その牌を切った後の向聴表を、現在の値との差分付きで表示します。
- **時系列チャート**：巡目ごとの役別向聴の推移です。凡例から表示する役を切り替えられます（役満は凡例の末尾にまとめ、初期状態では非表示）。
- **巻き戻し可能な履歴ツリー**：任意の巡目に戻って、別の牌を切れます。新しい枝が増え、元の枝も残ります。同じ山で打ち筋を比べられます。
- **和了表示**：ツモ和了すると、成立役・翻数・ドラ（赤5を含む）を表示します。役満は1つにつき13翻（四暗刻単騎・国士無双十三面待ち・純正九蓮宝燈・大四喜はダブル役満で26翻）で複合し、ドラは表示のみで加算しません。
- **用語表**：画面で使う用語（向聴・有効牌・待ちの形・ルール・アプリの機能）の説明一覧。検索できます。幅の広い画面では役別向聴の右に表示します。
- **ヘルプとバージョン**：ヘッダーの **?** で画面の使い方を表示します。その横に、ビルド元のコミットと日付、またはリリース名（`v2026.0927.0` など）を表示します。
- **パネルの最小化**：時系列チャート・履歴ツリー・用語表は、画面右端のタブに最小化でき、クリックで元に戻せます。状態は再読み込み後も残ります。
- **URLからの再開**：ページのURLにセッションとシードが入り、操作はブラウザに保存されるので（[保存](#保存)）、再読み込みしても続きから再開できます。

既定のルールは、赤5×3枚、喰いタンあり、後付けありです。一人打ち練習では場風・自風とも東に固定しています。

## CPU対戦

ヘッダーの **CPU対戦へ**（または `/?mode=game`、`/?mode=game&seed=42`）から、CPU3人との東風戦（東1局のみ）または半荘戦（東・南）を、鳴きとリーチ、点数計算ありで打てます。

- **卓**：全員の河（リーチ宣言牌は横向き、鳴かれた牌はその副露に表示）、副露、点数、自風と親を表示します。CPUの手牌は終局まで伏せたままです。**対局: 東風戦** / **半荘戦**、**起家: ランダム**（シードを4で割った余り）/ **自分** を選べます。
- **操作**：打牌、**リーチ**（聴牌が残る牌だけ選べます。以後のツモ牌は和了できるとき以外は自動でツモ切り）、**ツモ**、捨て牌で和了れるときは **ロン** / **見逃す**、鳴きが選べるときの **ポン** / **チー** / **カン**、自分の手番での暗槓・加槓。
- **鳴き**：ポンと明槓は他家全員の捨て牌に、チーは上家の捨て牌にのみ宣言できます。その局の最後の捨て牌は鳴けません。リーチ中はロンと、待ちが変わらない暗槓だけができます。ポン・チーの直後は、鳴いた牌と同じ種類（辺張チーは筋の反対側の牌も）を打てません（喰い替え）。加槓は槍槓（チャンカン）で振り込みます。カンをすると嶺上牌をツモり（和了れば嶺上開花）、槓ドラが増えます。鳴くと門前限定の役が消え、食い下がりの役は翻が1つ下がります。
- **CPUの打牌の再生**：あなたの操作のあと、CPU全員分の手番をエンジンがまとめて処理し、卓の表示はそれを1手ずつ再生します（打牌・鳴き・リーチ）。**スキップ** ボタンで、あなたの次の選択まで一気に進められます。
- **ルール**：リーチ、ダブルリーチ、一発、裏ドラ、海底・河底、天和・地和、フリテン（自分の捨て牌・同巡内・リーチ後の見逃し）、頭ハネ、流局時のノーテン罰符、途中流局（九種九牌・四風連打・四家立直・四開槓）。流し満貫はなし。
- **点数**：符と翻、満貫から（数え）役満まで、ダブル役満と複合役満（ダブル役満は26翻、複数の役満は合算）、親・子の支払い、本場（ロン300点／ツモ各100点）とリーチ棒（誰かが和了るまで場に残ります）を、終局時の点数の増減とともに表示します。
- **対局の進行**：親は和了・聴牌での流局・途中流局のときに連荘し、それ以外は次の親に移ります。本場は連荘と流局（途中流局を含む）で1つ増え、子の和了で0に戻ります。最終局が終わる（親が連荘のときを除く）か、誰かの点数が0点未満になる（トビ）と終局します。最終順位は点数順（ウマ +20 / +10 / −10 / −20、オカ トップに+20）で決まります。
- **鳴いた手の役別向聴**：副露は固定の面子として扱われ、向聴は残りの手牌だけで数えます。副露がその役の形に合わない場合はその行が不可能になります。副露があると七対子・国士無双・九蓮宝燈・平和・二盃口は成立せず、ポン・チー・明槓で手が開くと一盃口・四暗刻も成立しません（暗槓だけなら門前は保たれます）。
- **CPU**：**CPU: 普通** は和了れるときは必ず和了り、聴牌したらリーチし、役が残る鳴きをし、手が悪くならないカンをし、牌効率で打牌し、他家のリーチには2向聴以上で降ります。**CPU: 弱い** も和了りとリーチはしますが、鳴かず・カンせず・降りず、牌効率で劣る打牌をよくします（どちらもシードからの再現性はそのままです）。
- **練習機能はそのまま**：役別向聴の表（風牌の行は自風と場風に合わせます）、打牌プレビュー、時系列チャート、用語表が使えます。対戦では巻き戻しはできません。
- **シード**：自分で指定したシードなら、CPUの打牌も含めて同じ展開を再現できます。ランダムなシードは終局時に表示します。同じブラウザで対局や練習セッションを進められるのは一度に1つのタブだけで、別のタブで開くと前のタブは停止します（「このタブで続ける」で取り戻せます）。

### 役別向聴の定義

13枚の手牌 H と役 Y について、「H の牌を最小何枚入れ替えれば Y を満たす14枚の和了形になるか − 1」を役別向聴とします（聴牌 = 0、和了 = −1）。引くとこの値が下がる牌が、その役の有効牌です。

平和は、聴牌時は両面待ちかどうかまで厳密に判定します。1向聴以上は待ちの形を考えない近似値で、画面に「近似」と表示します。詳しくは [docs/api.md](docs/api.md) を参照してください。

## 必要環境

- Go 1.27 以上
- Node.js 24 以上（バイナリに埋め込む画面（フロントエンド）のビルドに使います）

## クイックスタート

```sh
make build        # 静的サイトをビルド（make embed）してから、それを埋め込んだ bin/mhj-dojo をビルド
./bin/mhj-dojo    # http://127.0.0.1:8765 で起動し、ブラウザを開く
```

ビルド済みの画面はコミットしていないため、`go build` や `go install github.com/litencatt/mhj-dojo/cmd/mhj-dojo@latest` だけで作ったバイナリには画面が入りません。何も遊べず、画面には `make build` で作り直すよう案内が出るだけです。ビルド済みのバイナリは配布していないので、リポジトリを取得して `make build` を使ってください。

### オプション

| オプション | 既定値 | 説明 |
|---|---|---|
| `--port` | `8765` | 待ち受けポート（`0` で空きポートをランダムに使用） |
| `--host` | `127.0.0.1` | バインドするホスト |
| `--open` | `true` | 起動時にブラウザを開く |
| `--seed` | ランダム | 一人打ち練習をこのシード（0〜2^53-1）の山で開く（`/?seed=N` のページ）。新しく始める練習やCPU対戦には影響しません |

`Host` ヘッダーが localhost かループバックアドレスを指すリクエストにしか応答しません。他サイトのページが DNS リバインディングでアプリに到達するのを防ぐためです。そのため `--host 0.0.0.0` を指定しても、他の端末のブラウザからは開けません（ループバック以外のアドレスで待ち受けると起動時に警告を出します）。

### 保存

練習とCPU対戦はブラウザの localStorage に保存します（最近の10セッションと5対局まで）。再読み込みや `mhj-dojo` の再起動のあとも続きから遊べます。保存が使えないときは、URL にシードがあれば同じ山で配り直します。localStorage はオリジン（ホストとポート）ごとなので、`--port` を変えたり `localhost` で開いたりすると保存は別になります。

## 開発

```sh
make test         # go test ./...
make vet          # go vet ./...
make embed        # make site（必要なら先に npm ci）の結果を internal/server/static/dist にコピー（コミットしません）
make run          # make embed のあと go run ./cmd/mhj-dojo
```

`web/` やエンジンを変えたら `make embed` で作り直してください（`make build` や `make run` でも作り直します）。`go build` や `go run` だけでは、最後に `make embed` でコピーした画面がそのまま埋め込まれます。

エンジンへの操作はすべて `internal/apicall` を通します（WebAssembly 版のエンジンは `apicall.Route` で応答します）。その振る舞いのテストも `internal/apicall` にあります。新しい操作はここに追加し、画面からはブラウザの中のエンジン（`web/src/wasm.ts`）を通してだけ呼びます。

ホットリロード付きでフロントエンドを開発する場合は、次のコマンドで開発サーバを起動します。エンジンはページの中で動くので、先に `make wasm` で `web/site-public/` に作っておいてください。

```sh
make wasm
cd web && npm run dev
```

ブラウザのE2Eテスト（Playwright + Chromium）は、一人打ち練習、CPU対戦（鳴き・局の結果・次局・スマホでの表示）、ヘルプと更新情報ページをカバーします。テストは `web/e2e/` にあり、`npm run e2e` は埋め込んだサイトビルド（後述）を配信する専用の `mhj-dojo` サーバを自前で起動して実行するので、他にサーバを立てておく必要はありません。

```sh
cd web && npx playwright install --with-deps chromium   # 初回のみ
make embed && cd web && npm run e2e
```

`make e2e` なら `bin/mhj-dojo` をビルドして、`go run` の代わりにそれに対してテストを実行します（`EXTRA=--shard=1/3` やスペックのパスで絞り込めます）。`npm run e2e` でも `MHJDOJO_BIN=<パス>` で同じことができ、CI はこれを使います。

### 静的サイト（WebAssembly）

このアプリは静的サイトです。Go のエンジン（`cmd/mhj-dojo-wasm`）を WebAssembly にし、画面が固まらないよう Web Worker で動かします。リクエストの形式は [docs/api.md](docs/api.md) のとおりです。`mhj-dojo`（`make embed`）でも、どの静的ホスティングでも配信できます。

```sh
make site         # make wasm（GOOS=js GOARCH=wasm → web/site-public/mhj-dojo.wasm と wasm_exec.js）のあと npm run build:site
```

出力先は `web/dist-site/`（コミットしません）で、`index.html`・JS・CSS・`worker.js`・`mhj-dojo.wasm`・Go の `wasm_exec.js` が入ります。パスは相対なので、どの静的ホスティングのどのサブパスにも置けます。`.wasm` は `application/wasm` で配信してください（他の MIME でも動きますが起動が遅くなります）。確認は `cd web && npm run preview` です。

Lolipop Deploy Now で https://mhj-dojo.lolipop-now.app/ に公開しています。

`info/` の更新情報のページ（https://mhj-dojo.lolipop-now.app/info/）は、ビルドのときに `CHANGELOG.md` から作るので、リリースのビルドにはそのリリースまでが載ります。作者の表記を除き、CI・依存関係・E2E だけの変更は載せず、最初のリリースは「最初の公開」とだけ書きます。GitHub の PR やリリースへのリンクは付けません（`web/src/changelog.ts`）。`mhj-dojo` も、ビルドした同じページを `/info/` で出します。

#### デプロイ

ビルドとデプロイは 2 つのワークフローに分かれていて、リリースの成果物は特定のホストに縛られません。リリースには [tagpr](https://github.com/Songmu/tagpr) を使います（`.tagpr`、`.github/workflows/tagpr.yml`）。

1. `main` に push されるたびに、tagpr がリリース用 PR を最新に保ちます。この PR は、GitHub のリリースノート自動生成（`.github/release.yml`）で `CHANGELOG.md` をカテゴリ別（新機能・修正・パフォーマンス・ドキュメント・CI・リポジトリ・依存関係・その他）に更新します。カテゴリは、各 PR の head ブランチ名の接頭辞から **Label pull requests**（`.github/workflows/labeler.yml`）が付けるラベル（`feat/` → enhancement、`fix/` → bug、`perf/` → performance、`docs/` → documentation、`ci/` → ci、`chore/`/`build/`/`test/` → chore、`dependabot/` → dependencies）で決まります。
2. その PR をマージすると、リリースのタグ（日本の日付とその日の何回目か。`v2026.0927.0`、次は `v2026.0927.1`）と GitHub Release が作られます。続けて同じワークフローが、そのタグで **Build site release**（`.github/workflows/build-site-release.yml`）を実行します。Build site release は、タグのコミットをヘッダーにリリース名を入れてビルドし（`MHJDOJO_RELEASE`）、そのビルドで公開サイトの E2E テストを実行し、`web/dist-site` を `mhj-dojo-site-<tag>.tar.gz`（と `.sha256`）にまとめて、そのタグの GitHub Release に添付します。
3. Build site release は続けて **Deploy to Lolipop**（`.github/workflows/deploy-lolipop.yml`）をそのタグで呼び出します。この成果物をダウンロード・検証し、`lolipop-deploy-now` から切ったリリース用ブランチにタグを取り込み、そのブランチの `web/dist-site` を成果物の内容に完全に置き換えて（Deploy Now では Go の WebAssembly エンジンをビルドできないため。`main` では `.gitignore` 対象）、`lolipop-deploy-now` 向けの PR を作ります。公開サイトはこの `lolipop-deploy-now` ブランチから公開されます。Lolipop Deploy Now の GitHub 連携がこのブランチを監視していて（フレームワーク: 静的サイト、インストール・ビルドコマンドなし、出力ディレクトリ `web/dist-site`）、マージされるたびに公開します。
4. その PR を「Create a merge commit」でマージすると（squash しない）、リリースが公開されます。
5. `lolipop-deploy-now` への push で **Verify live site**（`.github/workflows/verify-live.yml`）が動きます。公開サイトの `version.json` がそのリリースになるまで最大 10 分待ち、公開サイトのスモークテスト（`EXPECT_RELEASE=<tag> npm run e2e:live`）を実行します。失敗すると `ci` ラベルの issue を作ります。

手作業で残るのは、tagpr が作るリリース PR のマージと、公開用 PR のマージ（マージコミット）です。どちらも `GITHUB_TOKEN` で作られるため CI が動かず、チェックは付きません（`gh pr checks --watch` は監視するものがなく、すぐ戻ることがあります）。タグと公開用 PR の中身は作成前に Build site release が、公開後の状態は Verify live site が確認します。リリース PR のマージによる `main` への push は `CHANGELOG.md` だけの変更で、`ci.yml` は `paths-ignore` で対象外にします。Build site release がタグで失敗したら、不安定な失敗なら再実行し、本当の不具合なら `main` を直して改めてリリースしてください（失敗したタグは公開されません）。

Build site release、Deploy to Lolipop、Verify live site は手動でも実行できます（Actions → 各ワークフロー → Run workflow）。Build site release はタグを指定するか、空欄で `main` をそのまま対象にします（タグなしの場合はビルドと E2E のみを行い、成果物はワークフローアーティファクトとして残すだけで、Release への添付やデプロイの呼び出しは行いません）。Deploy to Lolipop は、成果物がまだ Release に残っている既存のタグを指定して再デプロイ、または**ロールバック**に使えます。`web/dist-site` はファイル単位でマージせず完全に置き換えるため、どちらの操作でも、ブランチには間のタグの内容を持ち込まず、指定したタグどおりのファイルだけが残ります。Verify live site はタグを指定（または空欄で `lolipop-deploy-now` から取得）して公開サイトを再確認できます。Build site release と Deploy to Lolipop には「Allow GitHub Actions to create and approve pull requests」（Settings → Actions → General）が必要です。また、これらが作る PR では CI が動きません（公開サイトの E2E は Build site release 自身が実行し、それ以外は `main` の CI で確認済みです）。

サイトの公開先 URL（OGP タグなどに使用）は 1 か所に集約しています。ビルド時変数 `MHJDOJO_SITE_URL` が、リポジトリ変数 `SITE_URL` から読み込まれ（`gh variable set SITE_URL --body https://your-host.example/` のように末尾のスラッシュ込みで設定）、未設定なら現在の `https://mhj-dojo.lolipop-now.app/` にフォールバックします。`web/playwright.live.config.ts`（`web/` で `npm run e2e:live`。直接 URL を指定するときは `LIVE_BASE_URL=... npm run e2e:live`）も同じ変数をデフォルトのベース URL として読みます。

**別のホストへ移行するとき**: `deploy-lolipop.yml` と同じ `mhj-dojo-site-<tag>.tar.gz` を Release からダウンロードする `deploy-<host>.yml`（`workflow_call` + `workflow_dispatch`、入力は `tag`）を追加し、そのホストに合わせて公開する処理を書いたら、`build-site-release.yml` の呼び出し先を新しいワークフローに変更してください（あわせてリポジトリ変数 `SITE_URL` も新しいホストに変更します）。ビルド自体はホストに依存しない成果物を作るだけなので、変更は不要です。

手動でデプロイする場合は、初回のみ `npx lolipop login`（ブラウザでの認可）を実行し、あとは `DEPLOY_PROJECT=<id> make deploy`（または事前に `export DEPLOY_PROJECT=<id>`）でビルドから公開まで行います。プロジェクトIDはコミットしておらず、Lolipopアカウントごとに異なるため、`npx lolipop project list` で確認してください（`DEPLOY_PROJECT` が未設定だと `make deploy` はその旨のメッセージを出して即座に失敗します）。Lolipop のプロジェクトは `npx lolipop project create --name mhj-dojo --framework static --install "" --build "" --output "."` で一度だけ作成済みで、`make deploy` はそのプロジェクトへビルドを送るだけです。`make deploy` は `web/dist-site/` をこのリポジトリの外の一時ディレクトリにコピーしてからデプロイします。`web/dist-site/` と `mhj-dojo.wasm` は `.gitignore` 対象で、`lolipop` CLI は `--dir` が git リポジトリ内にあると gitignore されたファイルを無視してしまうためです。Deploy Now は `index.html` を `max-age=86400` で配信するため、再訪問者のキャッシュに新しいデプロイが届くまで最大で1日かかることがあります。`index.html` はエンジン（worker、`wasm_exec.js`、`mhj-dojo.wasm`）をそれらのハッシュ値の `?v=<hash>` 付きで読み込むので（`web/src/wasm.ts` 参照）、古い `index.html` が新しいエンジンと混ざる（またはその逆）ことはありません。

サイトのビルドは `version.json`（`{"version": "<コミット>", "id": "<ビルド入力のハッシュ>", "built": "<時刻>"}`）も書き出します。コミットは `MHJDOJO_VERSION` で上書きでき、git の外では `dev` です。開いているページは起動時・10分ごと・タブに戻ったときにこれを確認し、新しいビルドが公開されていれば「新しいバージョンがあります」と表示します。「再読み込み」は、キャッシュされた `index.html` を避けるため `_v=<id>` を付けたURLでページを読み直します。

あわせて `sw.js`（Service Worker）も書き出します。ビルドのファイル（ページ・ハッシュ付きの資産・エンジン・アイコン・manifest）を先にキャッシュし、一度開いたあとはオフラインでも使えます。ページはネットワークから取得し、オフライン・5xx・4 秒以内に応答がないときはキャッシュを使います。それ以外のキャッシュしたファイルはキャッシュから、`version.json` は常にネットワークから取得します。新しいビルドの Service Worker は、そのビルドのページを開いたとき（「再読み込み」でも開きます）に切り替わります。`mhj-dojo` も自分の localhost のポートで登録します。`MHJDOJO_SW=off` でビルドすると停止できます（新しいページが、エンジンの起動後に登録を解除してキャッシュを消します）。CDN は `sw.js?v=<id>` を 1 年間キャッシュするため、登録済みの Service Worker は古い `sw.js` を受け取り続けます。止まるのは新しいページを開いたときです（ネットワーク優先。CDN が `index.html` を返す期間は最大で約 24 時間）。

サイトビルドの `index.html` には、絶対URLの Open Graph / Twitter 共有タグ（`og:url`、`og:image`、`twitter:image`）も入ります。同じ `MHJDOJO_SITE_URL` から組み立てます。`mhj-dojo` はこのビルドをそのまま埋め込みます（`make embed`、タグも含む）。

### ディレクトリ構成

```
cmd/mhj-dojo/        CLI のエントリポイント
cmd/mhj-dojo-wasm/   静的サイト用のエンジン（WebAssembly）
internal/tile/       牌の表現と表記
internal/wall/       シード付きの山、配牌、ツモ
internal/memo/       シャンテン計算用の上限付きメモ
internal/shanten/    一般形・七対子・国士無双の向聴と有効牌
internal/yakushanten/ 役別向聴
internal/yaku/       和了形の分解、役とドラの判定
internal/apiview/    練習と対戦で共有するJSON表現
internal/session/    一人打ちセッションと履歴ツリー
internal/score/      翻と符からの点数計算
internal/game/       4人打ちの局の進行（リーチ・フリテン・精算）
internal/cpu/        CPU の思考
internal/match/      CPU 対戦
internal/store/      エンジンのセッションと対局のメモリ保持
internal/apicall/    エンジンへのすべてのリクエストの入口（apicall.Route）
internal/server/     埋め込んだサイトビルドの静的ファイル配信
web/                 Vite + Preact + TypeScript のフロントエンド
docs/api.md          エンジンへのリクエストの形式と各種定義
```

牌の表記は `1m`〜`9m`（萬子）、`1p`〜`9p`（筒子）、`1s`〜`9s`（索子）、`1z`〜`7z`（東南西北白發中）です。赤5は `0m` / `0p` / `0s` と書きます。

## ライセンス

MIT ライセンスです。[LICENSE](LICENSE) を参照してください。

静的サイトには第三者のソフトウェア（Preact と、WebAssembly エンジンに含まれる Go のランタイム・`wasm_exec.js`）も含まれます。それらのライセンスは [web/site-public/THIRD_PARTY_LICENSES.txt](web/site-public/THIRD_PARTY_LICENSES.txt) にあり、サイトでは `THIRD_PARTY_LICENSES.txt` として配信しています。
