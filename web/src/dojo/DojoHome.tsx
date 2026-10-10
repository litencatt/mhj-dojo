import { useEffect, useState } from 'preact/hooks';
import { SettingsDialog } from '../components/SettingsDialog';
import { SiteHeader } from '../components/SiteHeader';
import { YAKUHAI_KEYS, yakuName } from './catalog';
import {
  cpuUnlocked,
  dojoGame,
  level,
  levelProgress,
  loadProgress,
  lengthUnlocked,
  saveProgress,
  setGameCpu,
  setGameLength,
  STORAGE_KEY,
  xpForLevel,
  type DojoProgress,
} from './progress';
import { LENGTH_NAMES, roundName } from '../components/GameTable';
import type { CpuLevel, GameLength } from '../api';
import { HANCHAN_LEVEL, NORMAL_CPU_LEVEL, rankMultiplierLabel, rankName } from './rules';
import { discardUnfinishedDojoGames, savedGames } from '../saves';
import { CPU_LEVEL_NAMES } from '../gameOptions';
import { Shop } from './Shop';
import { GuideDialog } from './GuideDialog';
import { guideFor } from './yakuGuide';
import { LooksSettings, useDojoLooks } from './looks';
import './dojo.css';

/**
 * ?mode=dojo&play=1[&seed=]: the page that starts a dojo game. The seed of this
 * page's URL is kept unless that game was settled already: it would pay its
 * rounds again but never settle (no rank, no redraw or summon cost).
 */
function playHref(settled: readonly string[]): string {
  const params = new URLSearchParams({ mode: 'dojo', play: '1' });
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed && !settled.includes(seed)) params.set('seed', seed);
  return `?${params}`;
}

const LENGTHS: { value: GameLength; level: number }[] = [
  { value: 'tonpuu', level: 1 },
  { value: 'hanchan', level: HANCHAN_LEVEL },
];
// The master (師範) is not offered yet: the dojo's 師範戦 comes with #323.
const CPUS: { value: CpuLevel; level: number }[] = [
  { value: 'weak', level: 1 },
  { value: 'normal', level: NORMAL_CPU_LEVEL },
];

/** The owned yaku, the dragons and the winds shown once as 役牌 (they are bought as one); `guide` is the key of its guide, if it has one. */
function ownedYaku(owned: readonly string[]): { name: string; guide?: string }[] {
  const out: { name: string; guide?: string }[] = [];
  for (const k of owned) {
    const name = YAKUHAI_KEYS.includes(k) ? '役牌' : yakuName(k);
    if (!out.some((y) => y.name === name)) out.push({ name, guide: guideFor(k)?.key });
  }
  return out;
}

