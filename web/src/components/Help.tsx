import { useEffect, useRef, useState } from 'preact/hooks';

export interface HelpProps {
  // Brings the 用語表 panel back from the dock and shows it; without it (a CPU
  // game on a phone, which has no glossary) the help points to practice mode.
  onShowGlossary?: () => void;
}

// How the UI names tiles (tiles.ts tileName); the codes (5p, 0m, 7z) stay internal.
const TILE_NOTATION: Array<[string, string]> = [
  ['1萬〜9萬', '萬子（マンズ）'],
  ['1筒〜9筒', '筒子（ピンズ）'],
  ['1索〜9索', '索子（ソーズ）'],
  ['東・南・西・北・白・發・中', '字牌（風牌・三元牌）'],
  ['赤5萬・赤5筒・赤5索', '赤5（赤ドラ）'],
];

/** Whether a pointer event hit the modal dialog's backdrop: the dialog itself, outside its box. */
function onBackdrop(e: MouseEvent): boolean {
  const d = e.currentTarget as HTMLElement;
  if (e.target !== d) return false;
  const r = d.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}

/**
 * The ヘルプ button and the help it opens: a modal <dialog>, so the rest of
 * the page is inert while it is open, Esc closes it and focus goes back to
 * the button.
 */
export function Help({ onShowGlossary }: HelpProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  const showGlossary = () => {
    // Close now, so that the dialog's focus return to the help button comes
    // before the glossary takes the focus.
    ref.current?.close();
    setOpen(false);
    onShowGlossary?.();
  };

  return (
    <>
      <button
        type="button"
        class="help-button"
        aria-haspopup="dialog"
        aria-label="ヘルプ"
        title="ヘルプ"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      <dialog
        ref={ref}
        class="help-dialog"
        aria-labelledby="help-title"
        onClose={() => setOpen(false)}
        onPointerDown={(e) => {
          pressedOnBackdrop.current = onBackdrop(e);
        }}
        onClick={(e) => {
          // A click on the backdrop closes it, but not a drag (such as a
          // text selection) that only ends there, nor a click on the
          // dialog's own scrollbar (inside its box).
          if (pressedOnBackdrop.current && onBackdrop(e)) setOpen(false);
          pressedOnBackdrop.current = false;
        }}
      >
        {open && (
          <div class="help-content">
            <div class="help-heading">
              <h2 id="help-title">ヘルプ</h2>
              <button type="button" class="help-close" aria-label="ヘルプを閉じる" title="閉じる (Esc)" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <p class="help-lead">
              {onShowGlossary ? (
                <>
                  麻雀の用語は
                  <button type="button" class="help-link" onClick={showGlossary}>
                    用語表
                  </button>
                  で調べられます。
                </>
              ) : (
                '麻雀の用語は練習モードの用語表で調べられます。'
              )}
              このアプリの画面の項目は、下の「画面の用語」にあります。
            </p>

            <section aria-labelledby="help-about">
              <h3 id="help-about">このアプリについて</h3>
              <p>
                日本式リーチ麻雀の練習アプリです。一人打ちでツモと打牌を繰り返したり、CPU3人と東風戦・半荘戦を打ったりしながら、役ごとにあと何向聴か・どの牌が有効牌かを確認できます。
                リリースごとの変更は<a href="info/">更新情報</a>にあります。
              </p>
            </section>

            <section aria-labelledby="help-terms">
              <h3 id="help-terms">画面の用語</h3>
              <dl class="help-terms">
                <dt>シード</dt>
                <dd>山の並びを決める数。同じシードなら、配牌もツモ順も毎回同じになります。空欄で「新しい練習」「新規対局」を押すとランダムに決まります。</dd>
                <dt>巡目・最大巡目</dt>
                <dd>巡目は打牌した回数です。最大巡目（既定18）まで打つと流局になります。</dd>
                <dt>残り牌</dt>
                <dd>山に残っている牌の枚数です。</dd>
                <dt>役別向聴</dt>
                <dd>役ごとに、その役を満たす和了形まであと何向聴かを示す表です。手牌を最小何枚入れ替えればよいか − 1 で数えるので、役ごとの近道が分かります。</dd>
                <dt>合計枚数</dt>
                <dd>役別向聴の表で、その役の有効牌の残り枚数を合計したものです。</dd>
                <dt>近似</dt>
                <dd>平和の1向聴以上の値に付く印です。両面待ちの条件を除いて数えた目安で、実際はそれ以上かかることがあります。</dd>
                <dt>打牌プレビュー</dt>
                <dd>手牌の牌にカーソルを合わせる（タッチ操作では1回タップ）と、その牌を切った後の役別向聴と今との差を表示します。</dd>
                <dt>履歴ツリー</dt>
                <dd>打牌の履歴です。任意の巡目に戻って別の牌を切ると枝が増え、元の枝も残ります。</dd>
              </dl>
            </section>

            <section aria-labelledby="help-practice">
              <h3 id="help-practice">練習モード</h3>
              <ul>
                <li>
                  <b>配牌</b>：シード（空欄ならランダム）と最大巡目（既定18）を決めて「新しい練習」。同じシードなら配牌もツモ順も毎回同じです。
                </li>
                <li>
                  <b>打牌</b>：手牌かツモ牌をクリックすると切ります。スマートフォンなどのタッチ操作では、1回目のタップで牌を選び（持ち上がり、切った後の表を表示）、同じ牌をもう一度タップすると切ります。最大巡目まで打つと流局です。
                </li>
                <li>
                  <b>ツモ</b>：和了形になると「ツモ」ボタンが出ます。押すと成立役と翻数を表示します。
                </li>
                <li>
                  <b>履歴ツリー</b>：行をクリックするとその局面に戻れます。戻って別の牌を切ると新しい枝ができ、元の枝も残るので、同じ山で打ち筋を比べられます。各行の向聴は一般形（4面子1雀頭）で数えるので、七対子・国士無双も考えるアドバイスの向聴と違うことがあります。
                </li>
                <li>
                  <b>時系列チャート</b>：巡目ごとの役別向聴の推移です。凡例をクリックすると役の表示を切り替えます。
                </li>
                <li>
                  最初に開いているのは手牌と役別向聴の表だけで、時系列チャート・履歴ツリー・アドバイス・用語表は画面右端（スマートフォンでは画面下）のタブにしまってあります。タブをクリックすると開き、各パネルの「–」でまたタブに戻せます。開き方はブラウザに保存されます。URL にセッションとシードが入るので、再読み込みしても続きから再開できます。
                </li>
              </ul>
            </section>

            <section aria-labelledby="help-yaku">
              <h3 id="help-yaku">役別向聴の表の見方</h3>
              <ul>
                <li>
                  <b>向聴</b>：その役で聴牌するまでに、あと何枚の有効牌が必要か。0 は「聴牌」（あと1枚で和了）、和了した手は「和了」（−1）と表示します。「不可」はその役にできない手、「近似」は平和の1向聴以上の目安です。三暗刻・四暗刻はツモ和了で数えます（シャンポン待ちのロンでは付かないことがあります）。
                </li>
                <li>
                  <b>有効牌</b>：引くと向聴数が1つ減る牌。牌の下の数字は残り枚数（4枚から、手牌・ツモ牌・捨て牌・ドラ表示牌で見えている枚数を引いた数）です。<b>合計枚数</b>はその合計です。
                </li>
                <li>
                  <b>翻</b>：その役の翻数。役名にカーソルを合わせる（キーボードならフォーカス、タッチ操作ではタップ）と成立条件を表示します。聴牌（または和了）した役の行は薄い赤、それ以外で役満を除き最も聴牌に近い行は黄色で示します。
                </li>
                <li>
                  <b>打牌ごとの比較</b>：手牌の牌にカーソルを合わせる（キーボードならフォーカス、タッチ操作では1回タップ）と、その牌を切った後の表に切り替わり、今との差（−1 は前進、+1 は後退）を表示します。
                </li>
                <li>
                  <b>フィルター</b>：役名・読みで検索、向聴の上限、1翻・2翻・3翻以上・役満の切り替え、並べ替え（向聴が近い順・有効牌が多い順）。「条件をクリア」で元に戻ります。設定はブラウザに保存されます。
                </li>
              </ul>
            </section>

            <section aria-labelledby="help-combo">
              <h3 id="help-combo">複合役</h3>
              <p>
                表の上の「複合役」は、同じ和了形で同時に成立する役の組み合わせ（例：断么九＋平和）の上位5件です。翻・向聴・有効牌を表示し、「向聴1つ＝2翻」とみなした評価で並べています。
              </p>
            </section>

            <section aria-labelledby="help-groups">
              <h3 id="help-groups">面子表示</h3>
              <p>
                手牌の見出しの「面子表示」を押すと、手牌を順子・刻子・雀頭・両面・嵌張・辺張・対子・浮き牌のまとまりに分けて表示します。もう一度押すと元の並びに戻ります。
              </p>
            </section>

            <section aria-labelledby="help-advice">
              <h3 id="help-advice">アドバイス</h3>
              <p>
                練習モードの「アドバイス」パネルは、答えが先に見えないよう最初はほかのパネルと同じく画面右端（スマートフォンでは画面下）のタブにしまってあります。開くと、おすすめの打牌3つ（向聴・有効牌の種類と枚数。向聴は一般形・七対子・国士無双のうち近いもの）、残りツモ、聴牌・和了までの確率の目安、方針、近い役を表示します。
                候補にカーソルを合わせる（キーボードならフォーカス、タッチ操作ではタップ）と手牌の同じ牌に印が付きます。打牌した後は、その打牌の評価を表示します。
              </p>
            </section>

            <section aria-labelledby="help-game">
              <h3 id="help-game">CPU対戦</h3>
              <p>
                ヘッダーの「CPU対戦へ」から、CPU3人と東風戦・半荘戦を、鳴き・リーチ・点数計算ありで打てます。役別向聴の表と用語表も使えます（スマートフォンでは役別向聴の表を広く取るため、時系列チャートと用語表は練習モードだけです）。CPUの手の再生速度は「再生速度」で選べます（すぐ反映、「なし」で一括表示）。鳴いていない手ではアドバイス欄（スマートフォンを除く）が使え、他家がリーチすると手牌に危険度（安・低・中・危）が付きます（「アドバイス・危険度」で切り替え）。安はリーチした人の現物（自身の捨て牌と、リーチ後に誰かが通した牌）です。
              </p>
            </section>

            <section aria-labelledby="help-dojo">
              <h3 id="help-dojo">道場</h3>
              <ul>
                <li>
                  <b>役の制限</b>：持っていない役は翻に数えません。持っている役が1つも成立しない手は、ドラがあっても和了れません（CPU に制限はありません）。結果には、手にあっても数えなかった役を「未修得」と灰色で示します。役別向聴の表と時系列チャートには、持っている役の行だけが出ます。
                </li>
                <li>
                  <b>フリテン</b>：持っていない役だけで待っている牌は和了れません。その牌を見逃すと、通常のルールどおりフリテンになります。
                </li>
                <li>
                  <b>成長</b>：東風戦（CPU は弱い）を終えると、順位と数えた翻に応じて経験値とコインがもらえます。レベルが上がるとショップの商品が増え、コインで役・牌の配色・補助表示・イカサマを買えます。初めに持っている役は断么九と平和だけで、立直と役牌はショップで買います。
                </li>
                <li>
                  <b>イカサマ</b>：「透視」は局の途中で他家の手牌を表示します。「引き直し」は、ツモ牌を山の末尾に戻して次の牌を引きます（1局1回、1巡目と立直中は不可）。使うたびにコインを払い、対局を終えるときに精算します。
                </li>
                <li>
                  道場のデータはこのブラウザにだけ保存されます。道場のハブで書き出し・読み込みができます。
                </li>
              </ul>
            </section>

            <section aria-labelledby="help-tiles">
              <h3 id="help-tiles">牌の表記</h3>
              <table class="help-tiles">
                <tbody>
                  {TILE_NOTATION.map(([k, v]) => (
                    <tr key={k}>
                      <th scope="row">{k}</th>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section aria-labelledby="help-save">
              <h3 id="help-save">保存</h3>
              <p>
                計算（CPUの打牌も）はすべてブラウザの中で行い、手順はサーバーに送りません。練習は最近の10セッション、CPU対戦は最近の5対局の手順をこのブラウザに保存し、再読み込みや同じ URL を開いたときに復元します。シードなどを付けずに開くと、最後に使ったものを「続きから」で、ほかを一覧から再開できます。ブラウザのデータを消すと失われます。一度開いたあとは、オフラインでも練習とCPU対戦ができます。同じブラウザで同じセッションや対局を進められるのは一度に1つのタブだけです。別のタブで同じ URL を開くと前のタブは停止し、「このタブで続ける」を押すと、そのタブが最後に進めた状態から続けられます（今度はもう一方のタブが停止します）。
              </p>
            </section>

            <section aria-labelledby="help-version">
              <h3 id="help-version">バージョン表示</h3>
              <p>
                ヘッダーのバージョン表示を押すと<a href="info/">更新情報</a>を開きます。「v2026.0927.0」はリリースした日付と、その日の何回目のリリースか（0 から数えます）です。新しいバージョンが出ると「新しいバージョンがあります」と表示されるので、「再読み込み」で更新できます。
              </p>
            </section>

            <section aria-labelledby="help-license">
              <h3 id="help-license">ライセンス</h3>
              <p>
                mhj-dojo は MIT ライセンスです。画面には Preact（MIT ライセンス）を使っています。計算エンジンには Go のランタイムと <code>wasm_exec.js</code>（BSD 3-Clause ライセンス）も含まれます。これらのライセンス文は
                <a href="THIRD_PARTY_LICENSES.txt" target="_blank" rel="noopener">
                  THIRD_PARTY_LICENSES.txt
                </a>
                にあります。
              </p>
            </section>
          </div>
        )}
      </dialog>
    </>
  );
}
