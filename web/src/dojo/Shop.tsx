import { useRef, useState } from 'preact/hooks';
import { CATALOG, findItem, type ItemKind, type ShopItem } from './catalog';
import { level, owns, purchase, setBack, setTheme, type DojoProgress, type PurchaseDenied } from './progress';
import { rankName } from './rules';

/** Why an item is not for sale yet; null when it is. */
function lockedLabel(p: DojoProgress, item: ShopItem): string | null {
  if (level(p.xp) < item.level) return `${rankName(item.level)}で解禁`;
  const missing = (item.requires ?? []).find((r) => !owns(p, r));
  if (missing) return `${findItem(missing)?.name ?? missing}が必要`;
  return null;
}

export const DENIED: Record<PurchaseDenied, string> = {
  unknown: '売っていない商品です',
  owned: 'すでに持っています',
  level: '級位が足りません',
  requires: '前提の商品が必要です',
  coins: '銭が足りません',
};

// The shop's tabs, each a group of item kinds (the yakuman pack sells with the yaku).
const TABS: { key: string; label: string; kinds: ItemKind[] }[] = [
  { key: 'yaku', label: '役', kinds: ['yaku', 'pack'] },
  { key: 'theme', label: '牌テーマ', kinds: ['theme', 'back'] },
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
  const shown = CATALOG.filter((it) => TABS.find((t) => t.key === tab)!.kinds.includes(it.kind));

  // Arrow keys, Home and End move between the tabs (the WAI-ARIA tabs pattern).
  function onTabKey(e: KeyboardEvent, i: number) {
    const to = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 } as Record<string, number>)[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const j = (to + TABS.length) % TABS.length;
    setTab(TABS[j].key);
    tabRefs.current[j]?.focus();
  }

  // 購入 asks first, in a modal dialog: 購入 buys, キャンセル (or Esc) does not.
  const confirmRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<ShopItem | null>(null);
  function ask(item: ShopItem) {
    setPending(item);
    confirmRef.current?.showModal();
  }
  function buy() {
    const id = pending?.id;
    confirmRef.current?.close();
    if (!id) return;
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
          {/* In unlock order; a locked item says its rank where its button would be. */}
          <ul class="shop-list">
            {[...shown].sort((a, b) => a.level - b.level).map((it) => {
              const have = owns(p, it.id);
              const locked = lockedLabel(p, it);
              // A theme or a back owned is chosen here (again: back to the default).
              const active = it.kind === 'theme' ? p.activeTheme : it.kind === 'back' ? p.activeBack : null;
              return (
                <li key={it.id} class="shop-item" data-item={it.id} data-owned={have || undefined}>
                  <span class="shop-name">{it.name}</span>
                  <span class="shop-price">{it.price} 銭</span>
                  {have && active !== null ? (
                    <button
                      type="button"
                      aria-pressed={active === it.id}
                      onClick={() =>
                        onChange((cur) =>
                          it.kind === 'theme'
                            ? setTheme(cur, cur.activeTheme === it.id ? 'default' : it.id)
                            : setBack(cur, cur.activeBack === it.id ? 'default' : it.id),
                        )
                      }
                    >
                      {active === it.id ? '使用中' : '使う'}
                    </button>
                  ) : have ? (
                    <span class="shop-owned">所持</span>
                  ) : locked ? (
                    <span class="shop-locked">{locked}</span>
                  ) : (
                    <button type="button" disabled={p.coins < it.price} onClick={() => ask(it)}>
                      購入
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
      </div>
      <dialog ref={confirmRef} class="shop-confirm" aria-labelledby="shop-confirm-heading" onClose={() => setPending(null)}>
        {pending && (
          <>
            <h2 id="shop-confirm-heading">購入しますか？</h2>
            <p class="shop-confirm-item">{pending.name}</p>
            <p class="dojo-muted">
              {pending.price} 銭（残り {p.coins} → {p.coins - pending.price} 銭）
            </p>
            <div class="dojo-actions">
              <button type="button" class="shop-confirm-buy" onClick={buy}>
                購入
              </button>
              <button type="button" onClick={() => confirmRef.current?.close()}>
                キャンセル
              </button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
