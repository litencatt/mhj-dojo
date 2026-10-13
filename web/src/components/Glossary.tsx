import { memo } from 'preact/compat';
import { useState } from 'preact/hooks';
import { PanelHeading } from './PanelHeading';
import { toKatakana } from './yakuFilter';

interface Term {
  term: string;
  reading: string;
  body: string;
  game?: string | null; // wording in game mode; null hides the term there
}

interface Group {
  title: string;
  terms: Term[];
}

const GROUPS: Group[] = [
  {
    title: '向聴・有効牌',
    terms: [
      { term: '向聴', reading: 'シャンテン', body: '聴牌まであと何枚の有効牌が必要かを表す数。1向聴なら有効牌を1枚引けば聴牌。' },
      { term: '聴牌', reading: 'テンパイ', body: 'あと1枚で和了れる状態。表では「聴牌」（0向聴）と表示。' },
      { term: '和了', reading: 'ホーラ', body: '手牌が完成した状態。表やチャートでは −1 として扱う。' },
      { term: '有効牌', reading: 'ゆうこうはい', body: '引くと向聴数が1つ減る牌。受け入れとも言う。種類と残り枚数が多いほど手が進みやすい。' },
      { term: '残り枚数', reading: 'のこりまいすう', body: '各牌4枚から、手牌・ツモ牌・捨て牌・ドラ表示牌で見えている枚数を引いた数。有効牌の下の数字。' },
      { term: '空聴', reading: 'からテン', body: '聴牌しているが、待ち牌がすべて見えていて残り0枚の状態。' },
      { term: '一般形', reading: 'いっぱんけい', body: '役の条件を付けない4面子1雀頭の形。通常の向聴数。七対子・国士無双は別の行。' },
      { term: '打牌', reading: 'ダハイ', body: '手牌から1枚を切ること。「打 9萬」は9萬を切ること。' },
      { term: '巡目', reading: 'じゅんめ', body: '自分が何回目のツモ・打牌をしているか。1巡目が最初の打牌。' },
      { term: 'ツモ切り', reading: 'ツモぎり', body: '引いた牌をそのまま切ること。手の中の牌を切るのは手出し。' },
    ],
  },
  {
    title: '手の形',
    terms: [
      { term: '面子', reading: 'メンツ', body: '3枚1組の形。順子か刻子。和了形は基本的に4面子1雀頭。' },
      { term: '順子', reading: 'シュンツ', body: '同じ種類の連続した数字3枚（例 3・4・5萬）。' },
      { term: '刻子', reading: 'コーツ', body: '同じ牌3枚（例 白白白）。' },
      { term: '雀頭', reading: 'ジャントウ', body: '同じ牌2枚の組。和了形に1つ必要。' },
      { term: '塔子', reading: 'ターツ', body: 'あと1枚で面子になる2枚の組（両面・嵌張・辺張）。' },
      { term: '対子', reading: 'トイツ', body: '同じ牌2枚の組。雀頭にも、あと1枚で刻子にもなる。' },
      { term: '浮き牌', reading: 'うきはい', body: '面子・塔子・対子のどれにもなっていない1枚。切る候補になりやすい。' },
      { term: '数牌・字牌', reading: 'シューパイ・ジハイ', body: '萬子・筒子・索子の1〜9が数牌。東南西北と白發中が字牌。' },
      { term: '么九牌', reading: 'ヤオチューハイ', body: '数牌の1・9（老頭牌）と字牌。2〜8の数牌は中張牌。断么九は么九牌を使わない役。' },
      { term: '三元牌', reading: 'サンゲンパイ', body: '白・發・中の3種。刻子にすると役牌（1翻）。' },
    ],
  },
  {
    title: '待ち',
    terms: [
      { term: '両面', reading: 'リャンメン', body: '連続した2枚で、両側の2種類を待つ形（例 4・5で3・6待ち）。平和の条件。' },
      { term: '嵌張', reading: 'カンチャン', body: '間の1種類を待つ形（例 4・6で5待ち）。' },
      { term: '辺張', reading: 'ペンチャン', body: '端の1・2か8・9で、3か7の1種類を待つ形。' },
      { term: '単騎', reading: 'タンキ', body: '1枚で雀頭を待つ形。' },
      { term: '延べ単', reading: 'ノベタン', body: '連続した4枚（例 2345）で、両端の単騎を待つ形。平和にはならない。' },
      { term: '双碰', reading: 'シャンポン', body: '対子2組で、どちらかの3枚目を待つ形（例 5・5と8・8で5と8待ち）。和了った方が刻子になる。' },
      { term: '和了牌', reading: 'ホーラはい', body: '引くか他家が捨てれば和了れる牌。待ち牌とも言う。' },
    ],
  },
  {
    title: 'ルール',
    terms: [
      { term: '門前', reading: 'メンゼン', body: '鳴いていない手。一人打ちでは常に門前。', game: '鳴いていない状態。門前限定の役（立直・平和など）は門前でないと付かない。' },
      { term: 'ツモ', reading: 'ツモ', body: '山から牌を引くこと。門前で自分で引いて和了ると門前清自摸和（1翻）。' },
      { term: 'ロン', reading: 'ロン', body: '他家が捨てた牌で和了ること。振聴のときはできない。' },
      { term: '翻', reading: 'ハン', body: '役やドラの数え方。翻が多いほど点数が高い。' },
      { term: '1翻縛り', reading: 'イーハンしばり', body: '和了るには役が1つ以上要るという決まり。ドラだけでは和了れない。' },
      { term: '役牌', reading: 'ヤクハイ', body: '刻子で1翻になる字牌。白・發・中と、場風・自風。' },
      {
        term: '場風・自風',
        reading: 'ばかぜ・じかぜ',
        body: 'このアプリでは東場・東家に固定。東の刻子は両方を満たし2翻。',
        game: '場風は東場なら東、南場なら南。自風は席で決まり、親が東。場風か自風の刻子は役牌（1翻）、両方なら2翻。',
      },
      { term: 'ドラ', reading: 'ドラ', body: 'ドラ表示牌の次の牌。1枚につき1翻。赤5（赤ドラ）も1枚1翻。' },
      { term: 'ドラ表示牌', reading: 'ドラひょうじはい', body: '王牌でめくられている牌。その次の牌がドラ（9の次は1、北の次は東、中の次は白）。' },
      { term: '役満', reading: 'ヤクマン', body: '13翻の特別な役。複数あれば合算し（2つでダブル役満、3つでトリプル役満）、他の役とドラは加算しない。四暗刻単騎・国士無双十三面待ち・純正九蓮宝燈・大四喜は1つでダブル役満（26翻）。' },
      { term: '流局', reading: 'りゅうきょく', body: '和了らずに最大巡目まで打ち切った状態。', game: '山が尽きて誰も和了しないこと（荒牌流局）。聴牌者はノーテン罰符を受け取る。九種九牌などで局を打ち切るのは途中流局。' },
    ],
  },
  {
    title: '対戦',
    terms: [
      { term: '立直', reading: 'リーチ', body: '門前で聴牌し、1000点を供託して宣言する役（1翻）。以後は手を変えられず、ツモ牌を切り続ける。' },
      { term: '一発', reading: 'イッパツ', body: 'リーチ宣言後、自分の次の打牌までに和了すると付く役（1翻）。' },
      { term: '裏ドラ', reading: 'うらドラ', body: 'ドラ表示牌の下の牌が示すドラ。リーチして和了したときだけ数える。' },
      { term: '振聴', reading: 'フリテン', body: '自分の待ち牌を捨てている、または和了牌を見逃した状態。ロンできない（ツモは可）。リーチ後の見逃しは局の終わりまで続く。' },
      { term: '現物', reading: 'げんぶつ', body: 'リーチした人が自分で捨てている牌。その人には絶対にロンされない安全牌。' },
      { term: '筋', reading: 'すじ', body: '捨て牌の3つ隣の数牌（4を捨てていれば1と7）。両面待ちではロンされない比較的安全な牌。' },
      { term: '壁', reading: 'かべ', body: 'ある牌が4枚見えていて、その牌を使う両面待ちがないこと（8が4枚見えていれば7・9の両面待ちはない）。' },
      { term: '放銃', reading: 'ホウジュウ', body: '自分の捨てた牌で他家にロンされること。振り込みとも言う。' },
      { term: '降り', reading: 'おり', body: '和了を目指すのをやめ、安全な牌だけを切って放銃を避けること。押すか降りるかの判断が押し引き。' },
      { term: '危険牌', reading: 'きけんはい', body: 'リーチした人などにロンされやすい牌。現物・筋・字牌の見え方で安全度を測る。' },
      { term: '供託', reading: 'きょうたく', body: 'リーチ棒として卓に出した1000点。次に和了した人が受け取る。' },
      { term: '符', reading: 'フ', body: '手の形・待ち・和了り方で決まる点数の基礎。翻と組み合わせて点数が決まる。' },
      { term: '満貫', reading: 'マンガン', body: '5翻（または4翻40符・3翻70符以上）の点数。子8000点、親12000点。以上は跳満・倍満・三倍満・役満。' },
      { term: 'ダブル役満', reading: 'ダブルやくまん', body: '役満2つ分の点数。子64000点、親96000点（トリプル役満は子96000点、親144000点）。' },
      {
        term: '包',
        reading: 'パオ（責任払い）',
        body: '大三元の3つ目の三元牌・大四喜の4つ目の風牌・四槓子の4つ目の槓（明槓のみ）を鳴かせた人が責任者になる。ツモならその役満を責任者が全額払い、他家からのロンなら放銃者と半分ずつ払う。',
      },
      { term: 'ノーテン罰符', reading: 'ノーテンばっぷ', body: '流局時に聴牌していない人が聴牌者に払う計3000点。' },
      { term: '本場', reading: 'ほんば', body: '連荘や流局で積まれる数。和了ると1本場につきロンは300点、ツモは各100点が加算される。子が和了ると0に戻る。' },
      { term: '連荘', reading: 'レンチャン', body: '親が続けて親をすること。親の和了、流局時の親の聴牌、途中流局で連荘し、本場が1つ増える。' },
      { term: '東風戦・半荘戦', reading: 'トンプウせん・ハンチャンせん', body: '東風戦は東場の4局、半荘戦は東場と南場の8局（連荘があれば延びる）で終わる対局。' },
      { term: '親・子', reading: 'おや・こ', body: '局ごとに1人が親（東家）で、残りが子。親の和了は点数が1.5倍。最初の親が起家。' },
      { term: '持ち点', reading: 'もちてん', body: '各自の点数。25000点から始まり、和了・放銃・罰符で増減する。終局時の持ち点で順位が決まる。' },
      { term: 'ポン', reading: 'ポン', body: '他家の捨て牌で、手の対子を刻子にする鳴き。誰の捨て牌でもできる。' },
      { term: 'チー', reading: 'チー', body: '上家（左隣）の捨て牌で、手の2枚を順子にする鳴き。ポン・カンが優先される。' },
      { term: '鳴き', reading: 'なき', body: 'ポン・チー・明槓で他家の捨て牌を取ること。副露とも言う。鳴くと門前でなくなり、立直や門前限定の役は付かない。' },
      { term: '喰いタン', reading: 'くいタン', body: '鳴いて作った断么九。このアプリでは鳴いても断么九が付く（喰いタンあり）。' },
      {
        term: 'カン（明槓・暗槓・加槓）',
        reading: 'カン（ミンカン・アンカン・カカン）',
        body: '同じ牌4枚の組。他家の捨て牌で作る明槓、自分で4枚そろえる暗槓（門前のまま）、ポンに4枚目を足す加槓がある。カンすると嶺上牌を引き、新しいドラ表示牌がめくれる。',
      },
      { term: '喰い替え', reading: 'くいかえ', body: 'チー・ポンした直後に、鳴いた牌と同じ牌や、チーした順子の反対側の牌を切ること。禁止されていて選べない。' },
      { term: '嶺上開花', reading: 'リンシャンカイホー', body: 'カンして引いた嶺上牌で和了る役（1翻）。' },
      { term: '嶺上牌', reading: 'リンシャンパイ', body: 'カンしたときに王牌から引く補充の牌。' },
      { term: '槍槓', reading: 'チャンカン', body: '他家が加槓した牌でロンする役（1翻）。' },
      { term: '四開槓', reading: 'スーカイカン', body: '2人以上で合わせて4回カンしたときの途中流局。' },
      { term: '喰い下がり', reading: 'くいさがり', body: '鳴くと翻数が1つ下がる役（三色同順・一気通貫・混全帯么九・純全帯么九・混一色・清一色）。' },
      { term: '天和・地和', reading: 'テンホー・チーホー', body: '配牌からの最初のツモで和了る役満。親なら天和、子なら地和。子は自分のツモまでに誰かが鳴く（暗槓を含む）と成立しない。ロンでは付かない。' },
      { term: '九種九牌', reading: 'きゅうしゅきゅうはい', body: '最初のツモ（鳴きが入る前）で么九牌が9種類以上あるとき宣言できる途中流局。' },
      { term: '四風連打', reading: 'スーフォンレンダ', body: '1巡目に4人全員が同じ風牌を捨てたときの途中流局。' },
      { term: '四家立直', reading: 'スーチャリーチ', body: '4人全員がリーチしたときの途中流局。' },
      { term: 'ウマ・オカ', reading: 'ウマ・オカ', body: '終局時の順位点。スコアは（持ち点 − 30000）÷ 1000 に、ウマ（1位 +20・2位 +10・3位 −10・4位 −20）とオカ（1位に +20）を加えたもの。' },
      { term: 'トビ', reading: 'トビ', body: '持ち点が0点を下回ること。誰かがトビになるとその時点で終局する。' },
    ],
  },
];

