import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { ActionType, Advice, GameOptions, GameState, Remaining, SeatDanger, Tile as TileT, YakuRow } from './api';
import { AdvicePanel } from './components/AdvicePanel';
import { dangerMarks } from './danger';
import { Hand } from './components/Hand';
import { ShantenChart } from './components/ShantenChart';
import { Tile } from './components/Tile';
import { DoraStatus } from './components/DoraStatus';
import { SidePanels } from './components/SidePanels';
import { GameTable, LENGTH_NAMES, River, SeatStatus, WIND_NAMES, roundName, seatLabel } from './components/GameTable';
import { Melds } from './components/Melds';
import { ResultPanel } from './components/ResultPanel';
import { FinalPanel } from './components/FinalPanel';
import { AppShell } from './components/AppShell';
import type { ResumeItem } from './components/ResumePanel';
import { PANELS, focusGlossary, type PanelKey, optionalInt, useGameAdvice, useMinimized } from './panels';
import {
  useLastAnalysis,
  useMediaQuery,
  useOffered,
  usePlayback,
  useRoundLog,
  useRowNames,
  useSerialRequest,
  useSingleTab,
  useUrlResume,
} from './hooks';
import { PLAYBACK_SPEEDS, loadPlaybackSpeed, savePlaybackSpeed, setDojoSpeeds, type PlaybackSpeed } from './playback';
import { claim } from './singleTab';
import { tileName } from './tiles';
import { summarizeMoves } from './summary';
import { savedGames, type GameSummary } from './wasm';
import { REDRAW_COST, SUMMON_COST } from './dojo/catalog';
import { canAffordRedraw, canAffordSummon, dojoGame, dojoOptions, initialProgress, loadProgress, payRounds, saveProgress, settle, type DojoProgress, type Reward } from './dojo/progress';
import { TILE_BACKS, TILE_THEMES, applyTileBack, applyTileTheme } from './tileThemes';
import './dojo/dojo.css';

// A hand the state does not give yet: one array, so the Hand's selection is
// not reset on every render.
const NO_TILES: TileT[] = [];
const NO_COMBOS: GameState['combos'] = [];
const NO_COMBOS_BY_DISCARD: GameState['combos_by_discard'] = {};

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

/** The game a dojo plays: the length and CPU chosen in the hub, with what the dojo has bought. */
function dojoGameOptions(p: DojoProgress): GameOptions {
  return { ...dojoGame(p), first_dealer: 'random', dojo: dojoOptions(p) };
}

