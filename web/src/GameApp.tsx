import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { ActionType, Advice, DangerLevel, GameOptions, GameState, SeatDanger, Tile as TileT } from './api';
import { AdvicePanel } from './components/AdvicePanel';
import { DANGER_NAMES, dangerLevel } from './danger';
import { Hand } from './components/Hand';
import { ShantenChart } from './components/ShantenChart';
import { Dock } from './components/Dock';
import { Tile } from './components/Tile';
import { DoraStatus } from './components/DoraStatus';
import { SidePanels } from './components/SidePanels';
import { GameTable, LENGTH_NAMES, River, SeatStatus, WIND_NAMES, roundName, seatLabel } from './components/GameTable';
import { Melds } from './components/Melds';
import { ResultPanel } from './components/ResultPanel';
import { FinalPanel } from './components/FinalPanel';
import { Help } from './components/Help';
import { EngineLoading } from './components/EngineLoading';
import { TabStopped } from './components/TabStopped';
import { VersionTag } from './components/VersionTag';
import { ResumePanel, type ResumeItem } from './components/ResumePanel';
import { ErrorBanner, SaveFailedNotice } from './components/ErrorBanner';
import { PANELS, focusGlossary, optionalInt, useGameAdvice, useMinimized, type PanelKey } from './panels';
import {
  bareUrl,
  useLastAnalysis,
  useMediaQuery,
  usePlayback,
  useRoundLog,
  useRowNames,
  useSerialRequest,
  useSingleTab,
  useUrlResume,
  useYakuTop,
} from './hooks';
import { PLAYBACK_SPEEDS, loadPlaybackSpeed, savePlaybackSpeed, type PlaybackSpeed } from './playback';
import { claim } from './singleTab';
import { tileName } from './tiles';
import { savedGames, type GameSummary } from './wasm';

// A hand the state does not give yet: one array, so the Hand's selection is
// not reset on every render.
const NO_TILES: TileT[] = [];

// Game mode has no branch tree: the round only moves forward. The advice
// is offered unless turned off in the options.
const GAME_PANELS = PANELS.filter((p) => p.key !== 'tree');
const NO_ADVICE_PANELS = GAME_PANELS.filter((p) => p.key !== 'advice');
// On a phone, upright or on its side (style.css), the game leaves the chart
// and the glossary (and the advice panel: the best discard is a chip in the
// action bar; the danger marks stay) to practice mode, giving their room to
// the yaku table. A
// short window is a phone on its side only with a touch screen: a desktop
// window made short keeps them.
const PHONE = '(width <= 760px), (height <= 500px) and (pointer: coarse)';
const PHONE_GAME_PANELS = GAME_PANELS.filter((p) => p.key === 'yaku');

/** Each held tile's danger mark: its highest level over the riichi seats,
 * and a text naming the seats (each with its own level when there are two
 * or more). */
function dangerMarks(danger: SeatDanger[], you: number): Record<TileT, { className: string; text: string }> {
  const out: Record<TileT, { className: string; text: string }> = {};
  for (const t of Object.keys(danger[0]?.tiles ?? {})) {
    const level = dangerLevel(danger, t) as DangerLevel;
    const each = danger
      .map((d) => (danger.length > 1 ? `${seatLabel(d.seat, you)} ${DANGER_NAMES[d.tiles[t] ?? 3]}` : seatLabel(d.seat, you)))
      .join('・');
    out[t] = { className: `tile-danger tile-danger-${level}`, text: `危険度 ${DANGER_NAMES[level]}（${each}）` };
  }
  return out;
}

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

