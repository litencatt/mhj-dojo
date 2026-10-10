import { useEffect, useRef, useState } from 'preact/hooks';
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
  gameKind,
  type DojoGameKind,
  type DojoProgress,
} from './progress';
import { LENGTH_NAMES, roundName } from '../components/GameTable';
import type { CpuLevel, GameLength } from '../api';
import { HANCHAN_LEVEL, NORMAL_CPU_LEVEL, rankMultiplierLabel, rankName } from './rules';
import { MASTER_MATCH_LENGTH } from './masterMatch';
import { discardUnfinishedDojoGames, savedGames } from '../saves';
import { CPU_LEVEL_NAMES } from '../gameOptions';
import { Shop } from './Shop';
import { Curriculum } from './Curriculum';
import { GuideDialog } from './GuideDialog';
import { guideFor } from './yakuGuide';
import { LooksSettings, useDojoLooks } from './looks';
import './dojo.css';

/**
 * ?mode=dojo&play=1[&match=ura][&seed=]: the page that starts a dojo game (match=ura: a ウラ面
 * game). The seed of this page's URL is kept unless that game was settled already: it would pay
 * its rounds again but never settle (no rank, no redraw or summon cost).
 */
function playHref(settled: readonly string[], ura = false): string {
  const params = new URLSearchParams({ mode: 'dojo', play: '1' });
  if (ura) params.set('match', 'ura');
  const seed = hubSeed(settled);
  if (seed !== undefined) params.set('seed', String(seed));
  return `?${params}`;
}

/** The seed of the hub's URL that a game started here is dealt on, unless that game was settled already. */
function hubSeed(settled: readonly string[]): number | undefined {
  const seed = new URLSearchParams(location.search).get('seed');
  return seed && !settled.includes(seed) && Number.isSafeInteger(Number(seed)) ? Number(seed) : undefined;
}

// What an unfinished game is called, by its kind (progress.ts gameKind).
const KIND_NAMES: Record<DojoGameKind, string> = { omote: '対局', master: '師範戦', ura: 'ウラ面の対局' };

// The hub's two faces once the 師範戦 is won: the 表's game and the ウラ面's (against the urashihan).
const SIDES = [
  { key: 'omote', label: '表' },
  { key: 'ura', label: 'ウラ面' },
] as const;

const LENGTHS: { value: GameLength; level: number }[] = [
  { value: 'tonpuu', level: 1 },
  { value: 'hanchan', level: HANCHAN_LEVEL },
];
// The master (師範) and the urashihan (裏師範) are not the hub's game: they play the 師範戦 (課程) and
// the ウラ面's games (its tab).
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

/** The dojo hub (?mode=dojo): level, coins, the curriculum, the yaku owned, the shop, and the settings (game choice, theme, back, looks). */
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
  // The 表 or the ウラ面 (?side=ura, as a ウラ面 game's 道場へ戻る opens it), once the 師範戦 is won.
  const [side, setSide] = useState<'omote' | 'ura'>(() => (new URLSearchParams(location.search).get('side') === 'ura' ? 'ura' : 'omote'));
  const ura = progress.masterMatch.uraOpen && side === 'ura';
  const sideRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Arrow keys, Home and End move between the two tabs (the WAI-ARIA tabs pattern, as the shop's).
  function onSideKey(e: KeyboardEvent, i: number) {
    const to = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: 1 } as Record<string, number>)[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const j = (to + 2) % 2;
    setSide(SIDES[j].key);
    sideRefs.current[j]?.focus();
  }

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
  // The 表's game (設定 chooses it) and the game 対局開始 plays: the 表's or, on the ウラ面, the urashihan's.
  const game = dojoGame(progress);
  const multiplier = rankMultiplierLabel(game.length, game.cpu);
  const play = ura ? { length: MASTER_MATCH_LENGTH, cpu: 'ura' as const } : game;
  // The unfinished game belongs to a face: a 表 game or the 師範戦 to the 表, a ウラ面 game to the ウラ面.
  const resumeKind = resume ? gameKind(resume.cpu as CpuLevel) : null;
  const resumeSide = resumeKind === 'ura' ? 'ura' : 'omote';
  const resumeHere = resume !== null && resumeSide === (ura ? 'ura' : 'omote');
  const discardTitle = resumeKind ? `中断中の${KIND_NAMES[resumeKind]}は破棄され、報酬はもらえません` : undefined;

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
        {progress.masterMatch.uraOpen && (
          <div class="shop-tabs dojo-sides" role="tablist" aria-label="道場の面">
            {SIDES.map((s, i) => (
              <button
                key={s.key}
                ref={(el) => {
                  sideRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`dojo-side-${s.key}`}
                aria-selected={side === s.key}
                aria-controls="dojo-side-panel"
                tabIndex={side === s.key ? 0 : -1}
                onClick={() => setSide(s.key)}
                onKeyDown={(e) => onSideKey(e, i)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <div
          class="dojo-play"
          id="dojo-side-panel"
          role={progress.masterMatch.uraOpen ? 'tabpanel' : undefined}
          aria-labelledby={progress.masterMatch.uraOpen ? `dojo-side-${side}` : undefined}
        >
          {/* With the tabs, each says what its game is, in the same box: switching them keeps the height. */}
          {progress.masterMatch.uraOpen && (
            <p class="dojo-muted dojo-side-note" data-testid="dojo-side-note">
              {ura
                ? `裏師範（イカサマを使う CPU）3人と半荘戦。イカサマが使えます。順位の報酬：${rankMultiplierLabel(play.length, play.cpu)}`
                : `${LENGTH_NAMES[play.length]}・CPU ${CPU_LEVEL_NAMES[play.cpu]}。順位の報酬：${rankMultiplierLabel(play.length, play.cpu) || '×1'}`}
              {resume && !resumeHere && `（中断中の${KIND_NAMES[resumeKind!]}は${resumeSide === 'ura' ? 'ウラ面' : '表'}のタブに）`}
            </p>
          )}
          {resume && resumeHere ? (
            <>
              <a
                class="dojo-start"
                href={`?mode=dojo&game=${encodeURIComponent(resume.id)}`}
                title={resume.round ? roundName(resume.round.wind, resume.round.number, resume.round.honba) : undefined}
              >
                {resumeKind === 'master' ? '続きから（師範戦）' : '続きから'}
              </a>
              <a class="dojo-restart" href={playHref(progress.settled, ura)} title={discardTitle} onClick={discardUnfinishedDojoGames}>
                新しく始める
              </a>
            </>
          ) : (
            // A game unfinished on the other face is dropped by a new start here too (one game at a time).
            <a
              class="dojo-start"
              href={playHref(progress.settled, ura)}
              title={resume ? discardTitle : `${LENGTH_NAMES[play.length]}、CPU は${CPU_LEVEL_NAMES[play.cpu]}`}
              onClick={resume ? discardUnfinishedDojoGames : undefined}
            >
              {ura ? 'ウラ面で対局' : '対局開始'}
            </a>
          )}
        </div>
      </section>

      <Curriculum progress={progress} seed={hubSeed(progress.settled)} onGuide={(key) => setGuide({ key, learned: false })} />

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
