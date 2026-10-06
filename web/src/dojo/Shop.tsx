import { CATALOG, findItem, type ShopItem } from './catalog';
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

interface ShopProps {
  progress: DojoProgress;
  // Applies a change to the progress as it is stored now (another tab may have paid a game since).
  onChange: (change: (current: DojoProgress) => DojoProgress) => void;
}

/** The dojo's shop: the items by level, bought with coins. */
export function Shop({ progress: p, onChange }: ShopProps) {
  const lv = level(p.xp);
  const levels = [...new Set(CATALOG.map((it) => it.level))].sort((a, b) => a - b);

  function buy(id: string) {
    onChange((cur) => {
      const r = purchase(cur, id);
      return r.ok ? r.progress : cur;
    });
  }

  return (
    <section class="dojo-panel" aria-labelledby="dojo-shop-heading">
      <h2 id="dojo-shop-heading">ショップ</h2>
      {levels.map((n) => (
        <div key={n} class="shop-level">
          <h3 class={n > lv ? 'shop-level-locked' : undefined}>Lv {n}</h3>
          <ul class="shop-list">
            {CATALOG.filter((it) => it.level === n).map((it) => {
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
    </section>
  );
}
