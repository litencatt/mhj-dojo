import { useState } from 'preact/hooks';
import type { YakuRow } from '../api';
import { Tile } from './Tile';
import { PanelHeading } from './PanelHeading';
import { YAKU_CONDITIONS } from './yakuInfo';
import {
  CATEGORIES,
  DEFAULT_FILTER,
  applyYakuFilter,
  isDefaultFilter,
  loadFilter,
  saveFilter,
  type Category,
  type SortOrder,
  type YakuFilter,
} from './yakuFilter';

export interface YakuTableProps {
  rows: YakuRow[];
  baseline: YakuRow[] | null; // non-null while previewing a discard candidate
  previewTile: string | null;
  onMinimize?: () => void;
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

/** 役別向聴テーブル: shows either the current-node analysis, or (while previewing a
 * discard) that candidate's resulting analysis with deltas vs the current node.
 * A filter bar narrows and sorts the rows by the current values, so rows do not
 * jump while previewing. The normal row always comes first. */
export function YakuTable(props: YakuTableProps) {
  const { rows, baseline, previewTile, onMinimize } = props;
  const [filter, setFilterState] = useState<YakuFilter>(loadFilter);
  const setFilter = (f: YakuFilter) => {
    setFilterState(f);
    saveFilter(f);
  };

  // Tooltip with the hovered/focused yaku's conditions. It is fixed to the
  // viewport so the scrolling table panel cannot clip it.
  const [tip, setTip] = useState<{ key: string; left: number; top: number } | null>(null);
  const showTip = (key: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const width = 280;
    setTip({ key, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 6 });
  };

  const current = baseline ?? rows; // filter/sort by the current node, not the preview
  const shown = new Map(rows.map((r) => [r.key, r]));
  const base = new Map((baseline ?? []).map((r) => [r.key, r]));
  const { keys, total } = applyYakuFilter(current, filter);
  const visibleCount = keys.length;

  const finiteShanten = rows
    .filter((r) => !r.yakuman)
    .map((r) => r.shanten)
    .filter((s): s is number => s !== null);
  const minShanten = finiteShanten.length > 0 ? Math.min(...finiteShanten) : null;

  function renderRow(key: string) {
    const row = shown.get(key);
    if (!row) return null;
    const delta = baseline ? deltaLabel(row.shanten, base.get(key)?.shanten ?? null) : null;
    const isBest = !row.yakuman && row.shanten !== null && row.shanten === minShanten;
    return (
      <tr key={row.key} class={isBest ? 'row-best' : undefined}>
        <th scope="row" class="yaku-name-cell">
          <span
            class="yaku-name"
            tabIndex={0}
            aria-describedby={tip?.key === row.key ? 'yaku-tip' : undefined}
            onMouseEnter={(e) => showTip(row.key, e.currentTarget as HTMLElement)}
            onMouseLeave={() => setTip(null)}
            onFocus={(e) => showTip(row.key, e.currentTarget as HTMLElement)}
            onBlur={() => setTip(null)}
          >
            {row.name}
          </span>
          {row.approx && <span class="badge-approx">近似</span>}
        </th>
        <td class="han-cell">{row.yakuman ? '役満' : row.han > 0 ? `${row.han}翻` : '—'}</td>
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

  const toggleCategory = (c: Category) =>
    setFilter({
      ...filter,
      categories: filter.categories.includes(c) ? filter.categories.filter((x) => x !== c) : [...filter.categories, c],
    });

  return (
    <section class="yaku-table-panel" aria-label="役別向聴テーブル">
      <PanelHeading title="役別向聴" onMinimize={onMinimize}>
        {previewTile && <span class="preview-note"> — {previewTile} を打牌した場合のプレビュー</span>}
      </PanelHeading>
      <div class="yaku-filter" role="group" aria-label="役の絞り込み">
        <div class="yaku-filter-row">
          <input
            type="search"
            class="yaku-filter-search"
            placeholder="役名で検索（例: 一色, そめ）"
            aria-label="役名で検索"
            value={filter.query}
            onInput={(e) => setFilter({ ...filter, query: (e.target as HTMLInputElement).value })}
          />
          <label>
            向聴
            <select
              value={filter.maxShanten === null ? '' : String(filter.maxShanten)}
              onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value;
                setFilter({ ...filter, maxShanten: v === '' ? null : Number(v) });
              }}
            >
              <option value="">すべて</option>
              <option value="0">聴牌</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={String(n)}>
                  {n}向聴以内
                </option>
              ))}
            </select>
          </label>
          <label>
            並べ替え
            <select
              value={filter.sort}
              onChange={(e) => setFilter({ ...filter, sort: (e.target as HTMLSelectElement).value as SortOrder })}
            >
              <option value="default">既定順</option>
              <option value="shanten">向聴が近い順</option>
              <option value="ukeire">有効牌が多い順</option>
            </select>
          </label>
        </div>
        <div class="yaku-filter-row">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              class={`filter-chip ${filter.categories.includes(c.key) ? 'filter-chip-on' : ''}`}
              aria-pressed={filter.categories.includes(c.key)}
              onClick={() => toggleCategory(c.key)}
            >
              {c.label}
            </button>
          ))}
          <span class="yaku-filter-count">
            {visibleCount} / {total}役を表示中
          </span>
          {!isDefaultFilter(filter) && (
            <button type="button" class="filter-clear" onClick={() => setFilter(DEFAULT_FILTER)}>
              条件をクリア
            </button>
          )}
        </div>
      </div>
      {tip && YAKU_CONDITIONS[tip.key] && (
        <div id="yaku-tip" role="tooltip" class="yaku-tip" style={{ left: `${tip.left}px`, top: `${tip.top}px` }}>
          <strong>{shown.get(tip.key)?.name}</strong>
          <span>{YAKU_CONDITIONS[tip.key]}</span>
        </div>
      )}
      <div class="yaku-table-scroll">
        <table class="yaku-table">
          <thead>
            <tr>
              <th scope="col">役</th>
              <th scope="col">翻</th>
              <th scope="col">向聴</th>
              <th scope="col">有効牌</th>
              <th scope="col">合計枚数</th>
            </tr>
          </thead>
          <tbody>
            {renderRow('normal')}
            {keys.map(renderRow)}
          </tbody>
        </table>
        {visibleCount === 0 && (
          <p class="yaku-filter-empty">
            該当する役がありません
            <button type="button" class="filter-clear" onClick={() => setFilter(DEFAULT_FILTER)}>
              条件をクリア
            </button>
          </p>
        )}
      </div>
    </section>
  );
}
