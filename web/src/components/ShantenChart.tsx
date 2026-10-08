import { Fragment } from 'preact';
import { memo } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useState } from 'preact/hooks';
import type { HistoryEntry, YakuRow } from '../api';
import { PanelHeading } from './PanelHeading';

export interface ShantenChartProps {
  onMinimize?: () => void;
  minimized?: boolean; // in the dock: only its hooks run (keeping their state), nothing is drawn
  sessionId: string; // default legend selection resets when this changes (new game)
  history: HistoryEntry[];
  currentAnalysis: YakuRow[]; // used to pick the default "best 5" legend rows and the yakuman keys
  rowNames: Record<string, string>;
}

/** Default legend selection: normal + the best 5 non-yakuman rows (yakuman are opt-in). */
function defaultVisibleKeys(currentAnalysis: YakuRow[]): Set<string> {
  const sorted = [...currentAnalysis]
    .filter((r) => r.key !== 'normal' && !r.yakuman)
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
// Narrower than this (a phone), the 720-wide drawing scaled down would shrink
// its labels to a few pixels: the chart is drawn at its real width instead.
const NARROW = 560;
const PHONE = '(width <= 760px)';
const NARROW_MARGIN = { top: 12, right: 10, bottom: 30, left: 34 };

/** The element's content width, following resizes (0 until measured or while hidden). */
function useWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/** 時系列チャート: x = turn, y = shanten (low = top; win=-1 tenpai=0 labeled). */
export const ShantenChart = memo(function ShantenChart(props: ShantenChartProps) {
  const { sessionId, history, currentAnalysis, rowNames, onMinimize, minimized } = props;
  const yakumanKeys = useMemo(
    () => new Set(currentAnalysis.filter((r) => r.yakuman).map((r) => r.key)),
    [currentAnalysis],
  );
  // Yakuman keys are grouped after all the others.
  const allKeys = useMemo(() => {
    const keys = Object.keys(rowNames);
    return [...keys.filter((k) => !yakumanKeys.has(k)), ...keys.filter((k) => yakumanKeys.has(k))];
  }, [rowNames, yakumanKeys]);

  const [visible, setVisible] = useState<Set<string>>(() => defaultVisibleKeys(currentAnalysis));
  const [boxRef, boxWidth] = useWidth();

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

  if (minimized) return null;

  // Phones only (the phone width in styles/*.css): a narrow desktop column keeps the scaled drawing.
  const narrow = boxWidth > 0 && boxWidth < NARROW && typeof matchMedia === 'function' && matchMedia(PHONE).matches;
  const W = narrow ? boxWidth : WIDTH;
  const H = narrow ? Math.round(Math.max(200, boxWidth * 0.62)) : HEIGHT;
  const M = narrow ? NARROW_MARGIN : MARGIN;

  if (history.length === 0) {
    return (
      <section class="chart-panel" aria-label="時系列チャート">
        <PanelHeading title="時系列チャート" onMinimize={onMinimize} />
        <p class="muted">データがありません</p>
      </section>
    );
  }

  // A practice tsumo node keeps its parent's turn; its winning tile is the next turn's draw,
  // so it is plotted one step right to avoid sharing an x position with the parent.
  const xTurn = (h: HistoryEntry, i: number) => (i > 0 && h.draw !== null && h.discard === null ? h.turn + 1 : h.turn);
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

  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const xScale = (turn: number) => M.left + ((turn - minTurn) / Math.max(1, maxTurn - minTurn)) * innerW;
  const yScale = (v: number) => M.top + ((v - minV) / Math.max(1, maxV - minV)) * innerH;

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
      <PanelHeading title="時系列チャート" onMinimize={onMinimize} />
      <div class="shanten-chart-box" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} class="shanten-chart" role="img" aria-label="向聴の時系列推移">
        {/* gridlines + y labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={yScale(v)} y2={yScale(v)} class="chart-grid" />
            <text x={M.left - 8} y={yScale(v)} class="chart-axis-label" text-anchor="end" dominant-baseline="middle">
              {v === -1 ? '和了' : v === 0 ? '聴牌' : v}
            </text>
          </g>
        ))}
        {/* x labels */}
        {turns.map((t) => (
          <text key={t} x={xScale(t)} y={H - M.bottom + 16} class="chart-axis-label" text-anchor="middle">
            {t}
          </text>
        ))}
        <text x={W / 2} y={H - 4} class="chart-axis-title" text-anchor="middle">
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
                    stroke-dasharray={yakumanKeys.has(key) ? '5 3' : undefined}
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
      </div>
      <div class="chart-legend" role="group" aria-label="凡例（クリックで表示切り替え）">
        {allKeys.map((key, i) => {
          const yakuman = yakumanKeys.has(key);
          const firstYakuman = yakuman && (i === 0 || !yakumanKeys.has(allKeys[i - 1]!));
          return (
            <Fragment key={key}>
              {firstYakuman && <span class="legend-group-label">役満</span>}
              <button
                type="button"
                class={`legend-item ${visible.has(key) ? 'legend-on' : 'legend-off'}${yakuman ? ' legend-yakuman' : ''}`}
                style={{ '--legend-color': colorFor(key, i) } as Record<string, string>}
                onClick={() => toggle(key)}
                aria-pressed={visible.has(key)}
              >
                <span class="legend-swatch" />
                {rowNames[key]}
              </button>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
});
