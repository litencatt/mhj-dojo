import { parseTile } from '../tiles';

// Tile faces drawn as SVG in a 30x40 box, following the usual Japanese set
// layouts. Red fives (0m/0p/0s) are drawn with all-red numerals/pips/sticks.

const BLUE = '#1f4fbf';
const GREEN = '#15803d';
const RED = '#c8201f';
const INK = '#1c1917';
const FONT = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';

type Pin = [x: number, y: number, color: string];

function pin([x, y, color]: Pin, r: number, key: number) {
  return (
    <g key={key}>
      <circle cx={x} cy={y} r={r} fill={color} />
      <circle cx={x} cy={y} r={r * 0.68} fill="#fff" />
      <circle cx={x} cy={y} r={r * 0.46} fill={color} />
      <circle cx={x} cy={y} r={r * 0.16} fill="#fff" />
    </g>
  );
}

const B = BLUE;
const G = GREEN;
const R = RED;

// Pinzu use only blue and red; souzu use only green and red.
const PINS: Record<number, { r: number; pins: Pin[] }> = {
  2: { r: 6.2, pins: [[15, 11, B], [15, 29, B]] },
  3: { r: 5.2, pins: [[7, 9, B], [15, 20, R], [23, 31, B]] },
  4: { r: 5.6, pins: [[9, 11, B], [21, 11, R], [9, 29, R], [21, 29, B]] },
  5: { r: 5, pins: [[8, 9, B], [22, 9, B], [15, 20, R], [8, 31, B], [22, 31, B]] },
  6: { r: 4.6, pins: [[9, 7, B], [21, 7, B], [9, 21, R], [21, 21, R], [9, 33, R], [21, 33, R]] },
  7: { r: 4, pins: [[6, 5, B], [15, 9, B], [24, 13, B], [9, 24, R], [21, 24, R], [9, 34, R], [21, 34, R]] },
  8: { r: 4.2, pins: [6, 15.3, 24.6, 34].flatMap((y): Pin[] => [[9, y, B], [21, y, B]]) },
  9: {
    r: 4.2,
    pins: ([[8, B], [20, R], [32, B]] as const).flatMap(([y, c]): Pin[] => [[6, y, c], [15, y, c], [24, y, c]]),
  },
};

function Pinzu({ rank, red }: { rank: number; red: boolean }) {
  if (rank === 1) {
    return (
      <g>
        <circle cx={15} cy={20} r={12} fill={B} />
        <circle cx={15} cy={20} r={10} fill="#fff" />
        <circle cx={15} cy={20} r={8.6} fill={B} />
        <circle cx={15} cy={20} r={6.4} fill="#fff" />
        <circle cx={15} cy={20} r={5} fill={R} />
        <circle cx={15} cy={20} r={2} fill="#fff" />
      </g>
    );
  }
  const { r, pins } = PINS[rank]!;
  return <g>{pins.map(([x, y, c], i) => pin([x, y, red ? RED : c], r, i))}</g>;
}

type Stick = [x: number, y: number, h: number, color: string, angle?: number];

function stick([x, y, h, color, angle = 0]: Stick, key: number) {
  const w = 3.4;
  return (
    <g key={key} transform={`rotate(${angle} ${x} ${y})`}>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={1.5} fill={color} />
      <line x1={x - w / 2} x2={x + w / 2} y1={y} y2={y} stroke="#fff" stroke-width={0.8} />
      <line x1={x} x2={x} y1={y - h / 2 + 1.2} y2={y + h / 2 - 1.2} stroke="#fff" stroke-width={0.5} opacity={0.6} />
    </g>
  );
}

const SOU: Record<number, Stick[]> = {
  2: [[15, 11, 15, G], [15, 29, 15, G]],
  3: [[15, 11, 15, G], [9, 29, 15, G], [21, 29, 15, G]],
  4: [[9, 11, 15, G], [21, 11, 15, G], [9, 29, 15, G], [21, 29, 15, G]],
  5: [[7, 11, 15, G], [23, 11, 15, G], [15, 20, 15, R], [7, 29, 15, G], [23, 29, 15, G]],
  6: [7, 15, 23].flatMap((x): Stick[] => [[x, 11, 15, G], [x, 29, 15, G]]),
  7: [[15, 6, 9, R], ...[7, 15, 23].flatMap((x): Stick[] => [[x, 19, 11, G], [x, 33, 11, G]])],
  8: [6, 12, 18, 24].flatMap((x, i): Stick[] => [
    [x, 11, 15, G, i % 2 ? -18 : 18],
    [x, 29, 15, G, i % 2 ? 18 : -18],
  ]),
  9: [7, 15, 23].flatMap((x): Stick[] => {
    const c = x === 15 ? R : G;
    return [[x, 7, 11, c], [x, 20, 11, c], [x, 33, 11, c]];
  }),
};