/** A saved game in the list of saves: 「東風戦 東2局 シード 5」, and the URL params that deal it again. */
function savedItem(g: GameSummary): ResumeItem {
  const r = g.round;
  const round = r && (r.over ? '終局' : WIND_NAMES[r.wind] && roundName(r.wind, r.number, r.honba));
  const seed = g.seed !== null && `シード ${g.seed}`;
  const params: Record<string, string> = {};
  if (g.length) params.length = g.length;
  if (g.firstDealer) params.first_dealer = g.firstDealer;
  if (g.cpu) params.cpu = g.cpu;
  if (g.seedKnown) params.seed = String(g.seed);
  return {
    id: g.id,
    label: [LENGTH_NAMES[g.length as GameOptions['length']], round, seed].filter(Boolean).join(' '),
    used: g.used,
    params,
    over: !!r?.over,
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
  // A hovered advice candidate, marked in the hand.
  const [highlightTile, setHighlightTile] = useState<string | null>(null);
  const [adviceOn, setAdviceOn] = useGameAdvice();
  const [riichiMode, setRiichiMode] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  const [speed, setSpeed] = useState<PlaybackSpeed>(loadPlaybackSpeed);
  const [optionsInput, setOptionsInput] = useState<GameOptions>(urlOptions);
  // On a phone the new-game options fold behind 「設定」 once a game is on (style.css).
  const [optionsOpen, setOptionsOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // The game shown: a new one (from the form, the final panel or the URL)
  // folds the options away.
  const shownGame = useRef<string | null>(null);
  const { minimized, isMin, minimize, restore } = useMinimized();
  const phone = useMediaQuery(PHONE);
  // Opened with no game, seed or options in the URL: the saved games, if
  // any, are offered instead of a new one.
  const [offered] = useState<ResumeItem[]>(() =>
    bareUrl() ? savedGames().map(savedItem) : [],
  );
  // The first state may be a resumed game: its options fill the selects.
  const optionsSynced = useRef(false);
  // The state last reopened from a save: shown as it stands, not replayed.
  const reopened = useRef<GameState | null>(null);
  const { busy, error, retryable, request, retry } = useSerialRequest<GameState>(
    (next) => {
      if (!optionsSynced.current) {
        optionsSynced.current = true;
        setOptionsInput({ length: next.length, first_dealer: next.first_dealer_mode, cpu: next.cpu });
      }
      if (shownGame.current !== next.game_id) {
        shownGame.current = next.game_id;
        setOptionsOpen(false);
      }
      setState(next);
      setPreviewTile(null);
      setHighlightTile(null);
      setRiichiMode(false);
    },
  );
  const stopped = useSingleTab(state ? api.gameKey(state.game_id) : null);

  // The advice and the danger are asked for only while they are shown
  // (docs/api.md "View options"); a state that came with them is noted.
  const withAdvice = useRef(new WeakSet<GameState>());
  const asked = (p: Promise<GameState>) => {
    const on = adviceOn;
    return p.then((g) => {
      if (on) withAdvice.current.add(g);
      return g;
    });
  };

  function startGame(options: GameOptions, seed?: number) {
    return request(() => asked(api.createGame({ seed, ...options }, adviceOn)));
  }

  // One select of the new-game form changed.
  function setOption(key: keyof GameOptions) {
    return (e: Event) => {
      const value = (e.target as HTMLSelectElement).value;
      setOptionsInput((o) => ({ ...o, [key]: value }));
    };
  }

  // The URL carries ?mode=game&game=&seed=&length=&first_dealer=&cpu= so a
  // reload resumes the game, or deals the same seed and options again when
  // its save is gone (404).
  const { resume, open } = useUrlResume({
    idKey: 'game',
    offering: offered.length > 0,
    request,
    get: (id) => {
      // Before asking for it, so that another tab stops saving it first.
      claim(api.gameKey(id));
      return asked(api.getGame(id, adviceOn)).then((game) => (reopened.current = game));
    },
    create: (params) =>
      asked(api.createGame({ seed: optionalInt(params.get('seed')), ...parseOptions((k) => params.get(k)) }, adviceOn)),
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
    void request(() => asked(api.gameAction(state.game_id, type, tile, tiles, adviceOn)));
  }

  // The options stay open until the new game is on (a failed request keeps
  // them, as chosen); then, if they were submitted from the keyboard, focus
  // goes back to 設定 instead of dropping to the page once they fold away,
  // unless the player has moved it elsewhere meanwhile.
  async function handleNewGame(e: Event) {
    e.preventDefault();
    const fromForm = !!formRef.current?.contains(document.activeElement);
    // The game on stays saved, but only the list of saves leads back to it.
    if (state && !state.game_over && !window.confirm('対局中です。新しい対局を始めますか？')) return;
    const started = await startGame(optionsInput, seedInput.trim() === '' ? undefined : Number(seedInput));
    const toggle = toggleRef.current;
    if (!started || !toggle || toggle.offsetParent === null) return;
    const active = document.activeElement;
    if (fromForm && (active === document.body || formRef.current?.contains(active))) toggle.focus();
  }

  // After a call the analysis is empty; the chart keeps the rows from before.
  const chartAnalysis = useLastAnalysis(state?.analysis);
  const rowNames = useRowNames(chartAnalysis);
  const minimizeChart = useCallback(() => minimize('chart'), [minimize]); // the chart is memoized

  // Replays state.events (issue #29) before the player can act again or the
  // round result appears (but not for a reopened game).
  const playback = usePlayback(state, reopened.current);
  // The table and the dora follow the replay: points, sticks, the wall and
  // the dora as they stood at the current step.
  const table = playback.view;
  const earlierEvents = useRoundLog(state);
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
  // The advice and the danger of a state shown while they were off, asked
  // for once they are on (apart from the serial requests: nothing else waits
  // on them, and the playback stays). The answer is kept beside the state,
  // which stays the same object, only if it is still the one shown.
  const [late, setLate] = useState<{ of: GameState; advice: Advice | null; danger: SeatDanger[] } | null>(null);
  const shown = useRef(state);
  shown.current = state;
  const lateAsked = useRef<GameState | null>(null);
  useEffect(() => {
    if (!state || !adviceOn || stopped || withAdvice.current.has(state) || lateAsked.current === state) return;
    if (state.phase !== 'discard' || state.actor !== state.you) return;
    const of = state;
    lateAsked.current = of;
    api.getGame(of.game_id, true).then(
      (got) => {
        if (shown.current === of && got.wall_remaining === of.wall_remaining && got.phase === of.phase) {
          setLate({ of, advice: got.advice ?? null, danger: got.danger ?? [] });
        }
      },
      () => {
        // Stopped by another tab, or failed: the next state asks again.
      },
    );
  }, [state, adviceOn, stopped]);
  const lateOf = late && late.of === state ? late : null;
  const advice = state?.advice ?? lateOf?.advice ?? null;
  // The tree may be minimized from practice mode, but game mode has none.
  const panels = phone ? PHONE_GAME_PANELS : adviceOn ? GAME_PANELS : NO_ADVICE_PANELS;
  const docked = panels.filter((p) => minimized.includes(p.key));
  const danger = adviceOn && myTurn ? (state?.danger?.length ? state.danger : lateOf?.danger) : undefined;
  const marks = useMemo(() => (danger?.length && state ? dangerMarks(danger, state.you) : undefined), [danger, state]);
  const minimizeAdvice = useCallback(() => minimize('advice'), [minimize]);
  const appClass = state && docked.length > 0 ? 'app app-game has-dock' : 'app app-game';
  // On a phone the yaku panel scrolls on its own in the height left under the
  // header, the table and the hand (style.css), as in practice.
  const appRef = useYakuTop(!!state);

  const speedOption = (
    <label class="speed-option">
      再生速度
      <select
        value={speed}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value as PlaybackSpeed;
          setSpeed(v);
          savePlaybackSpeed(v);
        }}
      >
        {(Object.keys(PLAYBACK_SPEEDS) as PlaybackSpeed[]).map((k) => (
          <option key={k} value={k}>
            {PLAYBACK_SPEEDS[k].label}
          </option>
        ))}
      </select>
    </label>
  );
  const adviceOption = (
    <label class="speed-option">
      <input type="checkbox" checked={adviceOn} onChange={(e) => setAdviceOn((e.target as HTMLInputElement).checked)} />
      {/* A phone has no advice panel: the advice is the action bar's chip there. */}
      {phone ? 'おすすめ・危険度' : 'アドバイス・危険度'}
    </label>
  );
  return (
    <div ref={appRef} class={appClass}>
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
                onShowGlossary={
                  phone
                    ? undefined
                    : () => {
                        restore('gloss');
                        focusGlossary();
                      }
                }
              />
            </div>
            {state && table && (
              <div class="header-status">
                <dl class="game-status">
                  {/* A random seed is hidden until the game ends: nothing to show before then. */}
                  {state.seed !== null && (
                    <div>
                      <dt>シード</dt>
                      <dd>{state.seed}</dd>
                    </div>
                  )}
                  <div>
                    <dt class="status-dt-obvious">対局</dt>
                    <dd>{LENGTH_NAMES[state.length]}</dd>
                  </div>
                  <div>
                    <dt>CPU</dt>
                    <dd>{CPU_NAMES[state.cpu]}</dd>
                  </div>
                  <div>
                    <dt class="status-dt-obvious">局</dt>
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
                  doraIndicators={table.dora_indicators}
                  dora={table.dora}
                  uraDoraIndicators={table.ura_dora_indicators}
                  uraDora={table.ura_dora}
                />
                {!phone && speedOption}
                {!phone && adviceOption}
                <button
                  ref={toggleRef}
                  type="button"
                  class="options-toggle"
                  aria-expanded={optionsOpen}
                  aria-controls="new-game-options"
                  onClick={() => setOptionsOpen((open) => !open)}
                >
                  設定<span aria-hidden="true">{optionsOpen ? ' ▴' : ' ▾'}</span>
                </button>
              </div>
            )}
            {/* After the status, so that on a phone Tab goes from 設定 into
                the options it opens; a desktop shows them on the first row
                (style.css). */}
            <form
              id="new-game-options"
              class={state && !optionsOpen ? 'new-game-form new-game-options new-game-options-closed' : 'new-game-form new-game-options'}
              ref={formRef}
              onSubmit={handleNewGame}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && state && optionsOpen) {
                  e.preventDefault();
                  setOptionsOpen(false);
                  toggleRef.current?.focus();
                }
              }}
            >
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
              {phone && speedOption}
              {phone && adviceOption}
              <button type="submit" disabled={busy}>新規対局</button>
            </form>
          </header>
          {/* 再試行 only for an engine failure: a refused request would fail again. */}
          {error && <ErrorBanner message={error} busy={busy} onRetry={retryable ? () => retry(resume) : undefined} />}
          <SaveFailedNotice />
          {!state && offered.length > 0 && (
            <ResumePanel noun="対局" newLabel="新規対局" items={offered} busy={busy} onOpen={(s) => open(s.id, s.params)} />
          )}
          {!state && !error && offered.length === 0 && (
            <EngineLoading />
          )}
        </div>
        {state && me && table && (
          <>
            <div class="area-hand">
              <GameTable
                state={table}
                log={[...earlierEvents, ...table.events]}
                highlight={playback.highlight}
                playing={playback.playing}
              />
              <Hand
                hand={me.hand ?? NO_TILES}
                groups={me.hand_groups}
                drawn={me.drawn ?? null}
                discards={[]}
                disabled={busy || !myTurn}
                allowed={riichiMode ? state.legal.riichi : state.legal.discards}
                onlyDrawn={me.riichi}
                highlight={adviceOn ? highlightTile : null}
                marks={marks}
                melds={<Melds melds={me.melds} owner={state.you} size="sm" />}
                status={<SeatStatus seat={table.seats[table.you]} state={table} />}
                river={
                  <River
                    seat={table.seats[table.you]}
                    highlight={playback.highlight}
                    label="自分の捨て牌"
                    className="hand-river"
                  />
                }
                acting={!playback.playing && table.actor === table.you}
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
                    advice={phone && adviceOn ? advice : null}
                    highlight={highlightTile}
                    onHighlight={setHighlightTile}
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
            {!phone && (
              <div class="area-chart" hidden={isMin('chart')}>
                <ShantenChart
                  sessionId={state.game_id}
                  history={state.history}
                  currentAnalysis={chartAnalysis}
                  rowNames={rowNames}
                  minimized={isMin('chart')}
                  onMinimize={minimizeChart}
                />
              </div>
            )}
          </>
        )}
      </div>
      {state && (
        <SidePanels
          analysis={state.analysis}
          byDiscard={state.by_discard}
          combos={state.combos}
          combosByDiscard={state.combos_by_discard}
          remaining={state.remaining}
          previewTile={previewTile}
          mode="game"
          glossary={!phone}
          isMin={isMin}
          onMinimize={minimize}
          advice={
            adviceOn && !phone && (
              <AdvicePanel
                advice={advice}
                review={null}
                onHighlight={setHighlightTile}
                minimized={isMin('advice')}
                onMinimize={minimizeAdvice}
                game
                danger={danger}
              />
            )
          }
        />
      )}
      {state && (
        <Dock
          items={docked}
          onRestore={(k) => restore(k as PanelKey)}
        />
      )}
      {/* 「このタブで続ける」 takes the game back, from where the other tab left it. */}
      {stopped && <TabStopped busy={busy} onContinue={resume} />}
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
  /** On a phone, the advice to offer as a chip (no advice panel there). */
  advice: Advice | null;
  highlight: string | null; // the hand's marked tile
  onHighlight: (tile: string | null) => void;
}

/** Your options right now: ron / pon / kan / chii / skip on a discard, or on
 * your turn tsumo, kan, riichi, 九種九牌, or a hint. */
function ActionBar({ state, busy, myTurn, riichiMode, onRiichiMode, onAction, advice, highlight, onHighlight }: ActionBarProps) {
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
            aria-label={`チー ${pair.map(tileName).join(' ')} + ${state.last_discard ? tileName(state.last_discard) : ''}`}
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
  const best = advice?.candidates[0]?.tile;
  return (
    <div class="action-bar" role="group" aria-label="操作">
      {best && (
        // The best discard of the advice; a tap marks it in the hand (again, unmarks).
        <button
          type="button"
          class="action-advice"
          aria-pressed={highlight === best}
          onClick={() => onHighlight(highlight === best ? null : best)}
        >
          おすすめ: {tileName(best)}
        </button>
      )}
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
          aria-label={`カン ${tileName(t)}`}
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
      <span class="hint-hybrid">（タッチでは2回タップ）</span>
    </>
  );
}