export interface GlossaryProps {
  mode: 'practice' | 'game';
  onMinimize?: () => void;
  minimized?: boolean; // in the dock: the search text is kept, nothing is drawn
}

/** 用語表: short explanations of the mahjong terms used on the page, filterable. The app's own terms (seed, turns, the yaku table's columns) are in the help. */
export const Glossary = memo(function Glossary({ mode, onMinimize, minimized }: GlossaryProps) {
  const [query, setQuery] = useState('');
  if (minimized) return null;
  // Hiragana and katakana match alike (スジ finds 筋, read すじ).
  const q = toKatakana(query.trim().toLowerCase());
  const groups = GROUPS.map((g) => {
    const terms = g.terms.flatMap((t) => {
      if (mode !== 'game' || t.game === undefined) return [t];
      return t.game === null ? [] : [{ ...t, body: t.game }];
    });
    return {
      ...g,
      terms: q === '' ? terms : terms.filter((t) => toKatakana(`${t.term} ${t.reading} ${t.body}`.toLowerCase()).includes(q)),
    };
  }).filter((g) => g.terms.length > 0);

  return (
    <section class="glossary-panel" aria-label="用語表">
      <PanelHeading title="用語表" onMinimize={onMinimize} />
      <input
        type="search"
        class="glossary-search"
        placeholder="用語を検索"
        aria-label="用語を検索"
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />
      {groups.length === 0 && <p class="muted">該当する用語がありません</p>}
      {groups.map((g) => (
        <div key={g.title} class="glossary-group">
          <h3>{g.title}</h3>
          <dl>
            {g.terms.map((t) => (
              <div key={t.term} class="glossary-item">
                <dt>
                  {t.term}
                  {t.reading !== t.term && <span class="glossary-reading">{t.reading}</span>}
                </dt>
                <dd>{t.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  );
});
