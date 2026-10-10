import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as api from './api';
import type { ActionType, Advice, GameOptions, GameState, SeatDanger, Tile as TileT } from './api';
import { AdvicePanel } from './components/AdvicePanel';
import { dangerMarks } from './danger';
import { Hand } from './components/Hand';
import { ShantenChart } from './components/ShantenChart';
import { PinnedStatus, WallDora } from './components/PinnedStatus';
import { SidePanels } from './components/SidePanels';
import { GameTable, LENGTH_NAMES, River, SeatStatus, WIND_NAMES, seatLabel } from './components/GameTable';
import { Melds } from './components/Melds';
import { ResultPanel } from './components/ResultPanel';
import { FinalPanel } from './components/FinalPanel';
import { AppShell } from './components/AppShell';
import { PANELS, focusGlossary, type PanelKey, optionalInt, useGameAdvice, useMinimized, useRiversShown } from './panels';
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
import { summarizeMoves } from './summary';
import { dojoGameSaved, gameLesson, savedGames, setGameLesson } from './saves';
import { canAffordRedraw, canAffordSummon, loadProgress, type DojoProgress } from './dojo/progress';
import { DojoAids, ukeireBadges } from './dojo/DojoAids';
import { useDojoGame, useLearnedRows } from './dojo/useDojoGame';
import { LessonBar } from './dojo/LessonBar';
import { useLesson } from './dojo/useLesson';
import { findLesson, gameRoundKey, lessonActive, lessonAids } from './dojo/lessons';
import { LooksSettings, useSharedLooks } from './dojo/looks';
import { AUTO_ITEMS, AUTO_KEYS, autoMove, useAutoPlay, type AutoKey } from './dojo/autoPlay';
import { ActionBar } from './components/ActionBar';
import { RadioGroup } from './components/RadioGroup';
import { CPU_LEVEL_NAMES, CPU_NAMES, DEALER_NAMES, dojoGameOptions, parseOptions, savedItem, urlOptions } from './gameOptions';
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
// On a phone, upright or on its side (styles/*.css), the game leaves the chart
// and the glossary (and the advice panel: the best discard is a chip in the
// action bar; the danger marks stay) to practice mode, giving their room to
// the yaku table. A
// short window is a phone on its side only with a touch screen: a desktop
// window made short keeps them.
const PHONE = '(width <= 760px), (height <= 500px) and (pointer: coarse)';
// Where the other seats' rivers can fold away (styles/*.css).
const RIVERS_FOLD = '(width <= 760px), (height <= 500px)';
const PHONE_GAME_PANELS = GAME_PANELS.filter((p) => p.key === 'yaku');

/** A game lesson's id in the URL (?lesson=), if it names one. */
function urlGameLesson(params: URLSearchParams) {
  const lesson = findLesson(params.get('lesson') ?? '');
  return lesson?.form === 'game' ? lesson : undefined;
}

/** The lesson a new dojo game's URL asks for, if it is being learned (neither locked nor done). */
function openLesson(params: URLSearchParams, p: DojoProgress) {
  const lesson = urlGameLesson(params);
  return lesson && lessonActive(p, lesson.id) ? lesson : undefined;
}