/** The dojo hub (?mode=dojo): level, coins, the yaku owned, the shop, and the settings (game choice, theme, back, looks). */
export function DojoHome() {
  const [loaded] = useState(() => loadProgress());
  const [progress, setProgress] = useState<DojoProgress>(loaded.progress);
  const [notice, setNotice] = useState<string | null>(
    loaded.corrupted ? '保存された道場のデータを読み込めませんでした。元のデータは別に残し、最初から始めます。' : null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The yaku guide shown (a yaku just bought, or an owned one chosen in 所持役).
  const [guide, setGuide] = useState<{ key: string; learned: boolean } | null>(null);
  // The dojo's own unfinished games (the CPU game's list never has them).
  // The dojo plays one game at a time: the latest unfinished one is offered (older ones, from before, too are dropped on a new start).
  const [resume] = useState(() => savedGames('dojo').find((g) => g.round && !g.round.over) ?? null);

  // A bought 立直 was refunded on reading: said once, when the refund is stored (the next reading finds none).
  useEffect(() => {
    if (loaded.refunded > 0 && saveProgress(loaded.progress)) {
      setNotice(`立直が初期の役になったため、立直の代金${loaded.refunded}銭を返しました。`);
    }
  }, [loaded]);

  useEffect(() => {
    document.title = 'mhj-dojo - 道場';
    // Follows the progress another tab has stored.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) setProgress(loadProgress().progress);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // The looks chosen show on the settings' sample (and in every mode).
  useDojoLooks(progress);

  // Another tab may have changed the progress (paid a game): apply to what is stored now.
  function change(apply: (current: DojoProgress) => DojoProgress) {
    const cur = loadProgress().progress;
    const next = apply(cur);
    setProgress(next);
    if (next !== cur && !saveProgress(next)) setNotice('道場のデータを保存できませんでした（ブラウザの保存領域を確認してください）。');
  }

  const lv = level(progress.xp);
  const next = xpForLevel(lv + 1);
  const bar = Math.round(levelProgress(progress.xp) * 100);
  const game = dojoGame(progress);
  const multiplier = rankMultiplierLabel(game.length, game.cpu);

  return (
    <div class="dojo-home">
      <SiteHeader mode="dojo" onSettings={() => setSettingsOpen(true)} />

      {notice && !settingsOpen && (
        <p class="dojo-notice" role="status">
          {notice}
        </p>
      )}

      <section class="dojo-panel" aria-labelledby="dojo-status-heading">
        <h2 id="dojo-status-heading">修行の記録</h2>
        <div class="dojo-status">
          <span class="dojo-level" data-testid="dojo-level">{rankName(lv)}</span>
          <div
            class="dojo-xpbar"
            role="progressbar"
            aria-label="次の級位までの稽古"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={bar}
          >
            <div style={{ width: `${bar}%` }} />
          </div>
          <small class="dojo-muted" data-testid="dojo-xp" title="稽古">
            {progress.xp} / {next}
          </small>
          <span class="dojo-coin-count">
            <span class="dojo-coins" data-testid="dojo-coins">{progress.coins}</span> 銭
          </span>
        </div>
        <div class="dojo-play">
          {resume ? (
            <>
              <a
                class="dojo-start"
                href={`?mode=dojo&game=${encodeURIComponent(resume.id)}`}
                title={resume.round ? roundName(resume.round.wind, resume.round.number, resume.round.honba) : undefined}
              >
                続きから
              </a>
              <a class="dojo-restart" href={playHref(progress.settled)} title="中断中の対局は破棄され、報酬はもらえません" onClick={discardUnfinishedDojoGames}>
                新しく始める
              </a>
            </>
          ) : (
            <a class="dojo-start" href={playHref(progress.settled)} title={`${LENGTH_NAMES[game.length]}、CPU は${CPU_LEVEL_NAMES[game.cpu]}`}>
              対局開始
            </a>
          )}
        </div>
      </section>

      <section class="dojo-panel" aria-labelledby="dojo-yaku-heading">
        <h2 id="dojo-yaku-heading">所持役（{ownedYaku(progress.ownedYaku).length}）</h2>
        <ul class="dojo-yaku" data-testid="dojo-yaku" tabIndex={0} aria-labelledby="dojo-yaku-heading">
          {ownedYaku(progress.ownedYaku).map(({ name, guide: guideKey }) => (
            <li key={name}>
              {guideKey ? (
                <button type="button" class="dojo-yaku-guide" data-guide={guideKey} aria-haspopup="dialog" onClick={() => setGuide({ key: guideKey, learned: false })}>
                  {name}
                </button>
              ) : (
                name
              )}
            </li>
          ))}
        </ul>
      </section>

      <Shop progress={progress} onChange={change} onLearned={(key) => setGuide({ key, learned: true })} />
      <GuideDialog yakuKey={guide?.key ?? null} learned={guide?.learned ?? false} onClose={() => {
        // The 購入 that opened a bought yaku's guide is gone, so focus goes to the yaku's chip.
        if (guide?.learned) document.querySelector<HTMLElement>(`[data-guide="${guide.key}"]`)?.focus();
        setGuide(null);
      }} />

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        {notice && settingsOpen && (
          <p class="dojo-notice" role="status">
            {notice}
          </p>
        )}
        {/* The game a new start plays: the choices unlock with the rank (no purchase). */}
        <div class="dojo-game-options">
          <fieldset class="dojo-settings-group">
            <legend>長さ</legend>
            {LENGTHS.map((o) => (
              <label key={o.value}>
                <input
                  type="radio"
                  name="dojo-length"
                  checked={game.length === o.value}
                  disabled={!lengthUnlocked(progress, o.value)}
                  onChange={() => change((cur) => setGameLength(cur, o.value))}
                />
                {LENGTH_NAMES[o.value]}
                {!lengthUnlocked(progress, o.value) && <small class="dojo-muted">（{rankName(o.level)}で解禁）</small>}
              </label>
            ))}
          </fieldset>
          <fieldset class="dojo-settings-group">
            <legend>CPU</legend>
            {CPUS.map((o) => (
              <label key={o.value}>
                <input
                  type="radio"
                  name="dojo-cpu"
                  checked={game.cpu === o.value}
                  disabled={!cpuUnlocked(progress, o.value)}
                  onChange={() => change((cur) => setGameCpu(cur, o.value))}
                />
                {CPU_LEVEL_NAMES[o.value]}
                {!cpuUnlocked(progress, o.value) && <small class="dojo-muted">（{rankName(o.level)}で解禁）</small>}
              </label>
            ))}
          </fieldset>
          {multiplier && (
            <p class="dojo-muted" data-testid="dojo-multiplier">
              順位の報酬 {multiplier}
            </p>
          )}
        </div>
        <LooksSettings progress={progress} onChange={change} open={settingsOpen} />
      </SettingsDialog>
    </div>
  );
}
