import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { State } from './api';
import { Hand } from './components/Hand';
import { YakuTable } from './components/YakuTable';
import { ShantenChart } from './components/ShantenChart';
import { HistoryTree } from './components/HistoryTree';
import { WinPanel } from './components/WinPanel';
import { Glossary } from './components/Glossary';
import { Tile } from './components/Tile';

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function optionalInt(s: string | null): number | undefined {
  if (s === null || !/^-?\d+$/.test(s)) return undefined;
  return Number(s);
}

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewTile, setPreviewTile] = useState<string | null>(null);
  const [seedInput, setSeedInput] = useState('');
  const [maxTurnsInput, setMaxTurnsInput] = useState('18');
  const [busy, setBusy] = useState(false);
  // Discard/tsumo act on the server's current node, so requests must never overlap:
  // a concurrent goto could redirect a discard, and responses could land out of order.
  const inFlight = useRef(false);

  async function request(fn: () => Promise<State>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      setState(next);
      setPreviewTile(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function startGame(seed?: number, maxTurns?: number) {
    return request(() => api.createSession({ seed, max_turns: maxTurns ?? 18 }));
  }

  // The URL carries ?session=&seed=&turns= so a reload resumes the game. Sessions
  // live only in server memory, so after a server restart the same wall is
  // replayed from the seed instead.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('session');
    const seed = optionalInt(params.get('seed'));
    const turns = optionalInt(params.get('turns')) ?? 18;
    if (!id) {
      void startGame(seed, turns);
      return;
    }
    void request(async () => {
      try {
        return await api.getSession(id);
      } catch (err) {
        if (err instanceof api.ApiError && err.status === 404) {
          return api.createSession({ seed, max_turns: turns });
        }
        throw err;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state) return;
    const url = new URL(location.href);
    url.searchParams.set('session', state.session_id);
    url.searchParams.set('seed', String(state.seed));
    url.searchParams.set('turns', String(state.max_turns));
    history.replaceState(null, '', url);
  }, [state?.session_id]);

  function handleNewGame(e: Event) {
    e.preventDefault();
    const seed = seedInput.trim() === '' ? undefined : Number(seedInput);
    const maxTurns = maxTurnsInput.trim() === '' ? 18 : Number(maxTurnsInput);
    void startGame(seed, maxTurns);
  }

  function handleDiscard(tile: string) {
    if (!state) return;
    void request(() => api.discard(state.session_id, tile));
  }

  function handleTsumo() {
    if (!state) return;
    void request(() => api.tsumo(state.session_id));
  }

  function handleGoto(nodeId: number) {
    if (!state) return;
    void request(() => api.goto(state.session_id, nodeId));
  }

  const rowNames = useMemo(() => {
    const map: Record<string, string> = {};
    if (state) for (const r of state.analysis) map[r.key] = r.name;
    return map;
  }, [state?.analysis]);

  const displayedRows = state ? (previewTile ? (state.by_discard[previewTile] ?? state.analysis) : state.analysis) : [];
  const baselineRows = previewTile && state ? state.analysis : null;

  return (
    <div class={state ? 'app' : 'app app-loading'}>
      <div class="area-main">
        <div class="area-header">
          <header class="app-header">
            <h1>mhj2 <span class="app-subtitle">麻雀練習</span></h1>
            <form class="new-game-form" onSubmit={handleNewGame}>
              <label>
                シード
                <input
                  type="number"
                  value={seedInput}
                  placeholder="ランダム"
                  onInput={(e) => setSeedInput((e.target as HTMLInputElement).value)}
                />
              </label>
              <label>
                最大巡目
                <input
                  type="number"
                  class="input-narrow"
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
        </div>
        {state && (
          <>
            <div class="area-hand">
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
            </div>
            <div class="area-chart">
              <ShantenChart
                sessionId={state.session_id}
                history={state.history}
                currentAnalysis={state.analysis}
                rowNames={rowNames}
              />
            </div>
          </>
        )}
      </div>
      {state && (
        <div class="area-tree">
          <HistoryTree tree={state.tree} currentNodeId={state.node_id} disabled={busy} onGoto={handleGoto} />
        </div>
      )}
      {state && (
        <div class="area-side">
          <div class="area-yaku">
            <YakuTable rows={displayedRows} baseline={baselineRows} previewTile={previewTile} />
          </div>
          <div class="area-gloss">
            <Glossary />
          </div>
        </div>
      )}
    </div>
  );
}