/** A closed-hand 東風戦 or 半荘戦 against three CPU players (?mode=game), or a dojo game (?mode=dojo). */
export function GameApp({ dojo = false }: { dojo?: boolean } = {}) {
  const [state, setState] = useState<GameState | null>(null);
  const { progress, has: owns, learned: owned, reward, saveFailed, update } = useDojoGame(dojo, state);
  // A dojo game played for a lesson (dojo/lessons.ts): the one it was created for, kept with its save
  // so that a resumed game is judged by it. A lesson asked for in the URL makes it one when it is
  // created, if the lesson is being learned; the hub's own games are never one. Should its save
  // have failed, the game created here, and else the URL (which keeps the lesson), tell it.
  const [askedLesson] = useState(() => (dojo ? new URLSearchParams(location.search).get('lesson') : null));
  const [createdFor, setCreatedFor] = useState<{ game: string; lesson: string } | null>(null);
  const lessonId = useMemo(() => {
    if (!dojo || !state) return null;
    const saved = gameLesson(state.game_id);
    if (saved !== null) return saved;
    if (createdFor?.game === state.game_id) return createdFor.lesson;
    // The URL's, being learned (as when the game was dealt for it), for a game with no save at all.
    return dojoGameSaved(state.game_id) ? null : (openLesson(new URLSearchParams(location.search), loadProgress().progress)?.id ?? null);
  }, [dojo, state?.game_id, createdFor]);
  const lesson = useLesson(lessonId, update);
  // The lesson's assists are on at its assisted stage and off at the other, owned or not.
  const has = (id: string) => lesson?.assist(id) ?? owns(id);
  // The lesson's yaku count in its game (created with them): its rows show too.
  const learned = useMemo(() => (lesson ? new Set([...owned, ...lesson.lesson.tempYaku]) : owned), [owned, lesson?.lesson]);
  // The dojo's looks, chosen in 設定 too once the dojo has a progress.
  const looks = useSharedLooks();
  const [peek, setPeek] = useState(false);
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
  // 設定 (the header's button) opens the options in a modal dialog; a new game started from it closes it.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const { minimized, isMin, minimize, restore } = useMinimized();
  const phone = useMediaQuery(PHONE);
  const rivers = useRiversShown();
  const riversFold = useMediaQuery(RIVERS_FOLD);
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

  // The dojo's options come from what is bought now (p), not from the URL; a lesson's game adds its yaku.
  function createOptions(params: URLSearchParams, p: DojoProgress, lessonId?: string): GameOptions {
    if (!dojo) return parseOptions((k) => params.get(k));
    const options = dojoGameOptions(p);
    const extra = lessonId === undefined ? [] : lessonAids(p, lessonId).yaku;
    return options.dojo ? { ...options, dojo: { ...options.dojo, yaku: [...new Set([...options.dojo.yaku, ...extra])] } } : options;
  }

  // One choice of the new-game form changed.
  function setOption<K extends keyof GameOptions>(key: K) {
    return (value: GameOptions[K]) => setOptionsInput((o) => ({ ...o, [key]: value }));
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
    create: (params) => {
      const p = loadProgress().progress;
      const forLesson = dojo ? openLesson(params, p) : undefined;
      return asked(api.createGame({ seed: optionalInt(params.get('seed')), ...createOptions(params, p, forLesson?.id) }, adviceOn)).then((game) => {
        // Marked once created (its first save is made by then): the lesson it was dealt for.
        if (forLesson) {
          setGameLesson(game.game_id, forLesson.id);
          setCreatedFor({ game: game.game_id, lesson: forLesson.id });
        }
        return game;
      });
    },
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
            // Kept so that a game whose save is gone (404) is dealt again for its lesson.
            lesson: lessonId,
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

  function act(type: ActionType, tile?: TileT, tiles?: TileT[]) {
    if (!state) return;
    void request(() => asked(api.gameAction(state.game_id, type, tile, tiles, adviceOn)));
  }

  // The options stay open until the new game is on (a failed request keeps
  // them, as chosen); the dialog then gives the focus back to 設定. Only this
  // closes it: the first game, dealt as the page opens, leaves a 設定 opened
  // meanwhile as it is.
  function handleNewGame(e: Event) {
    e.preventDefault();
    // The game on stays saved, but only the list of saves leads back to it.
    if (state && !state.game_over && !window.confirm('対局中です。新しい対局を始めますか？')) return;
    void startGame(optionsInput, seedInput.trim() === '' ? undefined : Number(seedInput)).then((ok) => ok && setOptionsOpen(false));
  }

  // The dojo's yaku table and chart have the rows of the yaku learned only.
  const rows = useLearnedRows(dojo, learned, state);
  // After a call the analysis is empty; the chart keeps the rows from before.
  const chartAnalysis = useLastAnalysis(rows.analysis);
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
  // A lesson's game is judged as each round ends, once its replay is over, on
  // the round's every move: the round's earlier moves (earlierEvents) must
  // reach back to its start, which a game reopened mid-round lacks.
  useEffect(() => {
    if (!lesson || lesson.lesson.form !== 'game' || !state?.result || playback.playing) return;
    if (earlierEvents.length !== state.events_from) return;
    const record = { you: state.you, result: state.result, events: [...earlierEvents, ...state.events] };
    lesson.record(lesson.lesson.judge(record), gameRoundKey(state.game_id, state.rounds.length - 1));
  }, [state, playback.playing, lesson?.lesson]);
  // The note of a round's success stays until the next round begins.
  useEffect(() => {
    if (state && !state.result) lesson?.clearNote();
  }, [state?.result]);
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
  const canRedraw = dojo && !!state?.legal.redraw && canAffordRedraw(progress, state.rounds);
  const summonable = dojo && state?.legal.summon?.length && canAffordSummon(progress, state.rounds) ? state.legal.summon : undefined;
  // The dojo's 打牌プレビュー・複合役 is bought: without it, no preview of a hovered discard and no combos.
  const previewOn = !dojo || has('assist:preview');
  // The dojo's 有効牌ハイライト: each hand tile's ukeire (the normal row) once discarded, the best marked.
  const badges = useMemo(() => (has('assist:ukeire') && myTurn && state ? ukeireBadges(state) : undefined), [state, myTurn, progress]);
  const danger = adviceOn && myTurn && (!dojo || has('assist:danger')) ? (state?.danger?.length ? state.danger : lateOf?.danger) : undefined;
  const marks = useMemo(() => (danger?.length && state ? dangerMarks(danger, state.you) : undefined), [danger, state]);

  // The dojo's automations (dojo/autoPlay.ts): those bought, and of them those switched on.
  const auto = useAutoPlay();
  // A lesson's game has none: the player must make its moves.
  const autoOwned = lesson ? [] : AUTO_KEYS.filter((k) => has(AUTO_ITEMS[k].item));
  const autoOn = useMemo(() => new Set<AutoKey>(autoOwned.filter((k) => auto.on.has(k))), [autoOwned.join(), auto.on]);
  // Each state moves once, after its replay, while no request is out (the
  // next state, or an error to retry by hand).
  const autoPlayed = useRef<GameState | null>(null);
  useEffect(() => {
    if (!dojo || !state || busy || error || stopped || playback.playing || autoPlayed.current === state) return;
    const move = autoMove(state, autoOn);
    if (!move) return;
    autoPlayed.current = state;
    act(move.type, move.tile);
    // act closes over state (a dependency) and adviceOn only: no need to re-run for it.
  }, [state, busy, error, stopped, playback.playing, autoOn]);
  const autoTools = autoOwned.length > 0 && (
    <div class="hand-tools" role="group" aria-label="自動">
      {autoOwned.map((k) => (
        <button
          key={k}
          type="button"
          class={`filter-chip ${auto.on.has(k) ? 'filter-chip-on' : ''}`}
          aria-pressed={auto.on.has(k)}
          onClick={() => auto.toggle(k)}
        >
          {AUTO_ITEMS[k].label}
        </button>
      ))}
    </div>
  );
  const minimizeAdvice = useCallback(() => minimize('advice'), [minimize]);

  const chooseSpeed = (v: PlaybackSpeed) => {
    setSpeed(v);
    savePlaybackSpeed(v);
  };
  const speedGroup = (
    <RadioGroup
      label="再生速度"
      name="game-speed"
      value={speed}
      names={Object.fromEntries(speeds.map((k) => [k, PLAYBACK_SPEEDS[k].label])) as Record<PlaybackSpeed, string>}
      onChange={chooseSpeed}
    />
  );
  // What the page shows: the advice and the danger (a CPU game's own choice; the dojo's
  // are bought), the other seats' rivers where a phone can fold them away, and the
  // dojo's 透視 once bought.
  const viewGroup = (!dojo || riversFold || has('cheat:peek')) && (
    <fieldset class="dojo-settings-group option-group">
      <legend>表示</legend>
      {riversFold && (
        <label>
          <input type="checkbox" checked={rivers.shown} onChange={rivers.toggle} />
          他家の捨て牌
        </label>
      )}
      {!dojo && (
        <label>
          <input type="checkbox" checked={adviceOn} onChange={(e) => setAdviceOn((e.target as HTMLInputElement).checked)} />
          {/* A phone has no advice panel: the advice is the action bar's chip there. */}
          {phone ? 'おすすめ・危険度' : 'アドバイス・危険度'}
        </label>
      )}
      {has('cheat:peek') && (
        <label>
          <input type="checkbox" checked={peek} onChange={(e) => setPeek((e.target as HTMLInputElement).checked)} />
          透視
        </label>
      )}
    </fieldset>
  );
  // The 設定 dialog: a CPU game's new-game form, the dojo's game only how it is shown;
  // then the dojo's looks, applied as chosen.
  const options = dojo ? (
    <div class="new-game-form">
      {speedGroup}
      {viewGroup}
    </div>
  ) : (
    <form id="new-game-options" class="new-game-form new-game-options" onSubmit={handleNewGame}>
      <RadioGroup label="対局" name="game-length" value={optionsInput.length} names={LENGTH_NAMES} onChange={setOption('length')} />
      <RadioGroup label="起家" name="game-first-dealer" value={optionsInput.first_dealer} names={DEALER_NAMES} onChange={setOption('first_dealer')} />
      <RadioGroup label="CPU" name="game-cpu" value={optionsInput.cpu} names={CPU_NAMES} onChange={setOption('cpu')} />
      <fieldset class="dojo-settings-group option-group">
        <legend>シード</legend>
        <input
          type="number"
          aria-label="シード"
          value={seedInput}
          placeholder="ランダム"
          onInput={(e) => setSeedInput((e.target as HTMLInputElement).value)}
        />
      </fieldset>
      {speedGroup}
      {viewGroup}
      <button type="submit" disabled={busy}>新規対局</button>
    </form>
  );
  const settings = (
    <>
      {options}
      {looks.progress && <LooksSettings progress={looks.progress} onChange={looks.change} open={optionsOpen} ownedOnly saveFailed={looks.saveFailed} />}
    </>
  );
  return (
    <AppShell
      mode="game"
      dojo={dojo}
      settings={settings}
      settingsOpen={optionsOpen}
      onSettingsOpen={setOptionsOpen}
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
                  <dd>{CPU_LEVEL_NAMES[state.cpu]}</dd>
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
              {/* The wall left as the playback stands, kept with the dora (on a phone, over the hand: PinnedStatus). */}
              <WallDora
                wallRemaining={table.wall_remaining}
                doraIndicators={table.dora_indicators}
                dora={table.dora}
                uraDoraIndicators={table.ura_dora_indicators}
                uraDora={table.ura_dora}
              />
            </div>
          )}
        </>
      }
      main={
        state && me && table && (
          <>
            <div class="area-hand">
              <PinnedStatus
                wallRemaining={table.wall_remaining}
                doraIndicators={table.dora_indicators}
                dora={table.dora}
                uraDoraIndicators={table.ura_dora_indicators}
                uraDora={table.ura_dora}
              />
              {lesson && (
                <LessonBar
                  lesson={lesson.lesson}
                  stage={lesson.stage}
                  count={lesson.count}
                  note={lesson.note}
                  failures={lesson.failures}
                  saveFailed={lesson.saveFailed}
                />
              )}
              {!lesson && askedLesson !== null && (
                <p class="dojo-notice" data-testid="lesson-closed">
                  この課題はまだ挑戦できないか、合格済みです。課題のない対局になります。
                </p>
              )}
              <GameTable
                state={table}
                log={[...earlierEvents, ...table.events]}
                highlight={playback.highlight}
                playing={playback.playing}
                riversShown={rivers.shown}
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
                tools={autoTools}
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
                    noCalls={autoOn.has('nocall')}
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
                  history={rows.history ?? state.history}
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
          analysis={rows.analysis ?? state.analysis}
          byDiscard={rows.byDiscard ?? state.by_discard}
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