function Souzu({ rank, red }: { rank: number; red: boolean }) {
  if (rank === 1) {
    // 一索: a stylised bird.
    return (
      <g>
        <path d="M15 30 L8 38 M15 30 L12 39 M15 30 L18 39 M15 30 L22 38" stroke={G} stroke-width={1.6} stroke-linecap="round" />
        <ellipse cx={15} cy={22} rx={6.5} ry={9} fill={G} />
        <path d="M11 20 Q15 27 19 20 Q15 23 11 20 Z" fill={R} />
        <circle cx={15} cy={10} r={4} fill={G} />
        <circle cx={16.2} cy={9.2} r={0.9} fill="#fff" />
        <path d="M18.6 10 L22 11 L18.6 12 Z" fill={R} />
        <path d="M13 6.5 L12 3 M15 6 L15 2.5 M17 6.5 L18 3" stroke={R} stroke-width={1.2} stroke-linecap="round" />
      </g>
    );
  }
  return <g>{SOU[rank]!.map(([x, y, h, c, a], i) => stick([x, y, h, red ? RED : c, a], i))}</g>;
}

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

function Manzu({ rank, red }: { rank: number; red: boolean }) {
  return (
    <g font-family={FONT} font-weight={700} text-anchor="middle">
      <text x={15} y={17} font-size={15} fill={red ? RED : INK}>
        {NUMERALS[rank - 1]}
      </text>
      <text x={15} y={36} font-size={15} fill={RED}>
        萬
      </text>
    </g>
  );
}

const HONORS: Array<[string, string]> = [
  ['東', INK],
  ['南', INK],
  ['西', INK],
  ['北', INK],
  ['', INK], // 白 is a blank face
  ['發', GREEN],
  ['中', RED],
];

function Jihai({ rank }: { rank: number }) {
  const [ch, color] = HONORS[rank - 1]!;
  if (!ch) return null;
  return (
    <text x={15} y={28.5} font-family={FONT} font-weight={700} font-size={22} text-anchor="middle" fill={color}>
      {ch}
    </text>
  );
}

/** One tile face's markup, e.g. "5p" or "0s" (used inside a `<symbol>`). */
function Face({ tile }: { tile: string }) {
  const { suit, rank, red } = parseTile(tile);
  return (
    <>
      {suit === 'p' && <Pinzu rank={rank} red={red} />}
      {suit === 's' && <Souzu rank={rank} red={red} />}
      {suit === 'm' && <Manzu rank={rank} red={red} />}
      {suit === 'z' && <Jihai rank={rank} />}
    </>
  );
}

// Every tile kind the game deals: 1-9 of each suit, the red fives (0m/0p/0s),
// and the seven honors.
const KINDS = ['m', 'p', 's']
  .flatMap((suit) => [...'0123456789'].map((rank) => `${rank}${suit}`))
  .concat([1, 2, 3, 4, 5, 6, 7].map((rank) => `${rank}z`));

// Renders every tile face once as a <symbol>, so <TileFace> can reference it
// with <use> instead of redrawing ~16 SVG nodes per tile on the board (a
// yaku table alone has ~285 tile faces). Mount this once near the app root,
// before any <TileFace> (see main.tsx): the sprite is shared across practice
// and CPU-game mode, and across the embedded and static-site builds, since
// both render through that same root.
export function TileSprite() {
  return (
    <svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <defs>
        {KINDS.map((kind) => (
          <symbol id={`tf-${kind}`} viewBox="0 0 30 40" key={kind}>
            <Face tile={kind} />
          </symbol>
        ))}
      </defs>
    </svg>
  );
}

/** The face of one tile, e.g. "5p" or "0s", as an SVG filling its container.
 * Draws nothing on its own; it references a `<symbol>` from <TileSprite>. */
export function TileFace({ tile }: { tile: string }) {
  return (
    <svg class="tile-face" viewBox="0 0 30 40" aria-hidden="true">
      <use href={`#tf-${tile}`} />
    </svg>
  );
}
