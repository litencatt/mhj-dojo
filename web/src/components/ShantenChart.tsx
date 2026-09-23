import { useEffect, useMemo, useState } from 'preact/hooks';
import type { HistoryEntry, YakuRow } from '../api';

export interface ShantenChartProps {
  sessionId: string; // default legend selection resets when this changes (new game)
  history: HistoryEntry[];
  currentAnalysis: YakuRow[]; // used to pick the default "best 5" legend rows
  rowNames: Record<string, string>;
}

function defaultVisibleKeys(currentAnalysis: YakuRow[]): Set<string> {
  const sorted = [...currentAnalysis]
    .filter((r) => r.key !== 'normal')
    .sort((a, b) => {
      const av = a.shanten ?? Infinity;
      const bv = b.shanten ?? Infinity;
      if (av !== bv) return av - bv;
      return b.ukeire_total - a.ukeire_total; // tie-break: wider ukeire first
    })
    .slice(0, 5)
    .map((r) => r.key);
  return new Set(['normal', ...sorted]);
}

const PALETTE = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
  '#0d9488', '#b91c1c', '#7c3aed', '#059669', '#c2410c',
  '#1d4ed8', '#be185d', '#15803d',
];

const NORMAL_COLOR = '#64748b';

const WIDTH = 720;
const HEIGHT = 320;
const MARGIN = { top: 16, right: 16, bottom: 32, left: 48 };

/** 時系列チャート: x = turn, y = shanten (low = top; win=-1 tenpai=0 labeled). */
export function ShantenChart(props: ShantenChartProps) {
  const { sessionId, history, currentAnalysis, rowNames } = props;
  const allKeys = useMemo(() => Object.keys(rowNames), [rowNames]);

  const [visible, setVisible] = useState<Set<string>>(() => defaultVisibleKeys(currentAnalysis));

  // Reset to the default (normal + best 5, tie-broken by ukeire_total) only
  // when a new game starts; toggles persist across discards/goto within a game.
  useEffect(() => {
    setVisible(defaultVisibleKeys(currentAnalysis));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function toggle(key: string) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (history.length === 0) {
    return (
      <section class="chart-panel" aria-label="時系列チャート">
        <h2>時系列チャート</h2>
        <p class="muted">データがありません</p>
      </section>
    );
  }

  // A tsumo node keeps its parent's turn; its winning tile is the next turn's draw,
  // so it is plotted one step right to avoid sharing an x position with the parent.
  const xTurn = (h: HistoryEntry, i: number) => (i > 0 && h.discard === null ? h.turn + 1 : h.turn);
  const xs = history.map(xTurn);
  const turns = [...new Set(xs)];
  const minTurn = Math.min(...turns);
  const maxTurn = Math.max(...turns, minTurn + 1);

  let minV = -1;
  let maxV = 1;
  for (const h of history) {
    for (const v of Object.values(h.shanten)) {
      if (v === null) continue;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
  }

  const innerW = WIDTH - MARGIN.left - MARGIN.right;
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xScale = (turn: number) => MARGIN.left + ((turn - minTurn) / Math.max(1, maxTurn - minTurn)) * innerW;
  const yScale = (v: number) => MARGIN.top + ((v - minV) / Math.max(1, maxV - minV)) * innerH;

  const currentNodeId = history[history.length - 1]?.node_id;

  const yTicks: number[] = [];
  for (let v = Math.ceil(minV); v <= Math.floor(maxV); v++) yTicks.push(v);

  function colorFor(key: string, idx: number): string {
    if (key === 'normal') return NORMAL_COLOR;
    return PALETTE[idx % PALETTE.length] as string;
  }

  // Small per-series vertical offset (in shanten-units, ~+-0.08) so series that
  // share identical values don't fully overlap into a single indistinguishable
  // line. Keyed off each row's fixed position (not the filtered visible list),
  // so a series's offset doesn't shift when other series are toggled.
  const offsetSpan = 0.16;
  function offsetFor(key: string): number {
    if (allKeys.length <= 1) return 0;
    const idx = allKeys.indexOf(key);
    const center = (allKeys.length - 1) / 2;
    return ((idx - center) * offsetSpan) / (allKeys.length - 1);
  }

  const keysInOrder = allKeys.filter((k) => visible.has(k));

  return (
    <section class="chart-panel" aria-label="時系列チャート">
      <h2>時系列チャート</h2>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} class="shanten-chart" role="img" aria-label="向聴の時系列推移">
        {/* gridlines + y labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yScale(v)} y2={yScale(v)} class="chart-grid" />
            <text x={MARGIN.left - 8} y={yScale(v)} class="chart-axis-label" text-anchor="end" dominant-baseline="middle">
              {v === -1 ? '和了' : v === 0 ? '聴牌' : v}
            </text>
          </g>
        ))}
        {/* x labels */}
        {turns.map((t) => (
          <text key={t} x={xScale(t)} y={HEIGHT - MARGIN.bottom + 16} class="chart-axis-label" text-anchor="middle">
            {t}
          </text>
        ))}
        <text x={WIDTH / 2} y={HEIGHT - 4} class="chart-axis-title" text-anchor="middle">
          巡目
        </text>

        {keysInOrder.map((key) => {
          const color = colorFor(key, allKeys.indexOf(key));
          const offset = offsetFor(key);
          const segments: Array<Array<[number, number]>> = [[]];
          history.forEach((h, i) => {
            const v = h.shanten[key];
            if (v === null || v === undefined) {
              if (segments[segments.length - 1]!.length > 0) segments.push([]);
              return;
            }
            segments[segments.length - 1]!.push([xScale(xs[i]!), yScale(v + offset)]);
          });
          return (
            <g key={key}>
              {segments
                .filter((seg) => seg.length > 0)
                .map((seg, si) => (
                  <polyline
                    key={si}
                    points={seg.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="none"
                    stroke={color}
                    stroke-width={key === 'normal' ? 1.5 : 2}
                    opacity={key === 'normal' ? 0.6 : 0.9}
                  />
                ))}
              {history.map((h, i) => {
                const v = h.shanten[key];
                if (v === null || v === undefined) return null;
                const isCurrent = h.node_id === currentNodeId;
                return (
                  <circle
                    key={h.node_id}
                    cx={xScale(xs[i]!)}
                    cy={yScale(v + offset)}
                    r={isCurrent ? 5 : 2.5}
                    fill={color}
                    stroke={isCurrent ? 'var(--fg)' : 'none'}
                    stroke-width={isCurrent ? 2 : 0}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      <div class="chart-legend" role="group" aria-label="凡例（クリックで表示切り替え）">
        {allKeys.map((key, i) => (
          <button
            key={key}
            type="button"
            class={`legend-item ${visible.has(key) ? 'legend-on' : 'legend-off'}`}
            style={{ '--legend-color': colorFor(key, i) } as Record<string, string>}
            onClick={() => toggle(key)}
            aria-pressed={visible.has(key)}
          >
            <span class="legend-swatch" />
            {rowNames[key]}
          </button>
        ))}
      </div>
    </section>
  );
}
