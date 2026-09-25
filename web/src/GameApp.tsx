import { useEffect, useState } from 'preact/hooks';
import * as api from './api';
import type { ActionType, GameState } from './api';
import { Hand } from './components/Hand';
import { ShantenChart } from './components/ShantenChart';
import { Dock } from './components/Dock';
import { Tile } from './components/Tile';
import { DoraStatus } from './components/DoraStatus';
import { SidePanels } from './components/SidePanels';
import { GameTable, WIND_NAMES } from './components/GameTable';
import { ResultPanel } from './components/ResultPanel';
import { PANELS, optionalInt, useMinimized, type PanelKey } from './panels';
import { useRowNames, useSerialRequest, useUrlResume } from './hooks';

// Game mode has no branch tree: the round only moves forward.
const GAME_PANELS = PANELS.filter((p) => p.key !== 'tree');

/** A closed-hand East round against three CPU players (?mode=game). */
export function GameApp() {
  const [state, setState] = useState<GameState | null>(null);
  const [previewTile, setPreviewTile] = useState<string | null>(null);
  const [riichiMode, setRiichiMode] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const { minimized, isMin, minimize, restore } = useMinimized();
  const { busy, error, request } = useSerialRequest<GameState>((next) => {
    setState(next);
    setPreviewTile(null);
    setRiichiMode(false);
  });

  function startGame(seed?: number) {
    return request(() => api.createGame({ seed }));
  }

  // The URL carries ?mode=game&game=&seed= so a reload resumes the game, or
  // deals the same seed again after a server restart.
  useUrlResume({
    idKey: 'game',
    request,
    get: api.getGame,
    create: (params) => api.createGame({ seed: optionalInt(params.get('seed')) }),
    // A random seed is hidden until the end: drop any seed of a previous game.
    sync: state && { mode: 'game', game: state.game_id, seed: state.seed !== null ? String(state.seed) : null },
  });

  useEffect(() => {
    document.title = 'mhj2 - CPU対戦';
  }, []);

  function act(type: ActionType, tile?: string) {
    if (!state) return;
    void request(() => api.gameAction(state.game_id, type, tile));
  }

  function handleNewGame(e: Event) {
    e.preventDefault();
    void startGame(seedInput.trim() === '' ? undefined : Number(seedInput));
  }

  const rowNames = useRowNames(state?.analysis);

  const me = state?.seats[state.you];
  const myTurn = !!state && state.phase === 'discard' && state.actor === state.you;
  // The tree may be minimized from practice mode, but game mode has no tree tab.
  const docked = GAME_PANELS.filter((p) => minimized.includes(p.key));
  const appClass = state && docked.length > 0 ? 'app has-dock' : 'app';

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
                <DoraStatus
                  doraIndicators={state.dora_indicators}
                  dora={state.dora}
                  uraDoraIndicators={state.ura_dora_indicators}
                  uraDora={state.ura_dora}
                />
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
                onlyDrawn={me.riichi}
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
        <SidePanels
          analysis={state.analysis}
          byDiscard={state.by_discard}
          previewTile={previewTile}
          mode="game"
          isMin={isMin}
          onMinimize={minimize}
        />
      )}
      {state && (
        <Dock
          items={docked}
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
