import { useRef, useState } from 'preact/hooks';
import { CATALOG, findItem, type ItemKind, type ShopItem } from './catalog';
import { level, owns, purchase, setTheme, type DojoProgress, type PurchaseDenied } from './progress';

/** Why an item is not for sale yet; null when it is. */
function lockedLabel(p: DojoProgress, item: ShopItem): string | null {
  if (level(p.xp) < item.level) return `Lv ${item.level} で解禁`;
  const missing = (item.requires ?? []).find((r) => !owns(p, r));
  if (missing) return `${findItem(missing)?.name ?? missing}が必要`;
  return null;
}

export const DENIED: Record<PurchaseDenied, string> = {
  unknown: '売っていない商品です',
  owned: 'すでに持っています',
  level: 'レベルが足りません',
  requires: '前提の商品が必要です',
  coins: 'コインが足りません',
};

// The shop's tabs, each a group of item kinds (the yakuman pack sells with the yaku).
const TABS: { key: string; label: string; kinds: ItemKind[] }[] = [
  { key: 'yaku', label: '役', kinds: ['yaku', 'pack'] },
  { key: 'theme', label: '牌テーマ', kinds: ['theme'] },
  { key: 'assist', label: '補助', kinds: ['assist'] },
  { key: 'cheat', label: 'イカサマ', kinds: ['cheat'] },
];

interface ShopProps {
  progress: DojoProgress;
  // Applies a change to the progress as it is stored now (another tab may have paid a game since).
  onChange: (change: (current: DojoProgress) => DojoProgress) => void;
}

/** The dojo's shop: the items of the chosen tab by level, bought with coins. */
export function Shop({ progress: p, onChange }: ShopProps) {
  const [tab, setTab] = useState(TABS[0].key);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lv = level(p.xp);
  const shown = CATALOG.filter((it) => TABS.find((t) => t.key === tab)!.kinds.includes(it.kind));
  const levels = [...new Set(shown.map((it) => it.level))].sort((a, b) => a - b);

  // Arrow keys, Home and End move between the tabs (the WAI-ARIA tabs pattern).
  function onTabKey(e: KeyboardEvent, i: number) {
    const to = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 } as Record<string, number>)[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const j = (to + TABS.length) % TABS.length;
    setTab(TABS[j].key);
    tabRefs.current[j]?.focus();
  }

  function buy(id: string) {
    onChange((cur) => {
      const r = purchase(cur, id);
      return r.ok ? r.progress : cur;
    });
  }

  return (
    <section class="dojo-panel" aria-labelledby="dojo-shop-heading">
      <h2 id="dojo-shop-heading">ショップ</h2>
      <div class="shop-tabs" role="tablist" aria-label="商品の種類">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`shop-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="shop-tabpanel"
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="shop-tabpanel" class="shop-tabpanel" role="tabpanel" tabIndex={0} aria-labelledby={`shop-tab-${tab}`}>
      {levels.map((n) => (
        <div key={n} class="shop-level">
          <h3 class={n > lv ? 'shop-level-locked' : undefined}>Lv {n}</h3>
          <ul class="shop-list">
            {shown.filter((it) => it.level === n).map((it) => {
              const have = owns(p, it.id);
              const locked = lockedLabel(p, it);
              const isTheme = it.kind === 'theme';
              return (
                <li key={it.id} class="shop-item" data-item={it.id} data-owned={have || undefined}>
                  <span class="shop-name">{it.name}</span>
                  <span class="shop-price">{it.price} コイン</span>
                  {have && isTheme ? (
                    <button
                      type="button"
                      aria-pressed={p.activeTheme === it.id}
                      onClick={() => onChange((cur) => setTheme(cur, cur.activeTheme === it.id ? 'default' : it.id))}
                    >
                      {p.activeTheme === it.id ? '使用中' : '使う'}
                    </button>
                  ) : have ? (
                    <span class="shop-owned">所持</span>
                  ) : locked ? (
                    <span class="shop-locked">{locked}</span>
                  ) : (
                    <button type="button" disabled={p.coins < it.price} onClick={() => buy(it.id)}>
                      購入
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      </div>
    </section>
  );
}
