import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { ActionType, GameState } from './api';
import { Hand } from './components/Hand';
import { YakuTable } from './components/YakuTable';
import { ShantenChart } from './components/ShantenChart';
import { Glossary } from './components/Glossary';
import { Dock } from './components/Dock';
import { Tile } from './components/Tile';
import { GameTable, WIND_NAMES } from './components/GameTable';
import { ResultPanel } from './components/ResultPanel';
import { PANELS, errorMessage, optionalInt, useMinimized, type PanelKey } from './panels';

// Game mode has no branch tree: the round only moves forward.
const GAME_PANELS = PANELS.filter((p) => p.key !== 'tree');

/** A closed-hand East round against three CPU players (?mode=game). */
export function GameApp() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewTile, setPreviewTile] = useState<string | null>(null);
  const [riichiMode, setRiichiMode] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const [busy, setBusy] = useState(false);
  const { minimized, isMin, minimize, restore } = useMinimized();
  // Every action changes the round, so requests must never overlap.
  const inFlight = useRef(false);

  async function request(fn: () => Promise<GameState>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      setState(await fn());
      setPreviewTile(null);
      setRiichiMode(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function startGame(seed?: number) {
    return request(() => api.createGame({ seed }));
  }

  // The URL carries ?mode=game&game=&seed= so a reload resumes the game. Games
  // live only in server memory; after a restart the same seed deals again.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get('game');
    const seed = optionalInt(params.get('seed'));
    if (!id) {
      void startGame(seed);
      return;
    }
    void request(async () => {
      try {
        return await api.getGame(id);
      } catch (err) {
        if (err instanceof api.ApiError && err.status === 404) return api.createGame({ seed });
        throw err;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state) return;
    const url = new URL(location.href);
    url.searchParams.set('mode', 'game');
    url.searchParams.set('game', state.game_id);
    if (state.seed !== null) url.searchParams.set('seed', String(state.seed));
    history.replaceState(null, '', url);
  }, [state?.game_id, state?.seed]);

  function act(type: ActionType, tile?: string) {
    if (!state) return;
    void request(() => api.gameAction(state.game_id, type, tile));
  }

  function handleNewGame(e: Event) {
    e.preventDefault();
    void startGame(seedInput.trim() === '' ? undefined : Number(seedInput));
  }

  const rowNames = useMemo(() => {
    const map: Record<string, string> = {};
    if (state) for (const r of state.analysis) map[r.key] = r.name;
    return map;
  }, [state?.analysis]);

  const me = state?.seats[state.you];
  const myTurn = !!state && state.phase === 'discard' && state.actor === state.you;
  const displayedRows = state ? (previewTile ? (state.by_discard[previewTile] ?? state.analysis) : state.analysis) : [];
  const baselineRows = previewTile && state ? state.analysis : null;
  const appClass = state && minimized.length > 0 ? 'app game-app has-dock' : 'app game-app';

  return (
    <div class={appClass}>
      <div class="area-main">
        <div class="area-header">
          <header class="app-header">
            <h1>
              mhj2 <span class="app-subtitle">CPU対戦</span>
              <a class="mode-link" href="?">練習へ</a>
            </h1>
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
              <button type="submit" disabled={busy}>新規対局</button>
            </form>
            {state && (
              <dl class="game-status">
                <div>
                  <dt>シード</dt>
                  <dd>{state.seed ?? '終局後に表示'}</dd>
                </div>
                <div>
                  <dt>自風</dt>
                  <dd>{me && WIND_NAMES[me.wind]}</dd>
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
        {state && me && (
          <>
            <div class="area-hand">
              <GameTable state={state} />
              <Hand
                hand={me.hand ?? []}
                drawn={me.drawn ?? null}
                discards={[]}
                disabled={busy || !myTurn}
                allowed={riichiMode ? state.legal.riichi : state.legal.discards}
                onDiscard={(t) => act(riichiMode ? 'riichi' : 'discard', t)}
                onPreview={setPreviewTile}
              />
              <ActionBar
                state={state}
                busy={busy}
                myTurn={myTurn}
                riichiMode={riichiMode}
                onRiichiMode={setRiichiMode}
                onAction={act}
              />
              {state.result && <ResultPanel state={state} result={state.result} />}
            </div>
            <div class="area-chart" hidden={isMin('chart')}>
              <ShantenChart
                sessionId={state.game_id}
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
          items={GAME_PANELS.filter((p) => minimized.includes(p.key))}
          onRestore={(k) => restore(k as PanelKey)}
        />
      )}
    </div>
  );
}

interface ActionBarProps {
  state: GameState;
  busy: boolean;
  myTurn: boolean;
  riichiMode: boolean;
  onRiichiMode: (on: boolean) => void;
  onAction: (type: ActionType) => void;
}

/** Your options right now: ron / skip on a discard, tsumo, riichi, or a hint. */
function ActionBar({ state, busy, myTurn, riichiMode, onRiichiMode, onAction }: ActionBarProps) {
  const { legal } = state;
  if (state.phase === 'ended') return null;
  if (legal.ron) {
    return (
      <div class="action-bar" role="group" aria-label="操作">
        <span class="action-hint">
          ロンできます
          {state.last_discard && <Tile tile={state.last_discard} size="sm" />}
        </span>
        <button type="button" class="action-primary" disabled={busy} onClick={() => onAction('ron')}>
          ロン
        </button>
        <button type="button" disabled={busy} onClick={() => onAction('skip')}>
          見逃す
        </button>
      </div>
    );
  }
  if (!myTurn) return null;
  const riichiAllowed = legal.riichi.length > 0;
  return (
    <div class="action-bar" role="group" aria-label="操作">
      {legal.tsumo && (
        <button type="button" class="action-primary" disabled={busy} onClick={() => onAction('tsumo')}>
          ツモ
        </button>
      )}
      {riichiAllowed && (
        <button
          type="button"
          class={riichiMode ? 'action-riichi active' : 'action-riichi'}
          aria-pressed={riichiMode}
          disabled={busy}
          onClick={() => onRiichiMode(!riichiMode)}
        >
          リーチ
        </button>
      )}
      <span class="action-hint">
        {riichiMode
          ? 'リーチ宣言牌をクリック（聴牌が残る牌だけ選べます）'
          : state.seats[state.you].riichi
            ? 'リーチ中：和了るかツモ切り'
            : '捨てる牌をクリック'}
      </span>
    </div>
  );
}
