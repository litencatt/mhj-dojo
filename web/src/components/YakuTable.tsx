import { useState } from 'preact/hooks';
import type { YakuRow } from '../api';
import { Tile } from './Tile';

export interface YakuTableProps {
  rows: YakuRow[];
  baseline: YakuRow[] | null; // non-null while previewing a discard candidate
  previewTile: string | null;
}

function shantenLabel(s: number | null): string {
  if (s === null) return '不可';
  if (s === -1) return '和了';
  if (s === 0) return '聴牌';
  return `${s}向聴`;
}

function deltaLabel(cur: number | null, base: number | null): { text: string; cls: string } | null {
  if (cur === base) return null;
  if (base === null) return { text: `→${shantenLabel(cur)}`, cls: 'delta-improve' };
  if (cur === null) return { text: '→不可', cls: 'delta-worse' };
  const d = cur - base;
  return { text: d < 0 ? `${d}` : `+${d}`, cls: d < 0 ? 'delta-improve' : d > 0 ? 'delta-worse' : 'delta-flat' };
}

/** Row with the lowest shanten (ties: wider ukeire), or null if none is possible. */
function bestRow(rows: YakuRow[]): YakuRow | null {
  let best: YakuRow | null = null;
  for (const r of rows) {
    if (r.shanten === null) continue;
    if (
      best === null ||
      r.shanten < (best.shanten as number) ||
      (r.shanten === best.shanten && r.ukeire_total > best.ukeire_total)
    ) {
      best = r;
    }
  }
  return best;
}

/** 役別向聴テーブル: shows either the current-node analysis, or (while previewing a
 * discard) that candidate's resulting analysis with deltas vs the current node.
 * Yakuman rows sit in a collapsible 役満 group (collapsed by default). */
export function YakuTable(props: YakuTableProps) {
  const { rows, baseline, previewTile } = props;
  const [yakumanOpen, setYakumanOpen] = useState(false);
  const finiteShanten = rows
    .filter((r) => !r.yakuman)
    .map((r) => r.shanten)
    .filter((s): s is number => s !== null);
  const minShanten = finiteShanten.length > 0 ? Math.min(...finiteShanten) : null;

  const yakumanRows = rows.filter((r) => r.yakuman);
  const bestYakuman = bestRow(yakumanRows);
  const baseBestYakuman = baseline ? bestRow(baseline.filter((r) => r.yakuman)) : null;
  const yakumanDelta = baseline ? deltaLabel(bestYakuman?.shanten ?? null, baseBestYakuman?.shanten ?? null) : null;

  function renderRow(row: YakuRow, i: number) {
    const base = baseline ? baseline[i] : null;
    const delta = baseline ? deltaLabel(row.shanten, base?.shanten ?? null) : null;
    const isBest = !row.yakuman && row.shanten !== null && row.shanten === minShanten;
    const cls = [isBest ? 'row-best' : '', row.yakuman ? 'row-yakuman' : ''].filter(Boolean).join(' ');
    return (
      <tr key={row.key} class={cls}>
        <th scope="row" class="yaku-name-cell">
          {row.name}
          {row.approx && <span class="badge-approx">近似</span>}
        </th>
        <td class="shanten-cell">
          <span>{shantenLabel(row.shanten)}</span>
          {delta && <span class={`delta ${delta.cls}`}>{delta.text}</span>}
        </td>
        <td class="ukeire-cell">
          {row.ukeire.length === 0 ? (
            <span class="muted">—</span>
          ) : (
            <div class="ukeire-tiles">
              {row.ukeire.map((u) => (
                <div key={u.tile} class={`ukeire-item ${u.remaining === 0 ? 'ukeire-item-zero' : ''}`}>
                  <Tile tile={u.tile} size="xs" dimmed={u.remaining === 0} />
                  <span class="ukeire-count">{u.remaining}</span>
                </div>
              ))}
            </div>
          )}
        </td>
        <td class="ukeire-total-cell">{row.ukeire_total}</td>
      </tr>
    );
  }

  return (
    <section class="yaku-table-panel" aria-label="役別向聴テーブル">
      <h2>
        役別向聴
        {previewTile && (
          <span class="preview-note"> — {previewTile} を打牌した場合のプレビュー</span>
        )}
      </h2>
      <div class="yaku-table-scroll">
        <table class="yaku-table">
          <thead>
            <tr>
              <th scope="col">役</th>
              <th scope="col">向聴</th>
              <th scope="col">有効牌</th>
              <th scope="col">合計枚数</th>
            </tr>
          </thead>
          <tbody>{rows.map((row, i) => (row.yakuman ? null : renderRow(row, i)))}</tbody>
          {yakumanRows.length > 0 && (
            <tbody class="yakuman-group">
              <tr class="yakuman-summary">
                <th scope="row" colSpan={4}>
                  <button
                    type="button"
                    class="yakuman-toggle"
                    aria-expanded={yakumanOpen}
                    onClick={() => setYakumanOpen((v) => !v)}
                  >
                    <span class="yakuman-caret" aria-hidden="true">
                      {yakumanOpen ? '▾' : '▸'}
                    </span>
                    役満
                    <span class="yakuman-best">
                      {bestYakuman ? (
                        <>
                          最短 {bestYakuman.name} {shantenLabel(bestYakuman.shanten)}
                        </>
                      ) : (
                        '不可'
                      )}
                      {yakumanDelta && <span class={`delta ${yakumanDelta.cls}`}>{yakumanDelta.text}</span>}
                    </span>
                  </button>
                </th>
              </tr>
              {yakumanOpen && rows.map((row, i) => (row.yakuman ? renderRow(row, i) : null))}
            </tbody>
          )}
        </table>
      </div>
    </section>
  );
}
