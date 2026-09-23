import { useEffect, useMemo, useState } from 'preact/hooks';
import * as client from './client';
import type { State } from './client';
import { Hand } from './components/Hand';
import { YakuTable } from './components/YakuTable';
import { ShantenChart } from './components/ShantenChart';
import { HistoryTree } from './components/HistoryTree';
import { WinPanel } from './components/WinPanel';
import { Tile } from './components/Tile';

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewTile, setPreviewTile] = useState<string | null>(null);
  const [seedInput, setSeedInput] = useState('');
  const [maxTurnsInput, setMaxTurnsInput] = useState('18');
  const [busy, setBusy] = useState(false);

  async function startGame(seed?: number, maxTurns?: number) {
    setBusy(true);
    setError(null);
    try {
      const s = await client.createSession({ seed, max_turns: maxTurns ?? 18 });
      setState(s);
      setPreviewTile(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void startGame(undefined, 18);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleNewGame(e: Event) {
    e.preventDefault();
    const seed = seedInput.trim() === '' ? undefined : Number(seedInput);
    const maxTurns = maxTurnsInput.trim() === '' ? 18 : Number(maxTurnsInput);
    void startGame(seed, maxTurns);
  }

  async function runAction(fn: () => Promise<State>) {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      setState(next);
      setPreviewTile(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleDiscard(tile: string) {
    if (!state) return;
    void runAction(() => client.discard(state.session_id, tile));
  }

  function handleTsumo() {
    if (!state) return;
    void runAction(() => client.tsumo(state.session_id));
  }

  function handleGoto(nodeId: number) {
    if (!state) return;
    void runAction(() => client.goto(state.session_id, nodeId));
  }

  const rowNames = useMemo(() => {
    const map: Record<string, string> = {};
    if (state) for (const r of state.analysis) map[r.key] = r.name;
    return map;
  }, [state?.analysis]);

  const displayedRows = state ? (previewTile ? (state.by_discard[previewTile] ?? state.analysis) : state.analysis) : [];
  const baselineRows = previewTile && state ? state.analysis : null;

  return (
    <div class="app">
      <header class="app-header">
        <h1>mhj2 <span class="app-subtitle">麻雀練習</span></h1>
        <form class="new-game-form" onSubmit={handleNewGame}>
          <label>
            シード
            <input
              type="number"
              value={seedInput}
              placeholder="未指定でランダム"
              onInput={(e) => setSeedInput((e.target as HTMLInputElement).value)}
            />
          </label>
          <label>
            最大巡目
            <input
              type="number"
              min={1}
              value={maxTurnsInput}
              onInput={(e) => setMaxTurnsInput((e.target as HTMLInputElement).value)}
            />
          </label>
          <button type="submit" disabled={busy}>新規対局</button>
        </form>
        {state && (
          <dl class="game-status">
            <div>
              <dt>シード</dt>
              <dd>{state.seed}</dd>
            </div>
            <div>
              <dt>巡目</dt>
              <dd>{state.turn} / {state.max_turns}</dd>
            </div>
            <div>
              <dt>残り牌</dt>
              <dd>{state.wall_remaining}</dd>
            </div>
            <div>
              <dt>ドラ表示牌</dt>
              <dd class="dora-indicators">
                {state.dora_indicators.map((t, i) => (
                  <Tile key={`${t}-${i}`} tile={t} size="sm" />
                ))}
              </dd>
            </div>
          </dl>
        )}
      </header>

      {error && (
        <div class="error-banner" role="alert">
          {error}
        </div>
      )}

      {!state && !error && <p class="muted">対局を準備しています…</p>}

      {state && (
        <main class="app-main">
          <div class="column-left">
            <Hand
              hand={state.hand}
              drawn={state.drawn}
              discards={state.discards}
              disabled={busy || state.status !== 'playing'}
              onDiscard={handleDiscard}
              onPreview={setPreviewTile}
            />
            {state.status === 'playing' && state.can_tsumo && (
              <button type="button" class="tsumo-button" onClick={handleTsumo} disabled={busy}>
                ツモ
              </button>
            )}
            {state.status === 'exhausted' && <p class="exhausted-banner">流局（{state.max_turns}巡終了）</p>}
            {state.status === 'tsumo' && state.win && <WinPanel win={state.win} />}
            <YakuTable rows={displayedRows} baseline={baselineRows} previewTile={previewTile} />
          </div>
          <div class="column-right">
            <ShantenChart
              sessionId={state.session_id}
              history={state.history}
              currentAnalysis={state.analysis}
              rowNames={rowNames}
            />
            <HistoryTree tree={state.tree} currentNodeId={state.node_id} onGoto={handleGoto} />
          </div>
        </main>
      )}
    </div>
  );
}
