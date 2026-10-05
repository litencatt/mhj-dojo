import { memo } from 'preact/compat';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComboRow, Remaining, Tile as TileCode, YakuRow } from '../api';
import { Tile, mouseOnly } from './Tile';
import { PanelHeading } from './PanelHeading';
import { useMediaQuery } from '../hooks';
import { tileName } from '../tiles';
import { YAKU_CONDITIONS } from './yakuInfo';
import {
  CATEGORIES,
  DEFAULT_FILTER,
  applyYakuFilter,
  isDefaultFilter,
  loadFilter,
  loadFilterOpen,
  saveFilter,
  saveFilterOpen,
  type Category,
  type SortOrder,
  type YakuFilter,
} from './yakuFilter';

export interface YakuTableProps {
  rows: YakuRow[];
  baseline: YakuRow[] | null; // non-null while previewing a discard candidate
  previewTile: string | null;
  combos: ComboRow[]; // yaku combinations of the shown hand (the preview while previewing)
  baseCombos: ComboRow[] | null; // the current node's combos while previewing
  remaining: Remaining; // unseen copies of each ukeire tile
  onMinimize?: () => void;
  minimized?: boolean; // in the dock: the filter is kept, nothing is drawn
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

function UkeireCell({ ukeire, remaining }: { ukeire: TileCode[]; remaining: Remaining }) {
  if (ukeire.length === 0) return <span class="muted">—</span>;
  return (
    <div class="ukeire-tiles">
      {ukeire.map((tile) => {
        const left = remaining[tile] ?? 0;
        return (
          <div key={tile} class={`ukeire-item ${left === 0 ? 'ukeire-item-zero' : ''}`}>
            <Tile tile={tile} size="xs" dimmed={left === 0} />
            <span class="ukeire-count">{left}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Whether a row is at 聴牌 (0) or already 和了 (-1): shown in light red. */
function isTenpai(shanten: number | null): boolean {
  return shanten !== null && shanten <= 0;
}

/** 複合役: the best combinations of yaku one hand can score together, ranked
 * by the engine (docs/api.md "Yaku combos"). While previewing, a combination
 * the current node also lists shows its shanten delta. */
function ComboTable({ combos, base, remaining }: { combos: ComboRow[]; base: ComboRow[] | null; remaining: Remaining }) {
  if (combos.length === 0) return null;
  const baseByName = new Map((base ?? []).map((c) => [c.name, c]));
  return (
    <details class="combo-section" open>
      <summary>複合役（上位{combos.length}件）</summary>
      <table class="combo-table">
        <thead>
          <tr>
            <th scope="col">役の組み合わせ</th>
            <th scope="col">翻</th>
            <th scope="col">向聴</th>
            <th scope="col">有効牌</th>
            <th scope="col">合計枚数</th>
          </tr>
        </thead>
        <tbody>
          {combos.map((c) => {
            const b = baseByName.get(c.name);
            const delta = base && b ? deltaLabel(c.shanten, b.shanten) : null;
            return (
              <tr key={c.name} class={isTenpai(c.shanten) ? 'row-tenpai' : undefined}>
                <th scope="row" class="combo-name-cell">
                  {c.name}
                  {c.approx && <span class="badge-approx">近似</span>}
                </th>
                <td class="han-cell">{c.han}翻</td>
                <td class="shanten-cell">
                  <span>{shantenLabel(c.shanten)}</span>
                  {delta && <span class={`delta ${delta.cls}`}>{delta.text}</span>}
                </td>
                <td class="ukeire-cell">
                  <UkeireCell ukeire={c.ukeire} remaining={remaining} />
                </td>
                <td class="ukeire-total-cell">{c.ukeire_total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

/** 役別向聴テーブル: shows either the current-node analysis, or (while previewing a
 * discard) that candidate's resulting analysis with deltas vs the current node.
 * A filter bar narrows and sorts the rows by the current values, so rows do not
 * jump while previewing. The normal row always comes first. */
export const YakuTable = memo(function YakuTable(props: YakuTableProps) {
  const { rows, baseline, previewTile, combos, baseCombos, remaining, onMinimize, minimized } = props;
  const [filter, setFilterState] = useState<YakuFilter>(loadFilter);
  const setFilter = (f: YakuFilter) => {
    setFilterState(f);
    saveFilter(f);
  };
  // A phone has no 複合役 and no name search, so no search text either (the
  // saved one is kept for a wider screen).
  const phone = useMediaQuery('(width <= 760px)'); // style.css's phone layout
  const active = phone ? { ...filter, query: '' } : filter;
  // 条件をクリア on a phone keeps that hidden search text too. Its button
  // then goes away, so focus moves to 絞り込み rather than to the page.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const clearFilter = () => {
    setFilter(phone ? { ...DEFAULT_FILTER, query: filter.query } : DEFAULT_FILTER);
    toggleRef.current?.focus();
  };
  // The filter bar folds away behind 絞り込み, leaving the count (and
  // 条件をクリア) above the table. It starts folded on a phone, upright or on
  // its side, where the table scrolls in a short panel, and open on a wider
  // screen; once toggled, the player's choice holds on every screen size.
  const compact = useMediaQuery('(width <= 760px), (height <= 500px)');
  const [savedOpen, setSavedOpen] = useState(loadFilterOpen);
  const filterOpen = savedOpen ?? !compact;
  const toggleFilter = () => {
    setSavedOpen(!filterOpen);
    saveFilterOpen(!filterOpen);
  };
  // On a phone (no 複合役 in between) 絞り込み sits in the heading, and the
  // chips, the count and 条件をクリア share one row: the count is shortened
  // while the bar is open, 条件をクリア is an icon, and the screen reader
  // still reads both in full.
  const filterId = useId();
  const filterToggle = (
    <button
      type="button"
      class="yaku-filter-toggle"
      ref={toggleRef}
      aria-expanded={filterOpen}
      aria-controls={`${filterId}-chips ${filterId}-options`}
      onClick={toggleFilter}
    >
      絞り込み <span aria-hidden="true">{filterOpen ? '▴' : '▾'}</span>
    </button>
  );
  // Crossing 760px remounts 絞り込み in its other place: keep its focus. The
  // old one is still in the page while this renders.
  const toggleHadFocus = useRef(false);
  toggleHadFocus.current = toggleRef.current !== null && document.activeElement === toggleRef.current;
  useLayoutEffect(() => {
    if (toggleHadFocus.current) toggleRef.current?.focus();
  }, [phone]);

  // Tooltip with the hovered/focused yaku's conditions. It is fixed to the
  // viewport so the scrolling table panel cannot clip it. It opens below the
  // name, or above it when there is not enough room at the bottom of the screen.
  const [tip, setTip] = useState<{ key: string; left: number; above: number; below: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const showTip = (key: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const width = 280;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setTip({ key, left, above: r.top - 6, below: r.bottom + 6 });
  };
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!tip || !el) return;
    const h = el.offsetHeight;
    const fitsBelow = tip.below + h <= window.innerHeight - 8;
    el.style.top = `${fitsBelow ? tip.below : Math.max(8, tip.above - h)}px`;
    el.style.visibility = 'visible';
  }, [tip]);
  // The position is computed once, so close the tooltip when anything scrolls.
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [tip]);

  if (minimized) return null;

  const current = baseline ?? rows; // filter/sort by the current node, not the preview
  const shown = new Map(rows.map((r) => [r.key, r]));
  const base = new Map((baseline ?? []).map((r) => [r.key, r]));
  const { keys, total } = applyYakuFilter(current, active);
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
    const rowClass = isTenpai(row.shanten) ? 'row-tenpai' : isBest ? 'row-best' : undefined;
    return (
      <tr key={row.key} class={rowClass}>
        <th scope="row" class="yaku-name-cell">
          <span
            class="yaku-name"
            tabIndex={0}
            aria-describedby={tip?.key === row.key ? 'yaku-tip' : undefined}
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse') showTip(row.key, e.currentTarget as HTMLElement);
            }}
            onPointerLeave={mouseOnly(() => setTip(null))}
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
          <UkeireCell ukeire={row.ukeire} remaining={remaining} />
        </td>
        <td class="ukeire-total-cell">{row.ukeire_total}</td>
      </tr>
    );
  }

  // The count and 条件をクリア. Folded on a phone they move up into the heading
  // row, next to 絞り込み, so the table starts higher.
  const statusInHeading = phone && !filterOpen;
  const status = (
    <span class="yaku-filter-status">
      {phone ? (
        <span class="yaku-filter-count">
          <span aria-hidden="true">
            {visibleCount}/{total}
          </span>
          <span class="visually-hidden">
            {visibleCount} / {total}役を表示中
          </span>
        </span>
      ) : (
        <span class="yaku-filter-count">
          {visibleCount} / {total}役を表示中
        </span>
      )}
      {!isDefaultFilter(active) &&
        (phone ? (
          <button
            type="button"
            class="filter-clear filter-clear-icon"
            onClick={clearFilter}
            aria-label="条件をクリア"
            title="条件をクリア"
          >
            ✕
          </button>
        ) : (
          <button type="button" class="filter-clear" onClick={clearFilter}>
            条件をクリア
          </button>
        ))}
    </span>
  );

  const toggleCategory = (c: Category) =>
    setFilter({
      ...filter,
      categories: filter.categories.includes(c) ? filter.categories.filter((x) => x !== c) : [...filter.categories, c],
    });

  return (
    <section class="yaku-table-panel" aria-label="役別向聴テーブル">
      <PanelHeading
        title="役別向聴"
        onMinimize={onMinimize}
        actions={
          phone && (
            <>
              {statusInHeading && status}
              {filterToggle}
            </>
          )
        }
      >
        {previewTile && <span class="preview-note"> — {tileName(previewTile)} を打牌した場合のプレビュー</span>}
      </PanelHeading>
      {!phone && <ComboTable combos={combos} base={baseCombos} remaining={remaining} />}
      <div class="yaku-filter" role="group" aria-label="役の絞り込み">
        <div class="yaku-filter-row" hidden={statusInHeading}>
          {!phone && filterToggle}
          <span id={`${filterId}-chips`} class="yaku-filter-chips" hidden={!filterOpen}>
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
          </span>
          {!statusInHeading && status}
        </div>
        <div id={`${filterId}-options`} class="yaku-filter-row" hidden={!filterOpen}>
          {!phone && (
            <input
              type="search"
              class="yaku-filter-search"
              placeholder="役名で検索（例: 一色, そめ）"
              aria-label="役名で検索"
              value={filter.query}
              onInput={(e) => setFilter({ ...filter, query: (e.target as HTMLInputElement).value })}
            />
          )}
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
      </div>
      {tip && YAKU_CONDITIONS[tip.key] && (
        <div
          id="yaku-tip"
          role="tooltip"
          class="yaku-tip"
          ref={tipRef}
          style={{ left: `${tip.left}px`, top: `${tip.below}px`, visibility: 'hidden' }}
        >
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
            <button type="button" class="filter-clear" onClick={clearFilter}>
              条件をクリア
            </button>
          </p>
        )}
      </div>
    </section>
  );
});
