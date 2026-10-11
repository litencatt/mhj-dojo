import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { Tile } from '../components/Tile';
import {
  RIICHI_STICKS,
  TABLE_CLOTHS,
  TILE_BACKS,
  TILE_THEMES,
  WIN_EFFECTS,
  applyRiichiStick,
  applyTableCloth,
  applyTileBack,
  applyTileTheme,
  applyWinEffect,
  type Look,
} from '../tileThemes';
import { parseProgress, saveProgress, setBack, setCloth, setEffect, setStick, setTheme, STORAGE_KEY, type DojoProgress } from './progress';

/**
 * Shows the looks a progress has chosen (tileThemes.ts) on <html>, the defaults
 * for null, and takes them off on leaving. Every mode shows the dojo's choice.
 * Applied before the first paint, so that the default look never flashes.
 */
export function useDojoLooks(progress: DojoProgress | null) {
  const theme = progress?.activeTheme ?? 'default';
  const back = progress?.activeBack ?? 'default';
  const cloth = progress?.activeCloth ?? 'default';
  const stick = progress?.activeStick ?? 'default';
  const effect = progress?.activeEffect ?? 'default';
  useLayoutEffect(() => {
    applyTileTheme(TILE_THEMES.find((t) => t.item === theme)?.id ?? 'default');
    applyTileBack(TILE_BACKS.find((t) => t.item === back)?.id ?? 'default');
    applyTableCloth(cloth);
    applyRiichiStick(stick);
    applyWinEffect(effect);
    return () => {
      applyTileTheme('default');
      applyTileBack('default');
      applyTableCloth('default');
      applyRiichiStick('default');
      applyWinEffect('default');
    };
  }, [theme, back, cloth, stick, effect]);
}

/** The dojo's progress as stored, or null when there is none (the dojo not started) or it does not parse. */
function storedProgress(): DojoProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? null : parseProgress(raw);
  } catch {
    return null;
  }
}

/**
 * The dojo's looks outside the hub (practice, CPU and dojo games): the stored
 * progress (null without one), followed as other tabs change it, and shown.
 * `change` sets a look on what is stored now and stores it, as the hub does;
 * `saveFailed` says the last change was not stored (it shows on this page only).
 */
export function useSharedLooks() {
  const [progress, setProgress] = useState(storedProgress);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) setProgress(storedProgress());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  useDojoLooks(progress);
  function change(apply: (current: DojoProgress) => DojoProgress) {
    const cur = storedProgress();
    if (!cur) return;
    const next = apply(cur);
    setProgress(next);
    if (next !== cur) setSaveFailed(!saveProgress(next));
  }
  return { progress, change, saveFailed };
}

// 設定's choices of the looks: the free default and the ones owned.
const GROUPS: {
  name: string;
  legend: string;
  looks: readonly Look[];
  field: 'activeTheme' | 'activeBack' | 'activeCloth' | 'activeStick' | 'activeEffect';
  set: (p: DojoProgress, item: string) => DojoProgress;
}[] = [
  { name: 'dojo-theme', legend: '牌テーマ', looks: TILE_THEMES, field: 'activeTheme', set: setTheme },
  { name: 'dojo-back', legend: '裏柄', looks: TILE_BACKS, field: 'activeBack', set: setBack },
  { name: 'dojo-cloth', legend: '卓布', looks: TABLE_CLOTHS, field: 'activeCloth', set: setCloth },
  { name: 'dojo-stick', legend: 'リーチ棒', looks: RIICHI_STICKS, field: 'activeStick', set: setStick },
  { name: 'dojo-effect', legend: '和了演出', looks: WIN_EFFECTS, field: 'activeEffect', set: setEffect },
];

interface LooksSettingsProps {
  progress: DojoProgress;
  onChange: (apply: (current: DojoProgress) => DojoProgress) => void;
  open: boolean; // 設定 is open: the win effect chosen plays over the sample
  // Outside the hub: only the kinds with a look owned, none at all without one, and the save's failure.
  ownedOnly?: boolean;
  saveFailed?: boolean;
}

const owned = (progress: DojoProgress, l: Look) => l.item !== null && progress.ownedItems.includes(l.item);

/** 設定's looks (the hub's, a practice's and a game's): the owned ones of each kind, and a sample of them. */
export function LooksSettings({ progress, onChange, open, ownedOnly = false, saveFailed = false }: LooksSettingsProps) {
  // The win effect on the sample plays again on each change of it (its key), and on 演出を見る.
  const [effectPlays, setEffectPlays] = useState(0);
  const groups = ownedOnly ? GROUPS.filter((g) => g.looks.some((l) => owned(progress, l))) : GROUPS;
  if (groups.length === 0) return null;
  return (
    <>
      {saveFailed && (
        <p class="save-failed" role="status">
          道場のデータを保存できませんでした（ブラウザの保存領域を確認してください）。この画面にだけ反映しています。
        </p>
      )}
      {groups.map((g) => (
        <fieldset key={g.name} class="dojo-settings-group">
          <legend>{g.legend}</legend>
          {g.looks
            .filter((l) => l.item === null || owned(progress, l))
            .map((l) => (
              <label key={l.id}>
                <input
                  type="radio"
                  name={g.name}
                  checked={(l.item ?? 'default') === progress[g.field]}
                  onChange={() => onChange((cur) => g.set(cur, l.item ?? 'default'))}
                />
                {l.label}
              </label>
            ))}
        </fieldset>
      ))}
      {/* On the cloth chosen: the tiles, a back and the riichi badge with its stick. */}
      <div class="dojo-settings-sample" aria-label="見本">
        <Tile tile="5m" size="sm" />
        <Tile tile="5p" size="sm" />
        <Tile tile="5s" size="sm" />
        <Tile tile="7z" size="sm" />
        <Tile tile="" size="sm" faceDown />
        <span class="seat-riichi">リーチ</span>
        {progress.activeEffect !== 'default' && (
          <>
            <button type="button" class="dojo-effect-replay" onClick={() => setEffectPlays((n) => n + 1)}>
              演出を見る
            </button>
            {/* Shown while the dialog is open only, so it plays as 設定 opens too. */}
            {open && <div key={`${progress.activeEffect}-${effectPlays}`} class="win-effect" data-testid="win-effect" aria-hidden="true" />}
          </>
        )}
      </div>
    </>
  );
}
