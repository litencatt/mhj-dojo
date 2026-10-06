import { useEffect, useRef, useState } from 'preact/hooks';
import { VersionTag } from '../components/VersionTag';
import { yakuName } from './catalog';
import {
  exportProgress,
  level,
  levelProgress,
  loadProgress,
  parseProgress,
  saveProgress,
  STORAGE_KEY,
  xpForLevel,
  type DojoProgress,
} from './progress';
import { roundName } from '../components/GameTable';
import { savedGames } from '../wasm';
import { Shop } from './Shop';
import './dojo.css';

/** ?mode=dojo&play=1[&seed=]: the page that starts a dojo game (the seed of this page's URL kept). */
function playHref(): string {
  const params = new URLSearchParams({ mode: 'dojo', play: '1' });
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed) params.set('seed', seed);
  return `?${params}`;
}

/** The dojo hub (?mode=dojo): level, coins, the yaku owned, the shop and the backup. */
export function DojoHome() {
  const [loaded] = useState(() => loadProgress());
  const [progress, setProgress] = useState<DojoProgress>(loaded.progress);
  const [notice, setNotice] = useState<string | null>(
    loaded.corrupted ? '保存された道場のデータを読み込めませんでした。元のデータは別に残し、最初から始めます。' : null,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  // The dojo's own unfinished games (the CPU game's list never has them).
  const [resumable] = useState(() => savedGames('dojo').filter((g) => g.round && !g.round.over));

  useEffect(() => {
    document.title = 'mhj-dojo - 道場';
    // Follows the progress another tab has stored.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) setProgress(loadProgress().progress);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

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
    change(() => next);
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
          <VersionTag />
        </div>
      </header>

      {notice && (
        <p class="dojo-notice" role="status">
          {notice}
        </p>
      )}

      <section class="dojo-panel" aria-labelledby="dojo-status-heading">
        <h2 id="dojo-status-heading">修行の記録</h2>
        <div class="dojo-status">
          <div>
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
            <small class="dojo-muted" data-testid="dojo-xp">
              経験値 {progress.xp} / {next}
            </small>
          </div>
          <div>
            <span class="dojo-coins" data-testid="dojo-coins">{progress.coins}</span> コイン
          </div>
          <a class="dojo-start" href={playHref()}>
            対局開始
          </a>
        </div>
        {resumable.length > 0 && (
          <ul class="dojo-resume" aria-label="続きから">
            {resumable.map((g) => (
              <li key={g.id}>
                <a href={`?mode=dojo&game=${encodeURIComponent(g.id)}`}>
                  続きから{g.round && `（${roundName(g.round.wind, g.round.number, g.round.honba)}）`}
                </a>
              </li>
            ))}
          </ul>
        )}
        <p class="dojo-muted">東風戦、CPU は弱い。使える役は下の所持役だけで、持たない役は翻に数えません。</p>
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

      <section class="dojo-panel" aria-labelledby="dojo-backup-heading">
        <h2 id="dojo-backup-heading">データの書き出しと読み込み</h2>
        <p class="dojo-muted">道場のデータはこのブラウザにだけ保存されます。バックアップや引っ越しに使えます。</p>
        <div class="dojo-actions">
          <button type="button" onClick={download}>書き出す</button>
          <button type="button" onClick={() => fileRef.current?.click()}>読み込む</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={upload} />
        </div>
      </section>
    </div>
  );
}
