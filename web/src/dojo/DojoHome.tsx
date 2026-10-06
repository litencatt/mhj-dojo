import { useEffect, useRef, useState } from 'preact/hooks';
import { VersionTag } from '../components/VersionTag';
import { yakuName } from './catalog';
import {
  exportProgress,
  importProgress,
  level,
  levelProgress,
  loadProgress,
  parseProgress,
  saveProgress,
  setBack,
  setTheme,
  STORAGE_KEY,
  xpForLevel,
  type DojoProgress,
} from './progress';
import { roundName } from '../components/GameTable';
import { discardUnfinishedDojoGames, savedGames } from '../wasm';
import { Shop } from './Shop';
import { Tile } from '../components/Tile';
import { TILE_BACKS, TILE_THEMES, applyTileBack, applyTileTheme } from '../tileThemes';
import './dojo.css';

/** ?mode=dojo&play=1[&seed=]: the page that starts a dojo game (the seed of this page's URL kept). */
function playHref(): string {
  const params = new URLSearchParams({ mode: 'dojo', play: '1' });
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed) params.set('seed', seed);
  return `?${params}`;
}

/** The dojo hub (?mode=dojo): level, coins, the yaku owned, the shop, and the settings (theme, back, backup). */
export function DojoHome() {
  const [loaded] = useState(() => loadProgress());
  const [progress, setProgress] = useState<DojoProgress>(loaded.progress);
  const [notice, setNotice] = useState<string | null>(
    loaded.corrupted ? '保存された道場のデータを読み込めませんでした。元のデータは別に残し、最初から始めます。' : null,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDialogElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The dojo's own unfinished games (the CPU game's list never has them).
  // The dojo plays one game at a time: the latest unfinished one is offered (older ones, from before, too are dropped on a new start).
  const [resume] = useState(() => savedGames('dojo').find((g) => g.round && !g.round.over) ?? null);

  useEffect(() => {
    document.title = 'mhj-dojo - 道場';
    // Follows the progress another tab has stored.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) setProgress(loadProgress().progress);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // The theme and the back chosen show on the settings' sample tiles (and in the dojo's games).
  useEffect(() => {
    applyTileTheme(TILE_THEMES.find((t) => t.item === progress.activeTheme)?.id ?? 'default');
    applyTileBack(TILE_BACKS.find((t) => t.item === progress.activeBack)?.id ?? 'default');
    return () => {
      applyTileTheme('default');
      applyTileBack('default');
    };
  }, [progress.activeTheme, progress.activeBack]);

  function openSettings() {
    settingsRef.current?.showModal();
    setSettingsOpen(true);
  }

  // Another tab may have changed the progress (paid a game): apply to what is stored now.
  function change(apply: (current: DojoProgress) => DojoProgress) {
    const cur = loadProgress().progress;
    const next = apply(cur);
    setProgress(next);
    if (next !== cur && !saveProgress(next)) setNotice('道場のデータを保存できませんでした（ブラウザの保存領域を確認してください）。');
  }

  function download() {
    const url = URL.createObjectURL(new Blob([exportProgress(progress)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mhj-dojo-progress.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const next = parseProgress(await file.text());
    if (!next) {
      setNotice('読み込めないファイルです。書き出した道場のデータを選んでください。');
      return;
    }
    if (!window.confirm('今の道場のデータを、読み込んだデータで置き換えますか？')) return;
    change((cur) => importProgress(cur, next));
    setNotice('道場のデータを読み込みました。');
  }

  const lv = level(progress.xp);
  const next = xpForLevel(lv + 1);
  const bar = Math.round(levelProgress(progress.xp) * 100);

  return (
    <div class="dojo-home">
      <header class="app-header">
        <h1>
          mhj-dojo <span class="app-subtitle">道場</span>
          <a class="mode-link" href="?">練習へ</a>
          <a class="mode-link" href="?mode=game">CPU対戦へ</a>
        </h1>
        <div class="header-meta">
          <button type="button" class="dojo-settings-button" aria-haspopup="dialog" onClick={openSettings}>
            設定
          </button>
          <VersionTag />
        </div>
      </header>

      {notice && !settingsOpen && (
        <p class="dojo-notice" role="status">
          {notice}
        </p>
      )}

      <section class="dojo-panel" aria-labelledby="dojo-status-heading">
        <h2 id="dojo-status-heading">修行の記録</h2>
        <div class="dojo-status">
          <span class="dojo-level" data-testid="dojo-level">Lv {lv}</span>
          <div
            class="dojo-xpbar"
            role="progressbar"
            aria-label="次のレベルまでの経験値"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={bar}
          >
            <div style={{ width: `${bar}%` }} />
          </div>
          <small class="dojo-muted" data-testid="dojo-xp" title="経験値">
            {progress.xp} / {next}
          </small>
          <span class="dojo-coin-count">
            <span class="dojo-coins" data-testid="dojo-coins">{progress.coins}</span> 雀銭
          </span>
        </div>
        <div class="dojo-play">
          {resume ? (
            <>
              <a class="dojo-start" href={`?mode=dojo&game=${encodeURIComponent(resume.id)}`}>
                続きから（{resume.round ? roundName(resume.round.wind, resume.round.number, resume.round.honba) : '対局'}）
              </a>
              <a class="dojo-restart" href={playHref()} title="中断中の対局は破棄され、報酬はもらえません" onClick={discardUnfinishedDojoGames}>
                新しく始める
              </a>
            </>
          ) : (
            <a class="dojo-start" href={playHref()} title="東風戦、CPU は弱い">
              対局開始
            </a>
          )}
        </div>
      </section>

      <section class="dojo-panel" aria-labelledby="dojo-yaku-heading">
        <h2 id="dojo-yaku-heading">所持役</h2>
        <ul class="dojo-yaku" data-testid="dojo-yaku">
          {progress.ownedYaku.map((k) => (
            <li key={k}>{yakuName(k)}</li>
          ))}
        </ul>
      </section>

      <Shop progress={progress} onChange={change} />

      {/* Esc (the dialog's cancel) and 閉じる close it; showModal makes the page behind inert. */}
      <dialog ref={settingsRef} class="dojo-settings" aria-labelledby="dojo-settings-heading" onClose={() => setSettingsOpen(false)}>
        <div class="dojo-settings-head">
          <h2 id="dojo-settings-heading">設定</h2>
          <button type="button" onClick={() => settingsRef.current?.close()}>
            閉じる
          </button>
        </div>
        {notice && settingsOpen && (
          <p class="dojo-notice" role="status">
            {notice}
          </p>
        )}
        <fieldset class="dojo-settings-group">
          <legend>牌テーマ</legend>
          {TILE_THEMES.filter((t) => t.item === null || progress.ownedItems.includes(t.item)).map((t) => (
            <label key={t.id}>
              <input
                type="radio"
                name="dojo-theme"
                checked={(t.item ?? 'default') === progress.activeTheme}
                onChange={() => change((cur) => setTheme(cur, t.item ?? 'default'))}
              />
              {t.label}
            </label>
          ))}
        </fieldset>
        <fieldset class="dojo-settings-group">
          <legend>裏柄</legend>
          {TILE_BACKS.filter((t) => t.item === null || progress.ownedItems.includes(t.item)).map((t) => (
            <label key={t.id}>
              <input
                type="radio"
                name="dojo-back"
                checked={(t.item ?? 'default') === progress.activeBack}
                onChange={() => change((cur) => setBack(cur, t.item ?? 'default'))}
              />
              {t.label}
            </label>
          ))}
        </fieldset>
        <div class="dojo-settings-sample" aria-label="見本">
          <Tile tile="5m" size="sm" />
          <Tile tile="5p" size="sm" />
          <Tile tile="5s" size="sm" />
          <Tile tile="7z" size="sm" />
          <Tile tile="" size="sm" faceDown />
        </div>
        <h3>データの書き出しと読み込み</h3>
        <p class="dojo-muted">道場のデータはこのブラウザにだけ保存されます。バックアップや引っ越しに使えます。</p>
        <div class="dojo-actions">
          <button type="button" onClick={download}>書き出す</button>
          <button type="button" onClick={() => fileRef.current?.click()}>読み込む</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={upload} />
        </div>
      </dialog>
    </div>
  );
}
