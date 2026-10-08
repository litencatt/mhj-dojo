# 運用(足すときの手順と確認)

## 新しいページ・要素を足すとき

1. ページなら `.app` か `.dojo-home` を外枠に、ヘッダーは `SiteHeader`(新しいモードなら `MODE_LINKS` と `HelpMode` に足す)。
2. ボックスは `section` / `.dojo-panel`。個別に border・radius・padding を書かない。
3. ボタンは副か主のどちらかに既存のセレクタ群で合わせる。主ボタンは1か所に1つ。
4. 設定は `SettingsDialog` に集め、選択肢は枠付きの `fieldset`(`legend` つき)にする。
5. 色は `tokens.css` のトークンだけ。足りなければ light と dark の両方にトークンを足す。角丸は `--radius-*`。
6. スマホ(390x844 縦、横向き、ダーク)で崩れないか見る。ボタンは 32px 以上(操作欄もヘッダーの 設定 と同じ大きさ)、状態切り替えで高さが跳ねないこと。
7. 新しい `<dialog>` は `showModal()` と、閉じた後のフォーカス復帰を実装する。
8. アニメーションとホバーは上のメディアクエリの中に書く。
9. `make e2e` が通ること。見た目に関わるテストを変えたときは理由をコミットに書く。

## 確認

```
cd web && npm run typecheck
make build && make e2e
```

見た目は、`bin/mhj-dojo --port 8811 --open=false` で起動し、練習(`/?seed=1`)・CPU対戦(`/?mode=game&seed=1`)・道場(`/?mode=dojo`、対局開始後も)・更新情報(`/info/`)を、1280x900 と 390x844、ライトとダーク(`emulateMedia({colorScheme:'dark'})`)で撮って見比べる。設定ダイアログを開いた状態も撮る。
