import { useEffect, useState } from 'preact/hooks';
import * as api from './api';
import type { ActionType, GameLength, GameState, Tile as TileT } from './api';
import { Hand } from './components/Hand';
import { ShantenChart } from './components/ShantenChart';
import { Dock } from './components/Dock';
import { Tile } from './components/Tile';
import { DoraStatus } from './components/DoraStatus';
import { SidePanels } from './components/SidePanels';
import { GameTable, LENGTH_NAMES, WIND_NAMES, seatLabel } from './components/GameTable';
import { Melds } from './components/Melds';
import { ResultPanel } from './components/ResultPanel';
import { FinalPanel } from './components/FinalPanel';
import { PANELS, optionalInt, useMinimized, type PanelKey } from './panels';
import { useLastAnalysis, useRowNames, useSerialRequest, useUrlResume } from './hooks';

// Game mode has no branch tree: the round only moves forward.
const GAME_PANELS = PANELS.filter((p) => p.key !== 'tree');

function parseLength(s: string | null): GameLength {
  return s === 'hanchan' ? 'hanchan' : 'tonpuu';
}

/** A closed-hand 東風戦 or 半荘戦 against three CPU players (?mode=game). */
export function GameApp() {
  const [state, setState] = useState<GameState | null>(null);
  const [previewTile, setPreviewTile] = useState<string | null>(null);
  const [riichiMode, setRiichiMode] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const [lengthInput, setLengthInput] = useState<GameLength>(() =>
    parseLength(new URLSearchParams(location.search).get('length')),
  );
  const { minimized, isMin, minimize, restore } = useMinimized();
  const { busy, error, request } = useSerialRequest<GameState>((next) => {
    setState(next);
    setPreviewTile(null);
    setRiichiMode(false);
  });

  function startGame(length: GameLength, seed?: number) {
    return request(() => api.createGame({ seed, length }));
  }

  // The URL carries ?mode=game&game=&seed=&length= so a reload resumes the
  // game, or deals the same seed and length again after a server restart.
  useUrlResume({
    idKey: 'game',
    request,
    get: api.getGame,
    create: (params) =>
      api.createGame({ seed: optionalInt(params.get('seed')), length: parseLength(params.get('length')) }),
    // A random seed is hidden until the end: drop any seed of a previous game.
    sync: state && {
      mode: 'game',
      game: state.game_id,
      seed: state.seed !== null ? String(state.seed) : null,
      length: state.length,
    },
  });

  useEffect(() => {
    document.title = 'mhj2 - CPU対戦';
  }, []);

  function act(type: ActionType, tile?: TileT, tiles?: TileT[]) {
    if (!state) return;
    void request(() => api.gameAction(state.game_id, type, tile, tiles));
  }

  function handleNewGame(e: Event) {
    e.preventDefault();
    void startGame(lengthInput, seedInput.trim() === '' ? undefined : Number(seedInput));
  }

  // After a call the analysis is empty; the chart keeps the rows from before.
  const chartAnalysis = useLastAnalysis(state?.analysis);
  const rowNames = useRowNames(chartAnalysis);

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
                対局
                <select
                  value={lengthInput}
                  onChange={(e) => setLengthInput(parseLength((e.target as HTMLSelectElement).value))}
                >
                  <option value="tonpuu">{LENGTH_NAMES.tonpuu}</option>
                  <option value="hanchan">{LENGTH_NAMES.hanchan}</option>
                </select>
              </label>
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
                  <dt>対局</dt>
                  <dd>{LENGTH_NAMES[state.length]}</dd>
                </div>
                <div>
                  <dt>局</dt>
                  <dd>
                    {WIND_NAMES[state.round_wind]}
                    {state.round_number}局 {state.honba}本場
                  </dd>
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
                melds={<Melds melds={me.melds} owner={state.you} size="sm" />}
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
              {state.result && (
                <ResultPanel state={state} result={state.result} busy={busy} onNext={() => act('next')} />
              )}
              {state.game_over && (
                <FinalPanel state={state} busy={busy} onNewGame={() => void startGame(state.length)} />
              )}
            </div>
            <div class="area-chart" hidden={isMin('chart')}>
              <ShantenChart
                sessionId={state.game_id}
                history={state.history}
                currentAnalysis={chartAnalysis}
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
  onAction: (type: ActionType, tile?: TileT, tiles?: TileT[]) => void;
}

/** Your options right now: ron / pon / kan / chii / skip on a discard, or on
 * your turn tsumo, kan, riichi, 九種九牌, or a hint. */
function ActionBar({ state, busy, myTurn, riichiMode, onRiichiMode, onAction }: ActionBarProps) {
  const { legal } = state;
  if (state.phase === 'ended') return null;
  if (state.phase === 'call' && legal.skip) {
    // The claimed tile is the last move shown: a discard, or an added kan (槍槓).
    const last = state.events[state.events.length - 1];
    return (
      <div class="action-bar" role="group" aria-label="操作">
        <span class="action-hint">
          {last && `${seatLabel(last.seat, state.you)}の${last.type === 'kan' ? '加槓' : '打牌'}`}
          {state.last_discard && <Tile tile={state.last_discard} size="sm" />}
        </span>
        {legal.ron && (
          <button type="button" class="action-primary" disabled={busy} onClick={() => onAction('ron')}>
            ロン
          </button>
        )}
        {legal.pon && (
          <button type="button" disabled={busy} onClick={() => onAction('pon')}>
            ポン
          </button>
        )}
        {legal.kan.length > 0 && (
          <button type="button" disabled={busy} onClick={() => onAction('kan')}>
            カン
          </button>
        )}
        {legal.chii.map((pair) => (
          <button
            key={pair.join()}
            type="button"
            class="action-call"
            aria-label={`チー ${pair.join(' ')} + ${state.last_discard ?? ''}`}
            disabled={busy}
            onClick={() => onAction('chii', undefined, pair)}
          >
            チー
            <span class="call-tiles" aria-hidden="true">
              <Tile tile={pair[0]} size="xs" />
              <Tile tile={pair[1]} size="xs" />
              {state.last_discard && (
                <>
                  +<Tile tile={state.last_discard} size="xs" />
                </>
              )}
            </span>
          </button>
        ))}
        <button type="button" disabled={busy} onClick={() => onAction('skip')}>
          {legal.ron ? '見逃す' : 'スキップ'}
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
      {legal.kan.map((t) => (
        <button
          key={t}
          type="button"
          class="action-call"
          aria-label={`カン ${t}`}
          disabled={busy}
          onClick={() => onAction('kan', t)}
        >
          カン
          <span class="call-tiles" aria-hidden="true">
            <Tile tile={t} size="xs" />
          </span>
        </button>
      ))}
      {legal.kyuushu && (
        <button type="button" disabled={busy} onClick={() => onAction('kyuushu')}>
          九種九牌
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
