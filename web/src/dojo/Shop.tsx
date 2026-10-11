import { useEffect, useRef, useState } from 'preact/hooks';
import { useBackdropClose } from '../components/backdrop';
import { CATALOG, findItem, type ItemKind, type ShopItem } from './catalog';
import { level, owns, purchase, type DojoProgress } from './progress';
import { rankName } from './rules';
import { guideFor } from './yakuGuide';

/** Why an item is not for sale yet; null when it is. */
function lockedLabel(p: DojoProgress, item: ShopItem): string | null {
  if (item.kind === 'cheat') {
    if (!p.masterMatch.uraOpen) return '師範戦に勝つと解禁';
  } else if (level(p.xp) < item.level) {
    return `${rankName(item.level)}で解禁`;
  }
  const missing = (item.requires ?? []).find((r) => !owns(p, r));
  if (missing) return `${findItem(missing)?.name ?? missing}が必要`;
  return null;
}

// The shop's tabs, each a group of item kinds (the yakuman pack sells with the yaku, the
// table's looks with the tile themes and backs).
const TABS: { key: string; label: string; kinds: ItemKind[] }[] = [
  { key: 'yaku', label: '役', kinds: ['yaku', 'pack'] },
  { key: 'theme', label: '見た目', kinds: ['theme', 'back', 'cloth', 'stick', 'effect'] },
  { key: 'assist', label: '補助', kinds: ['assist'] },
  { key: 'cheat', label: 'イカサマ', kinds: ['cheat'] },
];

// The items chosen in 設定 once owned.
const LOOK_KINDS: ItemKind[] = ['theme', 'back', 'cloth', 'stick', 'effect'];

interface ShopProps {
  progress: DojoProgress;
  // Applies a change to the progress as it is stored now (another tab may have paid a game since).
  onChange: (change: (current: DojoProgress) => DojoProgress) => void;
  // A yaku (or 役牌) was bought: the hub shows its guide.
  onLearned: (id: string) => void;
}

/** The dojo's shop: the items of the chosen tab by level, bought with coins. */
export function Shop({ progress: p, onChange, onLearned }: ShopProps) {
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

  // 購入 asks first, in a modal dialog: 購入 buys, キャンセル (or Esc, or a click on the backdrop) does not.
  const confirmRef = useRef<HTMLDialogElement>(null);
  const backdrop = useBackdropClose(() => confirmRef.current?.close());
  const [pending, setPending] = useState<ShopItem | null>(null);
  function ask(item: ShopItem) {
    setPending(item);
  }
  // Opened once the item is rendered in it, so it has its name and focus lands on 購入.
  useEffect(() => {
    const d = confirmRef.current;
    if (pending && d && !d.open) {
      d.showModal();
      d.querySelector<HTMLButtonElement>('.shop-confirm-buy')?.focus();
    }
  }, [pending]);
  function buy() {
    const id = pending?.id;
    confirmRef.current?.close();
    if (!id) return;
    // The guide is for a purchase that went through (another tab may have spent the coins since).
    let bought = false;
    onChange((cur) => {
      const r = purchase(cur, id);
      bought = r.ok;
      return r.ok ? r.progress : cur;
    });
    if (bought && guideFor(id)) onLearned(id);
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
          {tab === 'cheat' && (
            <p class="dojo-muted shop-note" data-testid="shop-cheat-note">
              {p.masterMatch.uraOpen ? 'イカサマはウラ面の対局で使えます（師範戦では使えません）。' : 'イカサマは師範戦に勝つと開くウラ面で解禁され、ウラ面の対局で使えます。'}
              {p.legacyCheats.length > 0 && 'ウラ面ができる前から持っているイカサマは、師範戦を除く表の対局でも使えます。'}
            </p>
          )}
          {/* In unlock order; a locked item says its rank (a cheat, the 師範戦) where its button would be. */}
          <ul class="shop-list">
            {[...shown].sort((a, b) => a.level - b.level).map((it) => {
              const have = owns(p, it.id);
              const locked = lockedLabel(p, it);
              return (
                <li key={it.id} class="shop-item" data-item={it.id} data-owned={have || undefined}>
                  <span class="shop-name">{it.name}</span>
                  <span class="shop-price">{it.price} 銭</span>
                  {have ? (
                    <span class="shop-owned">
                      所持
                      {LOOK_KINDS.includes(it.kind) && <small class="dojo-muted">（設定で選ぶ）</small>}
                    </span>
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
      <dialog ref={confirmRef} class="shop-confirm" aria-labelledby="shop-confirm-heading" onClose={() => setPending(null)} {...backdrop}>
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
