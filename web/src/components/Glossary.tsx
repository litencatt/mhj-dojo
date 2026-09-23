import { useState } from 'preact/hooks';
import { PanelHeading } from './PanelHeading';

interface Term {
  term: string;
  reading: string;
  body: string;
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
      { term: '合計枚数', reading: 'ごうけいまいすう', body: 'その役の有効牌の残り枚数の合計。' },
      { term: '空聴', reading: 'からテン', body: '聴牌しているが、待ち牌がすべて見えていて残り0枚の状態。' },
      { term: '役別向聴', reading: 'やくべつシャンテン', body: 'その役を満たす和了形まで、手牌を最小何枚入れ替えればよいか − 1。役ごとに近道が分かる。' },
      { term: '一般形', reading: 'いっぱんけい', body: '役の条件を付けない4面子1雀頭の形。通常の向聴数。七対子・国士無双は別の行。' },
      { term: '近似', reading: 'きんじ', body: '平和の1向聴以上の値。両面待ちの条件を除いて数えた目安で、実際はそれ以上かかることがある。' },
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
    ],
  },
  {
    title: 'ルール',
    terms: [
      { term: '門前', reading: 'メンゼン', body: '鳴いていない手。一人打ちでは常に門前。' },
      { term: 'ツモ', reading: 'ツモ', body: '山から牌を引くこと。門前で自分で引いて和了ると門前清自摸和（1翻）。' },
      { term: '役牌', reading: 'ヤクハイ', body: '刻子で1翻になる字牌。白・發・中と、場風・自風。' },
      { term: '場風・自風', reading: 'ばかぜ・じかぜ', body: 'このアプリでは東場・東家に固定。東の刻子は両方を満たし2翻。' },
      { term: 'ドラ', reading: 'ドラ', body: 'ドラ表示牌の次の牌。1枚につき1翻。赤5（赤ドラ）も1枚1翻。' },
      { term: '役満', reading: 'ヤクマン', body: '13翻の特別な役。複数あれば合算し、他の役とドラは加算しない。' },
      { term: '流局', reading: 'りゅうきょく', body: '和了らずに最大巡目まで打ち切った状態。' },
    ],
  },
  {
    title: 'アプリ',
    terms: [
      { term: 'シード', reading: 'シード', body: '山の並びを決める数。同じシードなら毎回同じ配牌・ツモ順。' },
      { term: '巡目', reading: 'じゅんめ', body: '打牌した回数。最大巡目で流局。' },
      { term: '履歴ツリー', reading: 'りれきツリー', body: '打牌の履歴。任意の巡目に戻って別の牌を切ると枝が増え、元の枝も残る。' },
      { term: '打牌プレビュー', reading: 'だはいプレビュー', body: '手牌にカーソルを合わせると、その牌を切った後の役別向聴と差分を表示。' },
    ],
  },
];

/** 用語表: short explanations of the terms used on the page, filterable. */
export function Glossary({ onMinimize }: { onMinimize?: () => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({
    ...g,
    terms: q === '' ? g.terms : g.terms.filter((t) => `${t.term} ${t.reading} ${t.body}`.toLowerCase().includes(q)),
  })).filter((g) => g.terms.length > 0);

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
}
