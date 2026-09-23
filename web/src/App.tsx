import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { State } from './api';
import { Hand } from './components/Hand';
import { YakuTable } from './components/YakuTable';
import { ShantenChart } from './components/ShantenChart';
import { HistoryTree } from './components/HistoryTree';
import { WinPanel } from './components/WinPanel';
import { Glossary } from './components/Glossary';
import { Dock } from './components/Dock';
import { Tile } from './components/Tile';

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Panels that can be minimized into the right-edge dock.
type PanelKey = 'chart' | 'tree' | 'yaku' | 'gloss';
const PANELS: Array<{ key: PanelKey; label: string }> = [
  { key: 'chart', label: '時系列チャート' },
  { key: 'tree', label: '履歴ツリー' },
  { key: 'yaku', label: '役別向聴' },
  { key: 'gloss', label: '用語表' },
];
const MINIMIZED_KEY = 'mhj2.minimized';

function loadMinimized(): PanelKey[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(MINIMIZED_KEY) ?? '[]');
    return Array.isArray(v) ? PANELS.map((p) => p.key).filter((k) => v.includes(k)) : [];
  } catch {
    return [];
  }
}

function saveMinimized(keys: PanelKey[]) {
  try {
    localStorage.setItem(MINIMIZED_KEY, JSON.stringify(keys));
  } catch {
    // Storage unavailable: the layout just won't persist.
  }
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
  const [minimized, setMinimized] = useState<PanelKey[]>(loadMinimized);
  const minimize = (k: PanelKey) => {
    const next = [...minimized.filter((x) => x !== k), k];
    setMinimized(next);
    saveMinimized(next);
  };
  const restore = (k: PanelKey) => {
    const next = minimized.filter((x) => x !== k);
    setMinimized(next);
    saveMinimized(next);
  };
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

  // Minimized panels stay mounted (hidden) so they keep their own state,
  // such as the chart's legend selection and the glossary search.
  const isMin = (k: PanelKey) => minimized.includes(k);
  const appClass = state && minimized.length > 0 ? 'app has-dock' : 'app';

  return (
    <div class={appClass}>
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
                    <span class="dora-arrow" aria-hidden="true">→</span>
                    <span class="dora-label">ドラ</span>
                    {state.dora.map((t, i) => (
                      <Tile key={`d-${t}-${i}`} tile={t} size="sm" label={`ドラ ${t}`} />
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>裏ドラ表示牌</dt>
                  <dd class="dora-indicators">
                    {state.ura_dora_indicators.length > 0 ? (
                      <>
                        {state.ura_dora_indicators.map((t, i) => (
                          <Tile key={`u-${t}-${i}`} tile={t} size="sm" />
                        ))}
                        <span class="dora-arrow" aria-hidden="true">→</span>
                        <span class="dora-label">裏ドラ</span>
                        {state.ura_dora.map((t, i) => (
                          <Tile key={`ud-${t}-${i}`} tile={t} size="sm" label={`裏ドラ ${t}`} />
                        ))}
                      </>
                    ) : (
                      // Hidden until the game ends: one face-down tile per indicator.
                      state.dora_indicators.map((_, i) => <Tile key={`ub-${i}`} tile="" size="sm" faceDown />)
                    )}
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
            <div class="area-chart" hidden={isMin('chart')}>
              <ShantenChart
                sessionId={state.session_id}
                history={state.history}
                currentAnalysis={state.analysis}
                rowNames={rowNames}
                onMinimize={() => minimize('chart')}
              />
            </div>
          </>
        )}
      </div>
      {state && (
        <div class="area-tree" hidden={isMin('tree')}>
          <HistoryTree
            tree={state.tree}
            currentNodeId={state.node_id}
            disabled={busy}
            onGoto={handleGoto}
            onMinimize={() => minimize('tree')}
          />
        </div>
      )}
      {state && (
        <div class="area-side" hidden={isMin('yaku') && isMin('gloss')}>
          <div class="area-yaku" hidden={isMin('yaku')}>
            <YakuTable
              rows={displayedRows}
              baseline={baselineRows}
              previewTile={previewTile}
              onMinimize={() => minimize('yaku')}
            />
          </div>
          <div class="area-gloss" hidden={isMin('gloss')}>
            <Glossary onMinimize={() => minimize('gloss')} />
          </div>
        </div>
      )}
      {state && (
        <Dock
          items={PANELS.filter((p) => minimized.includes(p.key))}
          onRestore={(k) => restore(k as PanelKey)}
        />
      )}
    </div>
  );
}