/** A closed-hand 東風戦 or 半荘戦 against three CPU players (?mode=game), or a dojo game (?mode=dojo). */
export function GameApp({ dojo = false }: { dojo?: boolean } = {}) {
  const [state, setState] = useState<GameState | null>(null);
  // The dojo's growth: read at the start, kept as it changes (settle, below).
  const [progress, setProgress] = useState<DojoProgress>(() => (dojo ? loadProgress().progress : initialProgress()));
  const [saveFailed, setSaveFailed] = useState(false);
  const [reward, setReward] = useState<Reward | null>(null);
  const [peek, setPeek] = useState(false);
  const has = (id: string) => dojo && (progress.ownedItems.includes(id) || progress.ownedYaku.includes(id));
  const [previewTile, setPreviewTile] = useState<string | null>(null);
  // A hovered advice candidate, marked in the hand.
  const [highlightTile, setHighlightTile] = useState<string | null>(null);
  const [adviceSetting, setAdviceOn] = useGameAdvice();
  // The dojo has no setting: the advice and the danger are asked for once either is bought.
  const adviceOn = dojo ? has('assist:advice') || has('assist:danger') : adviceSetting;
  const [riichiMode, setRiichiMode] = useState(false);
  const [seedInput, setSeedInput] = useState('');
  // The dojo's speeds: 遅い and 普通 at the start, 速い and なし once bought. Set before the first read below.
  const speeds = (Object.keys(PLAYBACK_SPEEDS) as PlaybackSpeed[]).filter(
    (k) => !dojo || (k !== 'fast' || has('assist:speed-fast')) && (k !== 'none' || has('assist:speed-instant')),
  );
  setDojoSpeeds(dojo ? speeds : null);
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
  const offered = useOffered(() => (dojo ? [] : savedGames().map(savedItem)));
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

  // The dojo's options come from what is bought now, not from the URL.
  function createOptions(params: URLSearchParams): GameOptions {
    return dojo ? dojoGameOptions(loadProgress().progress) : parseOptions((k) => params.get(k));
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
      asked(api.createGame({ seed: optionalInt(params.get('seed')), ...createOptions(params) }, adviceOn)),
    // A random seed is hidden until the end: drop any seed of a previous game.
    // The dojo's game has its options fixed (dojoGameOptions): none in its URL, and the hub's play= is done.
    sync:
      state &&
      (dojo
        ? {
            mode: 'dojo',
            game: state.game_id,
            seed: state.seed !== null ? String(state.seed) : null,
            play: null,
            length: null,
            first_dealer: null,
            cpu: null,
          }
        : {
            mode: 'game',
            game: state.game_id,
            seed: state.seed !== null ? String(state.seed) : null,
            length: state.length,
            first_dealer: state.first_dealer_mode,
            cpu: state.cpu,
          }),
  });

  useEffect(() => {
    document.title = dojo ? 'mhj-dojo - 道場' : 'mhj-dojo - CPU対戦';
  }, []);

  // A dojo game opened outside the dojo (a CPU game's URL with its id) moves to the dojo's page.
  useEffect(() => {
    if (!dojo && state?.dojo) location.replace(`?mode=dojo&game=${encodeURIComponent(state.game_id)}`);
  }, [dojo, state?.dojo, state?.game_id]);

  // The tile theme and back bought in the dojo, for the dojo's screens only.
  useEffect(() => {
    if (!dojo) return;
    applyTileTheme(TILE_THEMES.find((t) => t.item === progress.activeTheme)?.id ?? 'default');
    return () => applyTileTheme('default');
  }, [dojo, progress.activeTheme]);
  useEffect(() => {
    if (!dojo) return;
    applyTileBack(TILE_BACKS.find((t) => t.item === progress.activeBack)?.id ?? 'default');
    return () => applyTileBack('default');
  }, [dojo, progress.activeBack]);

  // A won round pays its han as it ends (progress.paidRounds keeps the rounds paid, by the
  // game's id); a finished dojo game pays the rest once (progress.settle keeps the seeds paid).
  // Both read fresh from storage so that another tab's purchases are not lost.
  useEffect(() => {
    if (!dojo || !state) return;
    if (!state.game_over) {
      const paid = payRounds(loadProgress().progress, state.game_id, state.rounds);
      if (!paid) return;
      setSaveFailed(!saveProgress(paid.progress));
      setProgress(paid.progress);
      return;
    }
    const { progress: next, reward: paid } = settle(loadProgress().progress, state, state.game_id);
    if (!paid) return;
    setSaveFailed(!saveProgress(next));
    setProgress(next);
    setReward(paid);
  }, [state]);

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

  // The dojo's yaku table and chart have the rows of the yaku learned only.
  const learned = useMemo(() => new Set(progress.ownedYaku), [progress.ownedYaku]);
  const keepRow = useCallback((key: string) => !dojo || key === 'normal' || learned.has(key), [dojo, learned]);
  const chartHistory = useMemo(
    () =>
      dojo && state
        ? state.history.map((h) => ({ ...h, shanten: Object.fromEntries(Object.entries(h.shanten).filter(([k]) => keepRow(k))) }))
        : state?.history,
    [state, dojo, keepRow],
  );
  // After a call the analysis is empty; the chart keeps the rows from before.
  const chartAnalysis = useLastAnalysis(useMemo(() => state?.analysis.filter((r: YakuRow) => keepRow(r.key)), [state, keepRow]));
  const rowNames = useRowNames(chartAnalysis);
  const minimizeChart = useCallback(() => minimize('chart'), [minimize]); // the chart is memoized

  // Replays state.events (issue #29) before the player can act again or the
  // round result appears (but not for a reopened game).
  const playback = usePlayback(state, reopened.current);
  // The table and the dora follow the replay: points, sticks, the wall and
  // the dora as they stood at the current step.
  // The dojo's 透視 shows the other seats' hands (the engine sends them for the whole round) only
  // when it is on and the replay is over; a finished round shows every hand as ever.
  const peeking = has('cheat:peek') && peek && !playback.playing;
  const table = useMemo(() => {
    const view = playback.view;
    if (!dojo || !view || peeking || view.phase === 'ended') return view;
    return { ...view, seats: view.seats.map((s) => (s.seat === view.you ? s : { ...s, hand: undefined, drawn: undefined })) };
  }, [playback.view, peeking]);
  const earlierEvents = useRoundLog(state);
  const summary = !playback.playing && state && state !== reopened.current ? summarizeMoves(state, (seat) => seatLabel(seat, state.you)) : '';
  const actionAreaRef = useRef<HTMLDivElement>(null);
  const wasPlaying = useRef(false);

  // The action bar is swapped for the playback hint when a replay starts and
  // back when it ends, unmounting whatever button had the focus (the move
  // just clicked, ...): the focus would drop to <body>. Once the replay ends,
  // move it into whatever now controls the turn - but only if focus was
  // already in here (or nowhere in particular), so it never steals focus from
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
  // The dojo always shows the yaku table and the chart (of the learned yaku
  // only, above); the advice panel is bought.
  const bought = (k: PanelKey) => !dojo || k !== 'advice' || has('assist:advice');
  const isMinOrLocked = (k: PanelKey) => isMin(k) || !bought(k);
  const panels = (phone ? PHONE_GAME_PANELS : adviceOn ? GAME_PANELS : NO_ADVICE_PANELS).filter((p) => bought(p.key));
  const docked = panels.filter((p) => minimized.includes(p.key));
  const sideAnalysis = useMemo(
    () => (dojo && state ? state.analysis.filter((r: YakuRow) => keepRow(r.key)) : state?.analysis),
    [state, dojo, keepRow],
  );
  const sideByDiscard = useMemo(
    () =>
      dojo && state
        ? Object.fromEntries(Object.entries(state.by_discard).map(([t, rows]) => [t, rows.filter((r) => keepRow(r.key))]))
        : state?.by_discard,
    [state, dojo, keepRow],
  );
  const canRedraw = dojo && !!state?.legal.redraw && canAffordRedraw(progress, state.rounds);
  const summonable = dojo && state?.legal.summon?.length && canAffordSummon(progress, state.rounds) ? state.legal.summon : undefined;
  // The dojo's 打牌プレビュー・複合役 is bought: without it, no preview of a hovered discard and no combos.
  const previewOn = !dojo || has('assist:preview');
  // The dojo's 有効牌ハイライト: each hand tile's ukeire (the normal row) once discarded, the best marked.
  const badges = useMemo(() => (has('assist:ukeire') && myTurn && state ? ukeireBadges(state) : undefined), [state, myTurn, progress]);
  const danger = adviceOn && myTurn && (!dojo || has('assist:danger')) ? (state?.danger?.length ? state.danger : lateOf?.danger) : undefined;
  const marks = useMemo(() => (danger?.length && state ? dangerMarks(danger, state.you) : undefined), [danger, state]);
  const minimizeAdvice = useCallback(() => minimize('advice'), [minimize]);

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
        {speeds.map((k) => (
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
    <AppShell
      mode="game"
      dojo={dojo}
      started={!!state}
      docked={docked}
      onRestore={restore}
      onShowGlossary={
        phone
          ? undefined
          : () => {
              restore('gloss');
              focusGlossary();
            }
      }
      offered={offered}
      onOpen={(s) => open(s.id, s.params)}
      busy={busy}
      error={error}
      onRetry={retryable ? () => retry(resume) : undefined}
      stopped={stopped}
      onContinue={resume}
      header={
        <>
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
              {!phone && !dojo && adviceOption}
              {has('cheat:peek') && (
                <label class="speed-option">
                  <input type="checkbox" checked={peek} onChange={(e) => setPeek((e.target as HTMLInputElement).checked)} />
                  透視
                </label>
              )}
              {!dojo && <button
                ref={toggleRef}
                type="button"
                class="options-toggle"
                aria-expanded={optionsOpen}
                aria-controls="new-game-options"
                onClick={() => setOptionsOpen((open) => !open)}
              >
                設定<span aria-hidden="true">{optionsOpen ? ' ▴' : ' ▾'}</span>
              </button>}
            </div>
          )}
          {/* After the status, so that on a phone Tab goes from 設定 into
              the options it opens; a desktop shows them on the first row
              (style.css). */}
          {!dojo && <form
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
          </form>}
        </>
      }
      main={
        state && me && table && (
          <>
            <div class="area-hand">
              <GameTable
                state={table}
                log={[...earlierEvents, ...table.events]}
                highlight={playback.highlight}
                playing={playback.playing}
              />
              {dojo && !playback.playing && (
                <DojoAids
                  analysis={state.analysis}
                  learned={learned}
                  closed={me.melds.every((m) => m.type === 'ankan')}
                  riichi={me.riichi}
                  remaining={state.remaining}
                  noyaku={has('assist:noyaku')}
                  riichiOwned={has('riichi')}
                  waits={has('assist:waits')}
                  nextDraws={state.my_next_draws}
                />
              )}
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
                badges={badges}
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
              {/* While playing, the action bar shows the same text; afterwards
                  the summary stays in view until the next move. */}
              <p class="cpu-summary" data-testid="cpu-summary" role="status" aria-live="polite">
                {playback.playing ? <span class="visually-hidden">CPUの動きを再生中…</span> : summary}
              </p>
              <div ref={actionAreaRef} class="action-area" tabIndex={-1}>
                {playback.playing ? (
                  <div class="action-bar action-bar-playback">
                    <span class="action-hint" aria-hidden="true">
                      CPUの動きを再生中…
                    </span>
                  </div>
                ) : (
                  <ActionBar
                    state={state}
                    busy={busy}
                    myTurn={myTurn}
                    riichiMode={riichiMode}
                    onRiichiMode={setRiichiMode}
                    onAction={act}
                    advice={phone && adviceOn && (!dojo || has('assist:advice')) ? advice : null}
                    canRedraw={canRedraw}
                    summonable={summonable}
                    highlight={highlightTile}
                    onHighlight={setHighlightTile}
                  />
                )}
              </div>
              {!playback.playing && state.result && (
                <ResultPanel
                  state={state}
                  result={state.result}
                  busy={busy}
                  onNext={() => act('next')}
                  dojoHan={dojo ? (state.rounds[state.rounds.length - 1]?.han ?? 0) : undefined}
                />
              )}
              {!playback.playing && state.game_over && (
                <FinalPanel
                  state={state}
                  busy={busy}
                  onNewGame={() =>
                    dojo
                      ? location.assign('?mode=dojo')
                      : void startGame({ length: state.length, first_dealer: state.first_dealer_mode, cpu: state.cpu })
                  }
                  dojo={dojo ? { reward, newLabel: '道場へ戻る', saveFailed } : undefined}
                />
              )}
            </div>
            {!phone && (
              <div class="area-chart" hidden={isMinOrLocked('chart')}>
                <ShantenChart
                  sessionId={state.game_id}
                  history={chartHistory ?? state.history}
                  currentAnalysis={chartAnalysis}
                  rowNames={rowNames}
                  minimized={isMinOrLocked('chart')}
                  onMinimize={minimizeChart}
                />
              </div>
            )}
          </>
        )
      }
    >
      {state && (
        <SidePanels
          analysis={sideAnalysis ?? state.analysis}
          byDiscard={sideByDiscard ?? state.by_discard}
          combos={previewOn ? state.combos : NO_COMBOS}
          combosByDiscard={previewOn ? state.combos_by_discard : NO_COMBOS_BY_DISCARD}
          remaining={state.remaining}
          previewTile={previewOn ? previewTile : null}
          mode="game"
          glossary={!phone}
          isMin={isMinOrLocked}
          onMinimize={minimize}
          advice={
            adviceOn && !phone && (!dojo || has('assist:advice')) && (
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
    </AppShell>
  );
}

interface ActionBarProps {
  state: GameState;
  busy: boolean;
  myTurn: boolean;
  riichiMode: boolean;
  onRiichiMode: (on: boolean) => void;
  onAction: (type: ActionType, tile?: TileT, tiles?: TileT[]) => void;
  canRedraw: boolean; // dojo: 引き直し is legal and affordable
  summonable?: TileT[]; // dojo: the kinds 牌寄せ may fetch, when legal and affordable
  /** On a phone, the advice to offer as a chip (no advice panel there). */
  advice: Advice | null;
  highlight: string | null; // the hand's marked tile
  onHighlight: (tile: string | null) => void;
}

/** Your options right now: ron / pon / kan / chii / skip on a discard, or on
 * your turn tsumo, kan, riichi, 九種九牌, or a hint. */
function ActionBar({ state, busy, myTurn, riichiMode, onRiichiMode, onAction, canRedraw, summonable, advice, highlight, onHighlight }: ActionBarProps) {
  const { legal } = state;
  // 牌寄せ opens a row of the kinds it may fetch; a new state closes it.
  const [summoning, setSummoning] = useState(false);
  useEffect(() => setSummoning(false), [state]);
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
      {canRedraw && (
        <button type="button" class="action-redraw" disabled={busy} onClick={() => onAction('redraw')}>
          引き直し（{REDRAW_COST}雀銭）
        </button>
      )}
      {summonable && (
        <button type="button" class="action-redraw" aria-expanded={summoning} disabled={busy} onClick={() => setSummoning(!summoning)}>
          牌寄せ（{SUMMON_COST}雀銭）
        </button>
      )}
      {summonable && summoning && (
        <div class="summon-picker" role="group" aria-label="寄せる牌">
          {summonable.map((t) => (
            <Tile key={t} tile={t} size="sm" interactive label={`${tileName(t)}を寄せる`} onClick={() => onAction('summon', t)} />
          ))}
        </div>
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

/** Each hand tile's ukeire once discarded (the normal row of by_discard); the best (lowest shanten, then most) marked. */
function ukeireBadges(state: GameState): Record<string, { count: number; text: string; best: boolean }> {
  const rows = Object.entries(state.by_discard).flatMap(([t, rs]) => {
    const n = rs.find((r) => r.key === 'normal');
    return n && n.shanten !== null ? [{ t, shanten: n.shanten, count: n.ukeire_total }] : [];
  });
  const low = Math.min(...rows.map((r) => r.shanten));
  const most = Math.max(...rows.filter((r) => r.shanten === low).map((r) => r.count));
  return Object.fromEntries(
    rows.map((r) => [r.t, { count: r.count, text: `切ると有効牌${r.count}枚`, best: r.shanten === low && r.count === most }]),
  );
}

interface DojoAidsProps {
  analysis: YakuRow[];
  learned: Set<string>;
  closed: boolean; // no open meld (an ankan keeps the hand closed)
  riichi: boolean; // already in riichi
  remaining: Remaining;
  noyaku: boolean; // 補助: 役なし警告
  riichiOwned: boolean;
  waits: boolean; // 補助: 待ち牌表示
  nextDraws?: TileT[]; // イカサマ: 山読み
}

/** The dojo's aids above the hand: 役なし (or 立直, or a tsumo, to win), the waits with their copies left, and the next draws. */
function DojoAids({ analysis, learned, closed, riichi, remaining, noyaku, riichiOwned, waits, nextDraws }: DojoAidsProps) {
  const normal = analysis.find((r) => r.key === 'normal');
  const tenpai = normal?.shanten === 0;
  // Tenpai in the general form, but no learned yaku's row is: a win would have no yaku (立直 and
  // 門前清自摸和 have no row; a closed hand that owns 門前清自摸和 still wins by tsumo).
  const noYaku = tenpai && !riichi && !analysis.some((r) => r.key !== 'normal' && learned.has(r.key) && r.shanten !== null && r.shanten <= 0);
  const warn = noyaku && noYaku;
  const showWaits = waits && tenpai && normal.ukeire.length > 0;
  if (!warn && !showWaits && !nextDraws?.length) return null;
  return (
    <div class="dojo-aids">
      {(warn || showWaits) && (
        <p class="dojo-aid" data-testid="dojo-waits">
          {warn &&
            (closed && riichiOwned ? (
              <span class="dojo-aid-ok">役なし：立直で和了れます</span>
            ) : closed && learned.has('tsumo') ? (
              <span class="dojo-aid-warn">ロンでは和了れません（ツモなら門前清自摸和）</span>
            ) : (
              <span class="dojo-aid-warn">役なし</span>
            ))}
          {showWaits && (
            <>
              <span class="dojo-aid-label">待ち</span>
              {normal.ukeire.map((t) => (
                <span key={t} class="dojo-aid-tile">
                  <Tile tile={t} size="xs" dimmed={(remaining[t] ?? 0) === 0} label={`${tileName(t)} 残り${remaining[t] ?? 0}枚`} />
                  <span class="dojo-aid-count" aria-hidden="true">
                    {remaining[t] ?? 0}
                  </span>
                </span>
              ))}
            </>
          )}
        </p>
      )}
      {!!nextDraws?.length && (
        <p class="dojo-aid" data-testid="dojo-next-draws">
          <span class="dojo-aid-label">次のツモ（鳴きがなければ）</span>
          {nextDraws.map((t, i) => (
            <Tile key={i} tile={t} size="xs" />
          ))}
        </p>
      )}
    </div>
  );
}
