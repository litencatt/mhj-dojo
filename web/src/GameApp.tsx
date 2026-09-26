import { useEffect, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { ActionType, GameOptions, GameState, Tile as TileT } from './api';
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
import { Help } from './components/Help';
import { VersionTag } from './components/VersionTag';
import { PANELS, focusGlossary, optionalInt, useMinimized, type PanelKey } from './panels';
import { gameMovedOn, useLastAnalysis, usePlayback, useRowNames, useSerialRequest, useUrlResume } from './hooks';

// Game mode has no branch tree: the round only moves forward.
const GAME_PANELS = PANELS.filter((p) => p.key !== 'tree' && p.key !== 'advice');

const DEALER_NAMES = { random: 'ランダム', you: '自分' } as const;
const CPU_NAMES = { weak: '弱い', normal: '普通' } as const;

/** The game options in the URL (or a form), unknown values as the defaults. */
function parseOptions(get: (key: string) => string | null): GameOptions {
  return {
    length: get('length') === 'hanchan' ? 'hanchan' : 'tonpuu',
    first_dealer: get('first_dealer') === 'you' ? 'you' : 'random',
    cpu: get('cpu') === 'weak' ? 'weak' : 'normal',
  };
}

function urlOptions(): GameOptions {
  const params = new URLSearchParams(location.search);
  return parseOptions((k) => params.get(k));
}

/** A closed-hand 東風戦 or 半荘戦 against three CPU players (?mode=game). */
export function GameApp() {
  const [state, setState] = useState<GameState | null>(null);
  const [previewTile, setPreviewTile] = useState<string | null>(null);
  const [riichiMode, setRiichiMode] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const [optionsInput, setOptionsInput] = useState<GameOptions>(urlOptions);
  const { minimized, isMin, minimize, restore } = useMinimized();
  // The first state may be a resumed game: its options fill the selects.
  const optionsSynced = useRef(false);
  const { busy, error, notice, request } = useSerialRequest<GameState>(
    (next) => {
      if (!optionsSynced.current) {
        optionsSynced.current = true;
        setOptionsInput({ length: next.length, first_dealer: next.first_dealer_mode, cpu: next.cpu });
      }
      setState(next);
      setPreviewTile(null);
      setRiichiMode(false);
    },
    state ? () => api.getGame(state.game_id) : undefined,
    gameMovedOn,
  );

  function startGame(options: GameOptions, seed?: number) {
    return request(() => api.createGame({ seed, ...options }));
  }

  // One select of the new-game form changed.
  function setOption(key: keyof GameOptions) {
    return (e: Event) => {
      const value = (e.target as HTMLSelectElement).value;
      setOptionsInput((o) => ({ ...o, [key]: value }));
    };
  }

  // The URL carries ?mode=game&game=&seed=&length=&first_dealer=&cpu= so a
  // reload resumes the game, or deals the same seed and options again after
  // a server restart.
  useUrlResume({
    idKey: 'game',
    request,
    get: api.getGame,
    create: (params) =>
      api.createGame({ seed: optionalInt(params.get('seed')), ...parseOptions((k) => params.get(k)) }),
    // A random seed is hidden until the end: drop any seed of a previous game.
    sync: state && {
      mode: 'game',
      game: state.game_id,
      seed: state.seed !== null ? String(state.seed) : null,
      length: state.length,
      first_dealer: state.first_dealer_mode,
      cpu: state.cpu,
    },
  });

  useEffect(() => {
    document.title = 'mhj-dojo - CPU対戦';
  }, []);

  function act(type: ActionType, tile?: TileT, tiles?: TileT[]) {
    if (!state) return;
    void request(() => api.gameAction(state.game_id, type, tile, tiles));
  }

  function handleNewGame(e: Event) {
    e.preventDefault();
    void startGame(optionsInput, seedInput.trim() === '' ? undefined : Number(seedInput));
  }

  // After a call the analysis is empty; the chart keeps the rows from before.
  const chartAnalysis = useLastAnalysis(state?.analysis);
  const rowNames = useRowNames(chartAnalysis);

  // Replays state.events (issue #29) before the player can act again or the
  // round result appears.
  const playback = usePlayback(state);
  const actionAreaRef = useRef<HTMLDivElement>(null);
  const wasPlaying = useRef(false);

  // Once the replay ends (naturally or via スキップ) the action bar it was
  // standing in for swaps back in, unmounting the スキップ button: without
  // this the focus that was on it would drop to <body>. Move it into
  // whatever now controls the turn instead - but only if focus was already
  // in here (or nowhere in particular), so it never steals focus from
  // something else on the page (the yaku table, the seed field, ...).
  useEffect(() => {
    if (wasPlaying.current && !playback.playing) {
      const area = actionAreaRef.current;
      const active = document.activeElement;
      if (area && (active === document.body || area.contains(active))) {
        const next = area.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]');
        (next ?? area).focus();
      }
    }
    wasPlaying.current = playback.playing;
  }, [playback.playing]);

  const me = state?.seats[state.you];
  const myTurn = !!state && state.phase === 'discard' && state.actor === state.you && !playback.playing;
  // The tree and advice may be minimized from practice mode, but game mode has neither.
  const docked = GAME_PANELS.filter((p) => minimized.includes(p.key));
  const appClass = state && docked.length > 0 ? 'app has-dock' : 'app';

  return (
    <div class={appClass}>
      <div class="area-main">
        <div class="area-header">
          <header class="app-header">
            <h1>
              mhj-dojo <span class="app-subtitle">CPU対戦</span>
              <a class="mode-link" href="?">練習へ</a>
            </h1>
            <div class="header-meta">
              <VersionTag />
              <Help
                onShowGlossary={() => {
                  restore('gloss');
                  focusGlossary();
                }}
              />
            </div>
            <form class="new-game-form" onSubmit={handleNewGame}>
              <label>
                対局
                <select value={optionsInput.length} onChange={setOption('length')}>
                  <option value="tonpuu">{LENGTH_NAMES.tonpuu}</option>
                  <option value="hanchan">{LENGTH_NAMES.hanchan}</option>
                </select>
              </label>
              <label>
                起家
                <select value={optionsInput.first_dealer} onChange={setOption('first_dealer')}>
                  <option value="random">{DEALER_NAMES.random}</option>
                  <option value="you">{DEALER_NAMES.you}</option>
                </select>
              </label>
              <label>
                CPU
                <select value={optionsInput.cpu} onChange={setOption('cpu')}>
                  <option value="weak">{CPU_NAMES.weak}</option>
                  <option value="normal">{CPU_NAMES.normal}</option>
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
              <div class="header-status">
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
                    <dt>CPU</dt>
                    <dd>{CPU_NAMES[state.cpu]}</dd>
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
                </dl>
                <DoraStatus
                  doraIndicators={state.dora_indicators}
                  dora={state.dora}
                  uraDoraIndicators={state.ura_dora_indicators}
                  uraDora={state.ura_dora}
                />
              </div>
            )}
          </header>
          {error && (
            <div class="error-banner" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div class="notice-banner" role="status">
              {notice}
            </div>
          )}
          {!state && !error && <p class="muted">対局を準備しています…</p>}
        </div>
        {state && me && (
          <>
            <div class="area-hand">
              <GameTable
                state={state}
                seats={playback.seats}
                events={playback.events}
                highlight={playback.highlight}
                playing={playback.playing}
              />
              <Hand
                hand={me.hand ?? []}
                groups={me.hand_groups}
                drawn={me.drawn ?? null}
                discards={[]}
                disabled={busy || !myTurn}
                allowed={riichiMode ? state.legal.riichi : state.legal.discards}
                onlyDrawn={me.riichi}
                melds={<Melds melds={me.melds} owner={state.you} size="sm" />}
                onDiscard={(t) => act(riichiMode ? 'riichi' : 'discard', t)}
                onPreview={setPreviewTile}
              />
              {/* Persistent (not conditionally mounted) so a screen reader
                  reliably announces the text change either way. */}
              <p class="visually-hidden" role="status" aria-live="polite">
                {playback.playing ? 'CPUの動きを再生中…' : ''}
              </p>
              <div ref={actionAreaRef} class="action-area" tabIndex={-1}>
                {playback.playing ? (
                  <div class="action-bar action-bar-playback">
                    <span class="action-hint" aria-hidden="true">
                      CPUの動きを再生中…
                    </span>
                    <button type="button" onClick={playback.skip}>
                      スキップ
                    </button>
                  </div>
                ) : (
                  <ActionBar
                    state={state}
                    busy={busy}
                    myTurn={myTurn}
                    riichiMode={riichiMode}
                    onRiichiMode={setRiichiMode}
                    onAction={act}
                  />
                )}
              </div>
              {!playback.playing && state.result && (
                <ResultPanel state={state} result={state.result} busy={busy} onNext={() => act('next')} />
              )}
              {!playback.playing && state.game_over && (
                <FinalPanel state={state} busy={busy} onNewGame={() =>
                    void startGame({ length: state.length, first_dealer: state.first_dealer_mode, cpu: state.cpu })
                  } />
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
          combos={state.combos}
          combosByDiscard={state.combos_by_discard}
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
        {riichiMode ? (
          <span>
            リーチ宣言牌を<ClickOrTap />（聴牌が残る牌だけ選べます）
          </span>
        ) : state.seats[state.you].riichi ? (
          'リーチ中：和了るかツモ切り'
        ) : (
          <span>
            捨てる牌を<ClickOrTap />
          </span>
        )}
      </span>
    </div>
  );
}

/** 「クリック」, or on a touch screen 「タップ（もう一度で打牌）」: a tap
 * first selects a tile and a second tap discards it (components/Hand.tsx). */
function ClickOrTap() {
  return (
    <>
      <span class="hint-mouse">クリック</span>
      <span class="hint-touch">タップ（もう一度タップで打牌）</span>
    </>
  );
}
